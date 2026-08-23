"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORCIDSourceSource = void 0;
// ORCID — ORCID researcher IDs
const base_1 = require("../base");
class ORCIDSourceSource extends base_1.BaseSource {
    name = "ORCID";
    id = "orcid";
    category = "education";
    requiresApiKey = false;
    rateLimit = 30;
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        const url = `https://pub.orcid.org/v3.0/search/?q=${encodeURIComponent(query)}&rows=${count}`;
        const data = await this.fetchJson(url, { Accept: "application/json" });
        if (!data?.result?.length)
            return [];
        const leads = [];
        for (const entry of data.result) {
            const orcidId = entry["orcid-identifier"];
            if (!orcidId?.path)
                continue;
            // Fetch person details
            const personUrl = `https://pub.orcid.org/v3.0/${orcidId.path}/person`;
            const person = await this.fetchJson(personUrl, { Accept: "application/json" });
            // Fetch employments
            const empUrl = `https://pub.orcid.org/v3.0/${orcidId.path}/employments`;
            const employments = await this.fetchJson(empUrl, { Accept: "application/json" });
            const firstName = person?.name?.["given-names"]?.value || "";
            const lastName = person?.name?.["family-name"]?.value || "";
            if (!firstName && !lastName)
                continue;
            const email = person?.emails?.email?.find(e => e.primary)?.email
                || person?.emails?.email?.[0]?.email;
            // Get current employment
            let company;
            let title;
            const affiliations = employments?.["affiliation-group"] || [];
            for (const aff of affiliations) {
                const summary = aff["employment-summary"];
                if (summary?.organization?.name) {
                    company = summary.organization.name;
                    title = summary["role-title"]?.value;
                    break; // Take most recent
                }
            }
            leads.push(this.makeLead({
                firstName,
                lastName,
                email,
                company: company || options?.company,
                title: title || "Researcher",
                website: orcidId.uri,
                confidence: email ? 0.85 : 0.7,
                tags: ["education", "researcher", "orcid"],
                metadata: {
                    source: "ORCID",
                    orcidId: orcidId.path,
                    orcidUrl: orcidId.uri,
                },
            }));
        }
        return leads;
    }
    async getCompany(domain) {
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: "Company data from ORCID",
            industry: "Education",
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
exports.ORCIDSourceSource = ORCIDSourceSource;
exports.default = new ORCIDSourceSource();
