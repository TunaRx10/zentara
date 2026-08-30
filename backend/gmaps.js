// gmaps.js — Local business search 100% gratuit (zéro clé, zéro navigateur)
// Moteur : OpenStreetMap Nominatim (géocodage) + Overpass API (données commerces monde entier)
// + tentative Google Maps (best effort — retourne [] proprement quand Google bloque sans navigateur).
// Mode « rayon » : grille hexagonale de points (pattern GhostMap geo-grid) + requêtes `around`
// par point → couvre un disque entier sans noyer Overpass.
'use strict';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const UA = 'ZentaraResearch/1.0 (lead-intelligence; tunation.fr@gmail.com)';

// ---- Geo-grid (pattern GhostMap) ----
const EARTH_RADIUS_KM = 6371;
const GRID_OPTIMIZER = {
  EFFECTIVE_RADIUS_KM: 4,   // portée utile d'une requête `around` (rayon par tile)
  MIN_OPTIMAL_SPACING: 6.9, // 4 * √3 ≈ 6.9 km — hex packing sans chevauchement
  MAX_GRID_POINTS: 42,      // garde-fou anti-DDoS Overpass (une recherche = max 42 requêtes)
};

const BUSINESS_TYPES = {
  restaurant: ['amenity', 'restaurant'], restaurants: ['amenity', 'restaurant'],
  cafe: ['amenity', 'cafe'], cafes: ['amenity', 'cafe'], 'coffee shop': ['amenity', 'cafe'],
  bar: ['amenity', 'bar'], bars: ['amenity', 'bar'], pub: ['amenity', 'pub'], pubs: ['amenity', 'pub'],
  bakery: ['shop', 'bakery'], bakeries: ['shop', 'bakery'],
  plumber: ['office', 'plumber'], plumbers: ['office', 'plumber'], plomberie: ['office', 'plumber'],
  dentist: ['amenity', 'dentist'], dentists: ['amenity', 'dentist'], 'dentiste': ['amenity', 'dentist'],
  doctor: ['amenity', 'doctors'], doctors: ['amenity', 'doctors'], 'médecin': ['amenity', 'doctors'],
  pharmacy: ['amenity', 'pharmacy'], pharmacies: ['amenity', 'pharmacy'], 'pharmacie': ['amenity', 'pharmacy'],
  hospital: ['amenity', 'hospital'], hospitals: ['amenity', 'hospital'], 'hôpital': ['amenity', 'hospital'],
  bank: ['amenity', 'bank'], banks: ['amenity', 'bank'], 'banque': ['amenity', 'bank'],
  hotel: ['tourism', 'hotel'], hotels: ['tourism', 'hotel'], 'hôtel': ['tourism', 'hotel'],
  gym: ['leisure', 'fitness_centre'], gyms: ['leisure', 'fitness_centre'], 'salle de sport': ['leisure', 'fitness_centre'],
  salon: ['shop', 'hairdresser'], salons: ['shop', 'hairdresser'], 'salon de coiffure': ['shop', 'hairdresser'],
  supermarket: ['shop', 'supermarket'], supermarkets: ['shop', 'supermarket'],
  grocery: ['shop', 'supermarket'], groceries: ['shop', 'supermarket'], 'alimentation': ['shop', 'supermarket'],
  bookstore: ['shop', 'books'], bookstores: ['shop', 'books'], 'librairie': ['shop', 'books'],
  clothing: ['shop', 'clothes'], 'vetements': ['shop', 'clothes'], 'vêtements': ['shop', 'clothes'],
  electronics: ['shop', 'electronics'], 'électroménager': ['shop', 'electronics'],
  furniture: ['shop', 'furniture'], 'meubles': ['shop', 'furniture'],
  lawyer: ['office', 'lawyer'], lawyers: ['office', 'lawyer'], 'avocat': ['office', 'lawyer'],
  attorney: ['office', 'lawyer'],
  'real estate': ['office', 'estate_agent'], 'immobilier': ['office', 'estate_agent'], 'agence immobilière': ['office', 'estate_agent'],
  architect: ['office', 'architect'], architects: ['office', 'architect'], 'architecte': ['office', 'architect'],
  accountant: ['office', 'accountant'], 'comptable': ['office', 'accountant'],
  school: ['amenity', 'school'], schools: ['amenity', 'school'],
  university: ['amenity', 'university'], universities: ['amenity', 'university'],
  car: ['shop', 'car'], 'car repair': ['shop', 'car_repair'], 'garage auto': ['shop', 'car_repair'],
  mechanic: ['shop', 'car_repair'], mechanics: ['shop', 'car_repair'],
  insurance: ['office', 'insurance'], 'assurance': ['office', 'insurance'],
};

