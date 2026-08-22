import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { haversine } from '../geo/mercator.js';
import { createPanoramaMaterial } from './shaders.js';

/**
 * Street-level imagery, merged into the satellite world.
 *
 * The merge rule is the whole trick. Satellite terrain is what you fly over;
 * ground photography is what you stand in. So the panorama dome fades in when
 * you are near its capture point, near the ground and moving slowly, and fades
 * out the moment you take off or start covering distance — which is also
 * exactly when a static photo would start to look wrong. You never see a seam
 * because the two never fight for the same moment.
 *
 * Coverage needs a provider key (Google or Mapillary). With none set this
 * quietly does nothing.
 */

const SEARCH_RADIUS_M = 70;
const DOME_RADIUS = 90;

/** Hermite fade between two edges, so a blend arrives rather than switches. */
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Panorama {
  constructor({ scene, frame, worker }) {
    this.frame = frame;
    this.worker = worker;
    this.material = createPanoramaMaterial();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.current = null; // {id, lat, lon, yaw, texture}
    this.loading = false;
    this.lastSearchAt = 0;
    this.lastSearch = null;
    this.opacity = 0;
    this.jobId = 0;
    this.pendingJobs = new Map();
    this.status = 'off';

    this.worker.addEventListener('message', (event) => this.onWorkerMessage(event.data));
  }

  get provider() {
    return settings.get('panoramaProvider');
  }

  get enabled() {
    return settings.get('streetLevel') && this.provider !== 'none' && Boolean(this.key);
  }

  get key() {
    if (this.provider === 'google') return settings.get('googleKey');
    if (this.provider === 'mapillary') return settings.get('mapillaryToken');
    return '';
  }

  rebase() {
    if (this.current) this.place(this.current);
  }

  /**
   * @param {object} state {lat, lon, altitudeAboveGround, speed, world:{x,y,z}}
   */
  update(state, dt) {
    if (!this.enabled) {
      this.opacity = 0;
      this.mesh.visible = false;
      this.status = this.provider === 'none' ? 'off' : 'no key';
      return;
    }

    const grounded = state.altitudeAboveGround < 26;
    const slow = state.speed < 14;

    if (grounded && slow) this.maybeSearch(state.lat, state.lon);

    let target = 0;
    if (this.current && this.current.texture) {
      const distance = haversine(
        { lat: state.lat, lon: state.lon },
        { lat: this.current.lat, lon: this.current.lon },
      );
      // How much of what you are looking at is the photograph.
      //
      // It used to run out over thirty-eight metres, which is short enough
      // that the dome read as switching on rather than as arriving: you
      // stepped forward and the world changed. Walking toward a capture point
      // now brings the photograph up gradually across a hundred metres and
      // over a smooth curve, so the geometry underneath gives way to it by
      // degrees — the closer you get, the more of it you are standing in.
      const near = 1 - smoothstep(10, 110, distance);
      const low = 1 - smoothstep(6, 34, state.altitudeAboveGround);
      const calm = 1 - smoothstep(6, 22, state.speed);
      target = near * low * calm;
    }

    this.opacity = damp(this.opacity, target, 6, dt);
    this.material.uniforms.uOpacity.value = this.opacity;
    this.mesh.visible = this.opacity > 0.01;

    if (this.current && this.mesh.visible) {
      const world = this.frame.toWorld(this.current.lat, this.current.lon);
      this.mesh.position.set(world.x, state.groundHeight + 2.4, world.z);
    }
  }

  maybeSearch(lat, lon) {
    const now = performance.now();
    if (this.loading || now - this.lastSearchAt < 4000) return;
    if (this.current) {
      const d = haversine({ lat, lon }, { lat: this.current.lat, lon: this.current.lon });
      if (d < 24) return; // still standing in the current photo
    }
    if (this.lastSearch) {
      const d = haversine({ lat, lon }, this.lastSearch);
      if (d < 18) return; // already looked here and found nothing
    }
    this.lastSearchAt = now;
    this.lastSearch = { lat, lon };
    this.loading = true;
    this.status = 'searching';

    const search = this.provider === 'google' ? this.searchGoogle(lat, lon) : this.searchMapillary(lat, lon);
    search
      .then((pano) => {
        if (!pano) {
          this.status = 'no coverage here';
          return;
        }
        this.status = 'loading';
        return this.load(pano);
      })
      .catch((err) => {
        this.status = `error: ${err && err.message ? err.message : err}`;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  async searchGoogle(lat, lon) {
    const key = settings.get('googleKey');
    const url =
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}` +
      `&radius=${SEARCH_RADIUS_M}&source=outdoor&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`street view ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK' || !data.location) return null;
    return {
      provider: 'google',
      id: data.pano_id,
      lat: data.location.lat,
      lon: data.location.lng,
      yaw: 0,
    };
  }

  async searchMapillary(lat, lon) {
    const token = settings.get('mapillaryToken');
    const d = SEARCH_RADIUS_M / 111320;
    const bbox = [lon - d * 1.6, lat - d, lon + d * 1.6, lat + d].join(',');
    const url =
      `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}` +
      `&fields=id,computed_geometry,computed_compass_angle,thumb_2048_url,is_pano&bbox=${bbox}&limit=12`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mapillary ${res.status}`);
    const data = await res.json();
    let best = null;
    let bestDistance = Infinity;
    for (const image of data.data ?? []) {
      if (!image.is_pano || !image.computed_geometry || !image.thumb_2048_url) continue;
      const [ilon, ilat] = image.computed_geometry.coordinates;
      const distance = haversine({ lat, lon }, { lat: ilat, lon: ilon });
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          provider: 'mapillary',
          id: image.id,
          lat: ilat,
          lon: ilon,
          url: image.thumb_2048_url,
          // Mapillary equirects start at the camera's compass heading.
          yaw: ((image.computed_compass_angle ?? 0) / 360) % 1,
        };
      }
    }
    return best;
  }

  async load(pano) {
    if (pano.provider === 'mapillary') {
      const texture = await loadEquirect(pano.url);
      this.place({ ...pano, texture });
      return;
    }

    const key = settings.get('googleKey');
    const urls = [0, 90, 180, 270].map(
      (heading) =>
        `https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${encodeURIComponent(pano.id)}` +
        `&fov=90&heading=${heading}&pitch=0&key=${encodeURIComponent(key)}`,
    );
    const bitmap = await this.stitch(urls);
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.place({ ...pano, texture });
  }

  stitch(urls) {
    return new Promise((resolve, reject) => {
      const id = ++this.jobId;
      this.pendingJobs.set(id, { resolve, reject });
      this.worker.postMessage({
        kind: 'panoStitch',
        channel: 'pano',
        id,
        urls,
        width: 2048,
        height: 1024,
        fovDeg: 90,
      });
    });
  }

  onWorkerMessage(msg) {
    if (!msg || msg.channel !== 'pano' || msg.id === undefined) return;
    const job = this.pendingJobs.get(msg.id);
    if (!job) return;
    this.pendingJobs.delete(msg.id);
    if (msg.ok && msg.bitmap) job.resolve(msg.bitmap);
    else job.reject(new Error(msg.error || 'stitch failed'));
  }

  place(pano) {
    if (this.current && this.current.texture && this.current.texture !== pano.texture) {
      this.current.texture.dispose();
    }
    this.current = pano;
    this.material.uniforms.uMap.value = pano.texture;
    this.material.uniforms.uYaw.value = pano.yaw ?? 0;
    this.status = 'showing ground imagery';
  }

  clear() {
    if (this.current && this.current.texture) this.current.texture.dispose();
    this.current = null;
    this.opacity = 0;
    this.mesh.visible = false;
    this.lastSearch = null;
    this.status = 'off';
  }
}

function loadEquirect(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        resolve(texture);
      },
      undefined,
      () => reject(new Error('panorama image failed to load')),
    );
  });
}
