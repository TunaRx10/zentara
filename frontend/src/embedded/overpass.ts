/**
 * overpass.ts — Client Overpass API (OpenStreetMap) direct depuis le navigateur.
 *
 * Overpass est une API REST publique, CORS-friendly, sans clé requise.
 * Interroge la base OpenStreetMap pour trouver des commerces/entreprises.
 *
 * Docs : https://wiki.openstreetmap.org/wiki/Overpass_API
 * Endpoint utilisé : https://overpass-api.de/api/interpreter (CORS ✓)
 */

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OSMResult {
  id: string;
  name: string;
  type: string;
  category: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
  confidence: number;
}

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Requête Overpass avec timeout + retry basique */
async function overpassQuery(query: string, timeoutMs = 15_000): Promise<OverpassElement[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data: OverpassResponse = await res.json();
    return data.elements ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** Transforme un élément OSM en résultat structuré */
function elementToResult(el: OverpassElement): OSMResult {
  const tags = el.tags ?? {};
  const isCompany = /restaurant|shop|office|company|cafe|hotel|lawyer|doctor|dentist|agency|studio|clinic|pharmacy|bank|insurance|real_estate|architect|consulting|accountant|notary|garage|car/i;
  const cat =
    tags.office ?? tags.shop ?? tags.amenity ?? tags.tourism ?? tags.healthcare ?? tags.craft ?? null;

  return {
    id: `osm-${el.type[0]}${el.id}`,
    name: tags.name ?? tags['brand:name'] ?? tags.official_name ?? `OSM ${el.type}/${el.id}`,
    type: 'company',
    category: cat
      ? cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ')
      : null,
    city: tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:suburb'] ?? null,
    country: tags['addr:country'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? tags.url ?? null,
    email: tags.email ?? tags['contact:email'] ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? null,
    lat: el.lat ?? null,
    lon: el.lon ?? null,
    source: 'openstreetmap',
    confidence: 0.8,
  };
}

/**
 * Cherche des commerces/entreprises dans une zone via Overpass.
 *
 * @param query  - type d'activité (ex: "restaurant", "dentist", "office")
 * @param lat    - latitude du centre
 * @param lon    - longitude du centre
 * @param radius - rayon en mètres (défaut 10 000 = 10 km)
 * @param limit  - nombre max de résultats
 */
export async function searchOverpass(
  query: string,
  lat: number,
  lon: number,
  radius = 10_000,
  limit = 30,
): Promise<OSMResult[]> {
  // Construire la requête Overpass QL
  // On cherche nodes + ways avec les tags pertinents autour du point donné
  const qt = query.trim().toLowerCase();

  // Map le terme utilisateur vers des tags OSM
  const tagFilters: string[] = [];
  if (qt.includes('restaurant') || qt.includes('resto')) {
    tagFilters.push('["amenity"="restaurant"]');
  }
  if (qt.includes('hotel') || qt.includes('hôtel')) {
    tagFilters.push('["tourism"="hotel"]');
  }
  if (qt.includes('cafe') || qt.includes('café') || qt.includes('bar')) {
    tagFilters.push('["amenity"~"cafe|bar|pub"]');
  }
  if (qt.includes('dentist') || qt.includes('dentiste')) {
    tagFilters.push('["amenity"="dentist"]');
  }
  if (qt.includes('doctor') || qt.includes('medecin') || qt.includes('médecin')) {
    tagFilters.push('["amenity"~"doctors|clinic|hospital"]');
  }
  if (qt.includes('pharmac')) {
    tagFilters.push('["amenity"="pharmacy"]');
  }
  if (qt.includes('lawyer') || qt.includes('avocat') || qt.includes('notaire')) {
    tagFilters.push('["office"~"lawyer|notary"]');
  }
  if (qt.includes('shop') || qt.includes('magasin') || qt.includes('boutique') || qt.includes('commerce')) {
    tagFilters.push('["shop"~"yes"]');
  }
  if (qt.includes('office') || qt.includes('agence') || qt.includes('studio') || qt.includes('bureau')) {
    tagFilters.push('["office"~"yes"]');
  }
  if (qt.includes('garage') || qt.includes('car') || qt.includes('auto')) {
    tagFilters.push('["shop"~"car_repair|car|tyres"]');
  }
  if (qt.includes('real estate') || qt.includes('immobilier') || qt.includes('agence immo')) {
    tagFilters.push('["office"~"estate_agent|real_estate"]');
  }

  // Si aucun tag spécifique, chercher tout ce qui a un nom + catégorie business
  if (tagFilters.length === 0) {
    tagFilters.push('["office"]');
    tagFilters.push('["shop"]');
    tagFilters.push('["amenity"~"restaurant|cafe|bar|pub|fast_food|ice_cream|dentist|doctors|clinic|pharmacy|bank|coworking_space|conference_centre|marketplace|post_office|veterinary"]');
    tagFilters.push('["tourism"~"hotel|motel|guest_house"]');
    tagFilters.push('["craft"]');
    tagFilters.push('["healthcare"]');
    tagFilters.push('["company"]');
  }

  const queries = tagFilters.map((tf) =>
    `(node${tf}(around:${radius},${lat},${lon});way${tf}(around:${radius},${lat},${lon}););`
  );

  const fullQuery = `[out:json][timeout:15];(${queries.join('')});out body ${limit};`;

  try {
    const elements = await overpassQuery(fullQuery);
    const results = elements
      .filter((el) => el.tags?.name) // seulement ceux avec un nom
      .map(elementToResult)
      .slice(0, limit);
    return results;
  } catch (e) {
    console.warn('[overpass] search failed:', e);
    return [];
  }
}

/**
 * Cherche des entreprises par mot-clé et zone.
 * Version généraliste : combine le nom + la catégorie.
 */
export async function searchOverpassByKeyword(
  keyword: string,
  lat: number,
  lon: number,
  radius = 20_000,
  limit = 30,
): Promise<OSMResult[]> {
  const q = keyword.trim().toLowerCase();
  const escaped = q.replace(/"/g, '\\"');

  // Requête qui combine name match + catégorie business
  const query = `[out:json][timeout:15];
(
  node["name"~"${escaped}",i](around:${radius},${lat},${lon});
  way["name"~"${escaped}",i](around:${radius},${lat},${lon});
);
out body ${Math.min(limit, 50)};
`;

  try {
    const elements = await overpassQuery(query);
    return elements
      .filter((el) => el.tags?.name)
      .map(elementToResult)
      .slice(0, limit);
  } catch (e) {
    console.warn('[overpass] keyword search failed:', e);
    return [];
  }
}

/**
 * Géocode une adresse → coordonnées via Nominatim (gratuit, public, CORS OK).
 * Rate-limited : 1 req/sec max (usage raisonnable).
 */
export async function geocodeNominatim(
  query: string,
): Promise<{ lat: number; lon: number; display_name: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Zentara/1.0 (webapp; contact@zentara.dev)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display_name: data[0].display_name ?? query,
    };
  } catch {
    return null;
  }
}