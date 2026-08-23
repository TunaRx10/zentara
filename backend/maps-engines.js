// maps-engines.js — Moteurs Maps optionnels (clés requises) : Google Places, SerpAPI, Outscraper
// Chaque moteur normalise vers la même forme MapsLead que gmaps.js (source locale gratuite).
'use strict';

const GMAPS = require('./gmaps');

const GOOGLE_PLACES = 'https://maps.googleapis.com/maps/api/place';
const SERPAPI = 'https://serpapi.com/search.json';
const OUTSCRAPER = 'https://api.app.outscraper.com/maps/search-v3';

function clampN(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function toLead(raw, source) {
  const name = String(raw.name || raw.title || '').trim();
  if (!name) return null;
  const lat = raw.lat ?? raw.latitude ?? raw.geometry?.location?.lat ?? null;
  const lng = raw.lng ?? raw.longitude ?? raw.geometry?.location?.lng ?? null;
  const address = String(raw.address || raw.full_address || raw.formatted_address || '').trim() || null;
  const phone = String(raw.phone || raw.international_phone_number || raw.formatted_phone_number || '').trim() || null;
  const website = String(raw.website || raw.site || '').trim() || null;
  const category = raw.category || (Array.isArray(raw.types) ? raw.types[0] : null) || raw.type || null;
  return {
    name,
    category: category || null,
    address,
    city: raw.city || null,
    country: raw.country || null,
    phone: phone || null,
    website: website || null,
    email: raw.email || null,
    rating: raw.rating != null ? clampN(raw.rating) : null,
    reviews_count: raw.reviews_count != null ? Math.round(clampN(raw.reviews_count)) : (raw.reviews != null ? Math.round(clampN(raw.reviews)) : null),
    google_maps_url: raw.google_maps_url || (raw.maps_url || null) || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}@${lat},${lng}`)}` : null),
    lat, lon: lng,
    source,
    confidence: 0.85 + (phone ? 0.08 : 0) + (website ? 0.07 : 0),
    tags: ['maps', source],
  };
}

async function getJson(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function postJson(url, body, headers = {}, timeoutMs = 20000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/** Géocodage optionnel via Google (si la clé Places est disponible) ou Nominatim. */
async function resolveLatLng(location, placesKey) {
  if (!location) return null;
  if (placesKey) {
    try {
      const j = await getJson(`${GOOGLE_PLACES}/geocode/json?address=${encodeURIComponent(location)}&key=${encodeURIComponent(placesKey)}`);
      const loc = j?.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lng: loc.lng };
    } catch { /* fallback Nominatim */ }
  }
  const g = await GMAPS.geocode(location);
  return g && g.lat && g.lon ? { lat: Number(g.lat), lng: Number(g.lon) } : null;
}

/**
 * Google Places API (textsearch + details pour tél/site).
 */
async function googlePlacesSearch({ query, location, limit, key }) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const ll = await resolveLatLng(location, key);
  let url = `${GOOGLE_PLACES}/textsearch/json?query=${encodeURIComponent(query)}&language=fr&key=${encodeURIComponent(key)}`;
  if (ll) url += `&location=${ll.lat},${ll.lng}&radius=50000`;
  const j = await getJson(url);
  if (j.status === 'REQUEST_DENIED') throw new Error(`Google Places : ${j.error_message || 'clé refusée'}`);
  const items = Array.isArray(j.results) ? j.results.slice(0, n) : [];
  const leads = [];
  // Détails (téléphone + site) pour chaque fiche — concurrency limitée
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      const r = items[i];
      let phone = null;
      let website = null;
      try {
        const d = await getJson(`${GOOGLE_PLACES}/details/json?place_id=${encodeURIComponent(r.place_id)}&fields=formatted_phone_number,international_phone_number,website&key=${encodeURIComponent(key)}`, 12000);
        phone = d?.result?.international_phone_number || d?.result?.formatted_phone_number || null;
        website = d?.result?.website || null;
      } catch { /* fiche sans détails */ }
      const lead = toLead({
        name: r.name,
        formatted_address: r.formatted_address,
        rating: r.rating,
        reviews_count: r.user_ratings_total,
        geometry: r.geometry,
        types: r.types,
        phone,
        website,
      }, 'google-places');
      if (lead) leads.push(lead);
    }
  };
  await Promise.allSettled([worker(), worker(), worker(), worker()]);
  return leads.slice(0, n);
}

/**
 * SerpAPI — moteur google_maps.
 */
async function serpapiSearch({ query, location, limit, key }) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const ll = await resolveLatLng(location);
  let url = `${SERPAPI}?engine=google_maps&type=search&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}`;
  if (ll) url += `&ll=@${ll.lat},${ll.lng},14z`;
  const j = await getJson(url, 25000);
  if (j.error) throw new Error(`SerpAPI : ${j.error}`);
  const items = Array.isArray(j.local_results) ? j.local_results : [];
  return items.slice(0, n).map((r) => toLead({
    name: r.title,
    address: r.address,
    phone: r.phone,
    website: r.website,
    rating: r.rating,
    reviews: r.reviews,
    latitude: r.latitude,
    longitude: r.longitude,
    category: r.type,
    google_maps_url: r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : null,
  }, 'serpapi')).filter(Boolean);
}

/**
 * Outscraper — maps/search-v3.
 */
async function outscraperSearch({ query, location, limit, key }) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const q = location ? `${query} in ${location}` : query;
  const url = `${OUTSCRAPER}?query=${encodeURIComponent(q)}&limit=${n}&async=false&apiKey=${encodeURIComponent(key)}`;
  const j = await getJson(url, 30000);
  if (j.error) throw new Error(`Outscraper : ${j.error}`);
  const items = Array.isArray(j.data) ? j.data : [];
  return items.slice(0, n).map((r) => toLead({
    name: r.name,
    full_address: r.full_address,
    phone: r.phone,
    site: r.site,
    rating: r.rating,
    reviews: r.reviews,
    latitude: r.latitude,
    longitude: r.longitude,
    category: r.category,
    maps_url: r.maps_url || null,
  }, 'outscraper')).filter(Boolean);
}

/**
 * Google Places API (New) — endpoint searchText (fusion du repo gmaps-leads).
 * Plus riche que l'ancienne textsearch : tél/site/note remontent directement,
 * sans second appel details.
 */
const PLACES_NEW = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_NEW_FIELDS = [
  'places.displayName', 'places.primaryType', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.location', 'places.googleMapsUri',
].join(',');

async function googlePlacesNewSearch({ query, location, limit, key }) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 60));
  const textQuery = location ? `${query} in ${location}` : query;
  const j = await postJson(
    PLACES_NEW,
    { textQuery, pageSize: n, languageCode: 'fr' },
    { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACES_NEW_FIELDS },
    20000,
  );
  if (j.error) throw new Error(`Google Places New : ${j.error.message || j.error.status}`);
  const items = Array.isArray(j.places) ? j.places : [];
  return items.slice(0, n).map((p) => toLead({
    name: p.displayName?.text,
    formatted_address: p.formattedAddress,
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    reviews_count: p.userRatingCount,
    latitude: p.location?.latitude,
    longitude: p.location?.longitude,
    google_maps_url: p.googleMapsUri,
    category: String(p.primaryType || '').replace(/_/g, ' '),
  }, 'google-places-new')).filter(Boolean);
}

module.exports = { googlePlacesSearch, googlePlacesNewSearch, serpapiSearch, outscraperSearch };