function toRadians(deg) {
  return deg * (Math.PI / 180);
}

/** Distance Haversine en km (porté depuis GhostMap lib/geo-grid.js) */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Point à distance/bearing donnés du centre (porté depuis GhostMap background/area-search.js) */
function destPoint(lat, lon, bearingDeg, distKm) {
  const d = distKm / EARTH_RADIUS_KM;
  const b = bearingDeg * Math.PI / 180;
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

/**
 * Grille hexagonale couvrant un disque de `radiusKm` autour du centre (pattern GhostMap).
 * Chaque point pilote une requête `around` de `EFFECTIVE_RADIUS_KM` — le hex packing
 * (espacement ≥ 4√3 ≈ 6.9 km) évite les chevauchements tout en couvrant tout le disque.
 */
function generateGrid(lat, lon, radiusKm, spacingKm) {
  const spacing = Math.max(spacingKm || GRID_OPTIMIZER.MIN_OPTIMAL_SPACING, GRID_OPTIMIZER.MIN_OPTIMAL_SPACING);
  const rowHeight = spacing * Math.sqrt(3) / 2;
  const tile = GRID_OPTIMIZER.EFFECTIVE_RADIUS_KM;
  const points = [];
  for (let y = -radiusKm; y <= radiusKm; y += rowHeight) {
    const rowIndex = Math.round(y / rowHeight);
    const xOffset = (rowIndex % 2) * (spacing / 2);
    for (let x = -radiusKm; x <= radiusKm; x += spacing) {
      const px = x + xOffset;
      const dist = Math.sqrt(px * px + y * y);
      // Le tile entier (centre + portée ~4 km) doit tenir dans le disque demandé.
      if (dist + tile <= radiusKm) {
        points.push({ ...destPoint(lat, lon, Math.atan2(px, y) * 180 / Math.PI, dist), dist });
      }
    }
  }
  // Failsafe : si le rayon est trop petit pour la grille, on cherche depuis le centre.
  if (points.length === 0) points.push({ lat, lon, dist: 0 });
  return points;
}

/** Découpe une requête « type + lieu » : "plumber in Bordeaux", "plombier à Bordeaux", "plumber @ 48.8,2.3" */
function parseQuery(q) {
  q = String(q || '').trim();
  let location = '';
  let term = q;
  const m = q.match(/^(.*?)\s+(?:in|near|at|à|a|chez|de)\s+(.+)$/i) || q.match(/^(.*?)\s+@\s+(.+)$/i);
  if (m) { term = m[1].trim(); location = m[2].trim(); }
  return { term, location };
}

async function geocode(location) {
  if (!location) return null;
  const url = `${NOMINATIM}?q=${encodeURIComponent(location)}&format=json&addressdetails=1&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}

function bboxFrom(geo) {
  if (!geo?.boundingbox) return null;
  const [s, n, w, e] = geo.boundingbox.map(Number);
  return `${s},${w},${n},${e}`;
}

/** Construit la requête Overpass : par type de business connu ou par nom générique */
function buildOverpassQuery(parsed, bbox) {
  const bt = BUSINESS_TYPES[parsed.term.toLowerCase()];
  if (bt) {
    const [k, v] = bt;
    return `[out:json][timeout:18];
(
  node["${k}"="${v}"](${bbox});
  way["${k}"="${v}"](${bbox});
);
out center body 40;`;
  }
  const term = parsed.term.replace(/'/g, "\\'");
  return `[out:json][timeout:18];
(
  node["name"~"${term}",i]["amenity"](${bbox});
  node["name"~"${term}",i]["shop"](${bbox});
  node["name"~"${term}",i]["office"](${bbox});
  node["name"~"${term}",i]["tourism"](${bbox});
  way["name"~"${term}",i]["amenity"](${bbox});
  way["name"~"${term}",i]["shop"](${bbox});
  way["name"~"${term}",i]["office"](${bbox});
  way["name"~"${term}",i]["tourism"](${bbox});
);
out center body 50;`;
}

/**
 * Version « rayon » : bbox dérivée du point de grille + portée du tile.
 * (bbox = requête Overpass beaucoup plus légère que `around:`, donc plus fiable
 * sur les miroirs publics saturés — on garde la couverture grille du geo-grid.)
 */
function buildOverpassRadiusQuery(parsed, lat, lon, radiusMeters) {
  const km = radiusMeters / 1000;
  const dLat = km / 111.0;
  const dLon = km / (111.0 * Math.max(0.3, Math.cos(toRadians(lat))));
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
  const bt = BUSINESS_TYPES[parsed.term.toLowerCase()];
  if (bt) {
    const [k, v] = bt;
    return `[out:json][timeout:18];
(
  node["${k}"="${v}"](${bbox});
  way["${k}"="${v}"](${bbox});
);
out center body 40;`;
  }
  const term = parsed.term.replace(/'/g, "\\'");
  return `[out:json][timeout:18];
(
  node["name"~"${term}",i]["amenity"](${bbox});
  node["name"~"${term}",i]["shop"](${bbox});
  node["name"~"${term}",i]["office"](${bbox});
  node["name"~"${term}",i]["tourism"](${bbox});
  way["name"~"${term}",i]["amenity"](${bbox});
  way["name"~"${term}",i]["shop"](${bbox});
  way["name"~"${term}",i]["office"](${bbox});
  way["name"~"${term}",i]["tourism"](${bbox});
);
out center body 50;`;
}

async function queryOverpass(query) {
  // Les serveurs Overpass publics sont intermittents → retry sur plusieurs miroirs + réessais.
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const j = await res.json();
      if (Array.isArray(j.elements)) return j;
      if (j.remark) { lastErr = new Error(j.remark); continue; }
      return { elements: [] };
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return { elements: [], overpass_error: lastErr ? String(lastErr.message) : 'indisponible' };
}

function cleanHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function elementToLead(el, geo, parsedTerm) {
  const t = el.tags || {};
  const name = t.name || t['name:fr'] || '';
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  const addr = ['housenumber', 'street', 'postcode', 'city'].map(k => t['addr:' + k]).filter(Boolean).join(', ') || null;
  const phone = t.phone || t['contact:phone'] || null;
  const rawWeb = t.website || t['contact:website'] || t['contact:web'] || null;
  const website = rawWeb && !rawWeb.startsWith('http') ? 'https://' + rawWeb : rawWeb;
  const email = t.email || t['contact:email'] || null;
  const confidence = Math.min(0.98, 0.72 + (phone ? 0.12 : 0) + (website ? 0.14 : 0));
  return {
    name,
    category: t.amenity || t.shop || t.office || t.tourism || t.leisure || parsedTerm || 'business',
    address: addr,
    city: t['addr:city'] || t['addr:town'] || geo?.address?.city || geo?.address?.town || null,
    country: geo?.address?.country || null,
    phone,
    website,
    email,
    rating: null,
    reviews_count: null,
    google_maps_url: lat && lon ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}@${lat},${lon}`)}` : null,
    lat, lon,
    source: 'openstreetmap',
    confidence,
    tags: ['local', 'osm'],
  };
}

/** Google Maps best-effort via HTML brut (sans navigateur) — souvent bloqué, retourne [] proprement */
async function googleBestEffort(query) {
  try {
    const res = await fetch(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) + '&hl=fr',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
          Cookie: 'CONSENT=YES+cb.20210328-17-p0.fr+FX+419',
        },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const found = [];
    const re = /<a[^>]+href="(\/maps\/place\/[^"]+)"[^>]*aria-label="([^"]{3,300})"/g;
    let m;
    while ((m = re.exec(html)) && found.length < 25) {
      found.push({ name: cleanHtml(m[2]), google_maps_url: 'https://www.google.com' + m[1].replace(/&amp;/g, '&'), source: 'google-maps' });
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * Recherche par rayon + grille de points (pattern GhostMap geo-grid).
 * Géocode le centre, génère une grille hexagonale, puis interroge Overpass
 * (`around:4km` par point) et déduplique les résultats.
 * @param {{query:string, location?:string, radiusKm?:number, limit?:number}} opts
 */
async function searchByRadius({ query, location, radiusKm, limit }) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 80));
  const radius = Math.max(1, Math.min(Number(radiusKm) || 15, 80)); // km, borné 1..80
  const parsed = parseQuery(query);
  let geo = await geocode(location || parsed.location);
  if (!geo && location) geo = await geocode(query);
  if (!geo) geo = await geocode(parsed.location || 'Paris');

  const centerLat = Number(geo?.lat ?? 48.8566);
  const centerLon = Number(geo?.lon ?? 2.3522);

  let points = generateGrid(centerLat, centerLon, radius, GRID_OPTIMIZER.MIN_OPTIMAL_SPACING);
  points = points.slice(0, GRID_OPTIMIZER.MAX_GRID_POINTS);

  const seen = new Set();
  const leads = [];
  const tileMeters = Math.round(GRID_OPTIMIZER.EFFECTIVE_RADIUS_KM * 1000);
  for (const pt of points) {
    if (leads.length >= n) break;
    const res = await queryOverpass(buildOverpassRadiusQuery(parsed, pt.lat, pt.lon, tileMeters));
    for (const el of res.elements || []) {
      const lead = elementToLead(el, geo, parsed.term);
      if (!lead) continue;
      const key = `${lead.name}|${lead.address || ''}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (lead.lat != null && lead.lon != null) {
        lead.distance_km = Math.round(haversineDistance(centerLat, centerLon, lead.lat, lead.lon) * 10) / 10;
      }
      leads.push(lead);
      if (leads.length >= n) break;
    }
  }
  leads.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));

  const place = geo?.display_name ? geo.display_name.split(',').slice(0, 3).join(', ') : null;
  return {
    source: 'openstreetmap',
    radius_km: radius,
    grid_points: points.length,
    reason: leads.length
      ? `${leads.length} commerces réels trouvés dans un rayon de ${radius} km${place ? ' autour de « ' + place + ' »' : ''} (grille de ${points.length} points)`
      : `Aucun résultat dans un rayon de ${radius} km — les serveurs Overpass sont saturés actuellement, réessayez dans quelques minutes ou réduisez le rayon.`,
    leads: leads.slice(0, n),
  };
}

