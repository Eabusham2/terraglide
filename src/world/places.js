/**
 * Somewhere with people in it.
 *
 * Random teleport over the whole planet lands you in empty desert or tundra
 * most of the time, because most of the planet is empty. With *populated
 * places* switched on, the draw comes from this list instead — a spread of
 * cities and towns across every inhabited region — and the point is jittered by
 * a few kilometres so you get a different street, edge of town or hillside above
 * the place each time rather than the exact same rooftop.
 *
 * It is deliberately a built-in list: it works with no network, no key and no
 * rate limit, which is the same promise the rest of the game makes.
 */

import { destination } from '../geo/mercator.js';

/** [name, latitude, longitude] */
const PLACES = [
  // Europe
  ['London', 51.5074, -0.1278], ['Paris', 48.8566, 2.3522], ['Madrid', 40.4168, -3.7038],
  ['Rome', 41.9028, 12.4964], ['Berlin', 52.52, 13.405], ['Vienna', 48.2082, 16.3738],
  ['Prague', 50.0755, 14.4378], ['Amsterdam', 52.3676, 4.9041], ['Copenhagen', 55.6761, 12.5683],
  ['Stockholm', 59.3293, 18.0686], ['Oslo', 59.9139, 10.7522], ['Helsinki', 60.1699, 24.9384],
  ['Reykjavik', 64.1466, -21.9426], ['Dublin', 53.3498, -6.2603], ['Edinburgh', 55.9533, -3.1883],
  ['Lisbon', 38.7223, -9.1393], ['Barcelona', 41.3874, 2.1686], ['Zurich', 47.3769, 8.5417],
  ['Innsbruck', 47.2692, 11.4041], ['Venice', 45.4408, 12.3155], ['Athens', 37.9838, 23.7275],
  ['Istanbul', 41.0082, 28.9784], ['Warsaw', 52.2297, 21.0122], ['Budapest', 47.4979, 19.0402],
  ['Kyiv', 50.4501, 30.5234], ['Bucharest', 44.4268, 26.1025], ['Bergen', 60.3913, 5.3221],
  ['Porto', 41.1579, -8.6291], ['Naples', 40.8518, 14.2681], ['Tromso', 69.6492, 18.9553],

  // Africa
  ['Cairo', 30.0444, 31.2357], ['Marrakesh', 31.6295, -7.9811], ['Casablanca', 33.5731, -7.5898],
  ['Lagos', 6.5244, 3.3792], ['Accra', 5.6037, -0.187], ['Nairobi', -1.2921, 36.8219],
  ['Addis Ababa', 9.032, 38.7469], ['Dar es Salaam', -6.7924, 39.2083], ['Kampala', 0.3476, 32.5825],
  ['Cape Town', -33.9249, 18.4241], ['Johannesburg', -26.2041, 28.0473], ['Windhoek', -22.5609, 17.0658],
  ['Dakar', 14.7167, -17.4677], ['Tunis', 36.8065, 10.1815], ['Antananarivo', -18.8792, 47.5079],
  ['Luanda', -8.839, 13.2894], ['Khartoum', 15.5007, 32.5599], ['Abidjan', 5.36, -4.0083],

  // Asia
  ['Tokyo', 35.6762, 139.6503], ['Kyoto', 35.0116, 135.7681], ['Seoul', 37.5665, 126.978],
  ['Beijing', 39.9042, 116.4074], ['Shanghai', 31.2304, 121.4737], ['Hong Kong', 22.3193, 114.1694],
  ['Taipei', 25.033, 121.5654], ['Manila', 14.5995, 120.9842], ['Singapore', 1.3521, 103.8198],
  ['Bangkok', 13.7563, 100.5018], ['Hanoi', 21.0278, 105.8342], ['Kuala Lumpur', 3.139, 101.6869],
  ['Jakarta', -6.2088, 106.8456], ['Delhi', 28.6139, 77.209], ['Mumbai', 19.076, 72.8777],
  ['Bengaluru', 12.9716, 77.5946], ['Kolkata', 22.5726, 88.3639], ['Kathmandu', 27.7172, 85.324],
  ['Colombo', 6.9271, 79.8612], ['Dhaka', 23.8103, 90.4125], ['Lahore', 31.5204, 74.3587],
  ['Tashkent', 41.2995, 69.2401], ['Almaty', 43.222, 76.8512], ['Tbilisi', 41.7151, 44.8271],
  ['Dubai', 25.2048, 55.2708], ['Muscat', 23.588, 58.3829], ['Tehran', 35.6892, 51.389],
  ['Ulaanbaatar', 47.8864, 106.9057], ['Vladivostok', 43.1332, 131.9113], ['Novosibirsk', 55.0084, 82.9357],
  ['Yekaterinburg', 56.8389, 60.6057], ['Moscow', 55.7558, 37.6173], ['Baku', 40.4093, 49.8671],

  // Oceania
  ['Sydney', -33.8688, 151.2093], ['Melbourne', -37.8136, 144.9631], ['Brisbane', -27.4698, 153.0251],
  ['Perth', -31.9505, 115.8605], ['Auckland', -36.8485, 174.7633], ['Wellington', -41.2866, 174.7756],
  ['Queenstown', -45.0312, 168.6626], ['Hobart', -42.8821, 147.3272], ['Suva', -18.1416, 178.4419],
  ['Port Moresby', -9.4438, 147.1803], ['Honolulu', 21.3069, -157.8583], ['Cairns', -16.9186, 145.7781],

  // North America
  ['New York', 40.7128, -74.006], ['Chicago', 41.8781, -87.6298], ['Toronto', 43.6532, -79.3832],
  ['Montreal', 45.5017, -73.5673], ['Vancouver', 49.2827, -123.1207], ['Seattle', 47.6062, -122.3321],
  ['San Francisco', 37.7749, -122.4194], ['Los Angeles', 34.0522, -118.2437], ['Denver', 39.7392, -104.9903],
  ['Salt Lake City', 40.7608, -111.891], ['Santa Fe', 35.687, -105.9378], ['Austin', 30.2672, -97.7431],
  ['New Orleans', 29.9511, -90.0715], ['Miami', 25.7617, -80.1918], ['Boston', 42.3601, -71.0589],
  ['Mexico City', 19.4326, -99.1332], ['Guadalajara', 20.6597, -103.3496], ['Havana', 23.1136, -82.3666],
  ['Guatemala City', 14.6349, -90.5069], ['Panama City', 8.9824, -79.5199], ['Anchorage', 61.2181, -149.9003],
  ['Reno', 39.5296, -119.8138], ['Quebec City', 46.8139, -71.208], ['St John\'s', 47.5615, -52.7126],

  // South America
  ['Bogota', 4.711, -74.0721], ['Quito', -0.1807, -78.4678], ['Lima', -12.0464, -77.0428],
  ['La Paz', -16.4897, -68.1193], ['Santiago', -33.4489, -70.6693], ['Buenos Aires', -34.6037, -58.3816],
  ['Montevideo', -34.9011, -56.1645], ['Sao Paulo', -23.5505, -46.6333], ['Rio de Janeiro', -22.9068, -43.1729],
  ['Salvador', -12.9777, -38.5016], ['Manaus', -3.119, -60.0217], ['Cusco', -13.5319, -71.9675],
  ['Ushuaia', -54.8019, -68.3029], ['Caracas', 10.4806, -66.9036], ['Asuncion', -25.2637, -57.5759],
];

/** How far from the centre a drop can land, in metres. */
const JITTER_M = 14000;

export const PLACE_COUNT = PLACES.length;

/**
 * A random inhabited place, nudged a few kilometres off centre so repeat
 * visits are not the same rooftop.
 */
export function randomPopulatedPlace(rng = Math.random) {
  const [name, lat, lon] = PLACES[Math.floor(rng() * PLACES.length) % PLACES.length];
  const point = destination({ lat, lon }, rng() * Math.PI * 2, JITTER_M * Math.sqrt(rng()));
  return { ...point, name };
}

export { PLACES };
