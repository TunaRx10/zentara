/**
 * Sync Service — couche de synchronisation hybride frontend ↔ backend.
 *
 * Le frontend garde sa propre SQLite (Capacitor) comme source de vérité
 * offline. Lorsqu'il est online, on tente de **propager** les changements
 * vers le backend (qui de son côté miroir dans une autre SQLite).
 *
 * Round 8 — sync hybride.
 *
 * Stratégie "best-effort" :
 *   - `syncProspect(p)` : POST /api/prospects  (fire-and-forget)
 *   - `syncCompany(p)`  : POST /api/companies
 *   - `syncContact(p)`  : POST /api/contacts
 *   - En cas d'échec (offline, 5xx) → on `dispatchEvent('zentara:sync-failed')`
 *     pour que l'UI puisse afficher un badge "local-only".
 *
 * PAS de queue persistante pour V1 — si VRAIMENT offline, l'utilisateur
 * garde sa donnée locale intacte et peut re-tenter plus tard (round suivant).
 *
 * Note : le backend ID utilisé sera différent du local ID si `localId` est
 * préfixé différemment (les deux schemas utilisent `usr_/pros_/comp_/cnt_/camp_`
 * donc pas de conflit en pratique).
 */
import { getApiClient, ENDPOINTS, ZentaraApiError } from '../api/client';
import { Prospect, Company, Contact } from '@/types';

export interface SyncOutcome {
  ok: boolean;
  error?: ZentaraApiError;
}

async function safePost<T>(path: string, body: unknown): Promise<SyncOutcome> {
  try {
    const api = getApiClient();
    await api.post<T>(path, body, { retries: 1, timeoutMs: 8_000 });
    return { ok: true };
  } catch (err) {
    if (err instanceof ZentaraApiError) {
      try {
        window.dispatchEvent(new CustomEvent('zentara:sync-failed', { detail: { path, error: err.code } }));
      } catch (_e) { /* SSR */ }
      return { ok: false, error: err };
    }
    throw err;
  }
}

export const syncService = {
  /** Propage un prospect local vers le backend. */
  async syncProspect(p: Prospect): Promise<SyncOutcome> {
    return safePost(ENDPOINTS.prospectsList, {
      id: p.id,
      company_id: p.company_id,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      phone: p.phone,
      sector: p.sector,
      address: p.address,
      city: p.city,
      country: p.country,
      website: p.website,
      social_profiles: p.social_profiles,
      google_maps_url: null,
      score: p.score ?? 0,
      status: p.status,
      notes: p.notes,
    });
  },

  async syncCompany(c: Company): Promise<SyncOutcome> {
    return safePost(ENDPOINTS.companiesList, {
      id: c.id,
      name: c.name,
      website: c.website,
      sector: c.sector,
      industry: c.sector,
      address: undefined,
      city: c.location,
      country: undefined,
      phone: c.phone,
      email: c.email,
      score: c.score ?? 0,
      status: c.status === 'active' ? 'active' : 'new',
      notes: undefined,
      social_profiles: undefined,
      google_maps_url: undefined,
    });
  },

  async syncContact(c: Contact): Promise<SyncOutcome> {
    return safePost(ENDPOINTS.contactsList, {
      id: c.id,
      company_id: c.company_id,
      first_name: c.first_name,
      last_name: c.last_name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      social_profiles: c.linkedin_url,
      status: 'active',
      notes: c.notes,
    });
  },

  /** Synchronise plusieurs prospects (best-effort, séquentiel). */
  async syncProspectsBatch(prospects: Prospect[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    for (const p of prospects) {
      const outcome = await syncService.syncProspect(p);
      if (outcome.ok) success += 1;
      else failed += 1;
    }
    return { success, failed };
  },
};
