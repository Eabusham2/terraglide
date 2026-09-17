/**
 * A small reader for Mapbox Vector Tiles.
 *
 * Vector tiles are the other half of how the world is served. A raster tile is
 * a picture somebody already drew; a vector tile is the roads, coastlines and
 * place names themselves, and you draw them. That matters here for one
 * practical reason: the keyless raster map servers are community machines with
 * fair-use policies, and a game that pans a map around is exactly the kind of
 * traffic those policies are written about. OpenFreeMap hands out the vectors
 * instead, unmetered and keyless, and one tile of them covers every zoom below
 * it — so the same download that draws a country also draws a street in it.
 *
 * This is deliberately the smallest thing that can read one: enough protobuf to
 * walk the tile, and the geometry command stream. No projection, no styling, no
 * label placement — those live where they are used.
 *
 * The format is Mapbox Vector Tile 2.1, which is protocol buffers with this
 * shape: a tile is a list of layers, a layer is a name, an extent, a list of
 * features and two side tables holding the tag keys and values; a feature is a
 * geometry type, a run of tag indices into those tables, and a stream of
 * commands. Nothing else in it is needed to draw a map.
 */

/** Feature geometry types, as the format numbers them. */
export const POINT = 1;
export const LINE = 2;
export const POLYGON = 3;

/** A tile's coordinate space, unless the layer says otherwise. */
const DEFAULT_EXTENT = 4096;

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done() {
    return this.pos >= this.bytes.length;
  }

  /**
   * A base-128 varint. Seven bits of payload per byte, low group first, top
   * bit set on every byte but the last.
   */
  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.bytes[this.pos++];
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      // Well past anything a tile holds: bail rather than spin on bad bytes.
      if (shift > 63) return result;
    }
  }

  /** Signed varint, in protobuf's zigzag encoding: -1, 1, -2, 2 … */
  svarint() {
    const value = this.varint();
    return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
  }

  /** Field header: the field number and how its value is laid out. */
  tag() {
    const key = this.varint();
    return { field: key >> 3, wire: key & 0x7 };
  }

  bytesField() {
    const length = this.varint();
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  string() {
    return new TextDecoder('utf-8').decode(this.bytesField());
  }

  float() {
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  double() {
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  /** Step over a field we have no use for, whatever shape it is. */
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unknown wire type ${wire}`);
  }
}

function readValue(bytes) {
  const r = new Reader(bytes);
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) return r.string();
    if (field === 2 && wire === 5) return r.float();
    if (field === 3 && wire === 1) return r.double();
    if (field === 4 && wire === 0) return r.varint();
    if (field === 5 && wire === 0) return r.varint();
    if (field === 6 && wire === 0) return r.svarint();
    if (field === 7 && wire === 0) return r.varint() !== 0;
    r.skip(wire);
  }
  return null;
}

/**
 * The command stream, turned into rings of points.
 *
 * Coordinates are deltas from the last point, so this walks rather than
 * indexes. A MoveTo starts a ring; LineTo extends it; ClosePath ends one. The
 * count packed into each command says how many coordinate pairs follow, which
 * is what lets a single MoveTo carry a whole layer's worth of points.
 */
function readGeometry(bytes) {
  const r = new Reader(bytes);
  const rings = [];
  let ring = null;
  let x = 0;
  let y = 0;
  while (!r.done) {
    const header = r.varint();
    const command = header & 0x7;
    // The count is whatever the tile claims, and a tile is a few hundred
    // kilobytes off the network from a host we do not control. A corrupt or
    // hostile byte here can claim two hundred million points, and reading past
    // the end returns zero rather than stopping — so the loop would sit there
    // adding nothing, for minutes, on the thread that draws the map. Two bytes
    // is the least a coordinate pair can occupy, so that is the ceiling.
    const claimed = header >> 3;
    const count = Math.min(claimed, (r.bytes.length - r.pos) >> 1);
    if (command === 1) {
      for (let i = 0; i < count; i++) {
        x += r.svarint();
        y += r.svarint();
        ring = [x, y];
        rings.push(ring);
      }
    } else if (command === 2) {
      if (!ring) return rings;
      for (let i = 0; i < count; i++) {
        x += r.svarint();
        y += r.svarint();
        ring.push(x, y);
      }
    } else if (command === 7) {
      // Closing is implied by the ring being a polygon; nothing to record.
      ring = null;
    } else {
      return rings;
    }
  }
  return rings;
}

function readFeature(bytes, keys, values) {
  const r = new Reader(bytes);
  const feature = { type: 0, properties: {}, rings: [] };
  let tags = null;
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) {
      const packed = new Reader(r.bytesField());
      tags = [];
      while (!packed.done) tags.push(packed.varint());
    } else if (field === 3 && wire === 0) {
      feature.type = r.varint();
    } else if (field === 4 && wire === 2) {
      feature.rings = readGeometry(r.bytesField());
    } else {
      r.skip(wire);
    }
  }
  if (tags) {
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const key = keys[tags[i]];
      if (key !== undefined) feature.properties[key] = values[tags[i + 1]];
    }
  }
  return feature;
}

function readLayer(bytes) {
  const r = new Reader(bytes);
  const layer = { name: '', extent: DEFAULT_EXTENT, features: [] };
  const keys = [];
  const values = [];
  const featureBytes = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) layer.name = r.string();
    else if (field === 2 && wire === 2) featureBytes.push(r.bytesField());
    else if (field === 3 && wire === 2) keys.push(r.string());
    else if (field === 4 && wire === 2) values.push(readValue(r.bytesField()));
    else if (field === 5 && wire === 0) layer.extent = r.varint();
    else r.skip(wire);
  }
  for (const slice of featureBytes) layer.features.push(readFeature(slice, keys, values));
  return layer;
}

/**
 * The layer's name without decoding the rest of it.
 *
 * Worth the second pass: a city tile is most of a megabyte and nine tenths of
 * it is points of interest — every bench, postbox and hairdresser — which a
 * background map does not draw. Reading the name first and then deciding turns
 * a fifty-millisecond decode into a seven-millisecond one.
 */
function peekLayerName(bytes) {
  const r = new Reader(bytes);
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) return r.string();
    r.skip(wire);
  }
  return '';
}

/**
 * Decode one vector tile.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @param {Set<string>|null} wanted layer names to keep, or null for all
 * @returns {Map<string, {name: string, extent: number, features: Array}>}
 */
export function decodeVectorTile(data, wanted = null) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(bytes);
  const layers = new Map();
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 3 && wire === 2) {
      const slice = r.bytesField();
      if (wanted && !wanted.has(peekLayerName(slice))) continue;
      const layer = readLayer(slice);
      layers.set(layer.name, layer);
    } else {
      r.skip(wire);
    }
  }
  return layers;
}