/**
 * Recherche locale multi-engins (gratuite, sans clé).
 * Si `radiusKm` est fourni → recherche par rayon + grille (geo-grid), sinon bbox classique.
 * @param {{query:string, location?:string, radiusKm?:number, limit?:number}} opts
 */
async function searchLocal({ query, location, radiusKm, limit }) {
  if (radiusKm && Number(radiusKm) > 0) {
    return searchByRadius({ query, location, radiusKm, limit });
  }
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const parsed = parseQuery(query);
  let geo = await geocode(location || parsed.location);
  if (!geo && location) geo = await geocode(query);
  if (!geo) geo = await geocode(parsed.location || 'Paris');

  let leads = [];
  let source = 'openstreetmap';
  const bbox = bboxFrom(geo);
  if (bbox) {
    const res = await queryOverpass(buildOverpassQuery(parsed, bbox));
    for (const el of res.elements || []) {
      const lead = elementToLead(el, geo, parsed.term);
      if (lead) { leads.push(lead); if (leads.length >= n) break; }
    }
  }

  // Complément Google best-effort si Overpass n'a rien donné
  if (leads.length === 0) {
    const tag = `${parsed.term} ${geo?.display_name || ''}`.trim();
    const g = await googleBestEffort(tag);
    for (const gl of g) {
      leads.push({ ...gl, category: parsed.term || null });
      if (leads.length >= n) break;
    }
    if (g.length > 0) source = 'google-maps (best effort)';
  }

  const place = geo?.display_name ? geo.display_name.split(',').slice(0, 3).join(', ') : null;
  return {
    source,
    reason: leads.length
      ? `${leads.length} commerces réels trouvés${place ? ' près de « ' + place + ' »' : ''}`
      : 'Aucun résultat — les serveurs Overpass sont saturés actuellement, réessayez dans quelques minutes ou changez de zone.',
    leads: leads.slice(0, n),
  };
}

module.exports = { searchLocal, searchByRadius, geocode, parseQuery, googleBestEffort, generateGrid, haversineDistance };
