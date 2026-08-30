"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleSource = void 0;
// Google Custom Search API source
const base_1 = require("../base");
class GoogleSource extends base_1.BaseSource {
    name = "Google";
    id = "google";
    category = "search";
    requiresApiKey = true;
    rateLimit = 100;
    async search(query, options) {
        const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        const cx = process.env.GOOGLE_SEARCH_CX;
        if (!apiKey || !cx)
            return this.fallback(query, options);
        const count = options?.count || 10;
        const res = await this.fetchJson(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(count, 10)}`);
        if (!res?.items)
            return this.fallback(query, options);
        return res.items.map((item) => {
            const nameParts = item.title.split(/[-|–]/)[0].trim().split(" ");
            return this.makeLead({
                firstName: nameParts[0] || "",
                lastName: nameParts.slice(1).join(" ") || "",
                website: item.link,
                company: options?.company,
                title: options?.title,
                confidence: 0.7,
                metadata: { snippet: item.snippet },
            });
        });
    }
    // Aucun résultat inventé : sans clé/CX configurés (ou réponse vide),
    // cette source ne renvoie RIEN plutôt que de faux leads.
    fallback(_query, _options) {
        return [];
    }
    async getCompany(domain) {
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: `Company found via Google search for ${domain}`,
        });
    }
    async getContact(email) {
        const [local, domain] = email.split("@");
        const parts = local.split(/[._-]/);
        return {
            name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
            email,
            company: domain.replace(/\.(com|io|co|org|net)$/, ""),
            confidence: 0.5,
            source: this.name,
        };
    }
}
exports.GoogleSource = GoogleSource;
exports.default = new GoogleSource();
