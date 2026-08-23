"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkedinLiveSource = void 0;
// Zentara People — recherche LinkedIn réelle via StaffSpy (roster d'entreprise + recherche par niche).
// OPT-IN : `enabled = false` par défaut car nécessite une session LinkedIn authentifiée.
// Déclenché explicitement via POST /api/search/linkedin (backend/linkedin.js → linkedin-bridge.py).
const base_1 = require("../base");
const LINKEDIN = require("../../../linkedin");
class LinkedinLiveSource extends base_1.BaseSource {
    name = "Zentara People";
    id = "linkedin-live";
    category = "professional";
    requiresApiKey = false;
    enabled = false; // opt-in : session LinkedIn requise
    rateLimit = 2; // scraping lent, on limite
    async search(query, options) {
        if (!this.enabled) return [];
        const r = await LINKEDIN.searchPeople(query, {
            roles: options?.title,
            location: options?.location,
            limit: options?.count || 15,
            timeoutMs: 120000,
        });
        if (!r.ok) return [];
        return (r.leads || []).map((l) => this.makeLead({ ...l, source: this.name }));
    }
    async getCompany(domain) {
        if (!this.enabled) return null;
        const name = domain.replace(/\.(com|io|co|org|net|fr|dev)$/, "").replace(/-/g, " ");
        const r = await LINKEDIN.searchStaff(name, { limit: 25, timeoutMs: 120000 });
        if (!r.ok || !r.leads?.length) return null;
        return this.makeCompany({
            name,
            domain,
            website: `https://${domain}`,
            description: `${r.leads.length} employés/décideurs trouvés via LinkedIn (StaffSpy).`,
            metadata: { source: "Zentara People (StaffSpy)", staffCount: r.leads.length },
        });
    }
    async getContact(email) {
        return null; // l'enrichissement contact passe par le roster, pas par email
    }
}
exports.LinkedinLiveSource = LinkedinLiveSource;
exports.default = new LinkedinLiveSource();
