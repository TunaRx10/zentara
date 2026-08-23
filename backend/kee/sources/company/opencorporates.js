"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenCorporatesSourceSource = void 0;
// OpenCorporates — OpenCorporates API — 140+ country registries (FREE)
const base_1 = require("../base");
class OpenCorporatesSourceSource extends base_1.BaseSource {
    name = "OpenCorporates";
    id = "opencorporates";
    category = "company";
    requiresApiKey = false;
    rateLimit = 5; // Free tier: limited
    async search(query, options) {
        const count = Math.min(options?.count || 10, 30);
        const token = options?.apiToken ? `&api_token=${encodeURIComponent(options.apiToken)}` : '';
        const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}&per_page=${count}${token}`;
        const data = await this.fetchJson(url);
        if (!data?.results?.companies?.length)
            return [];
        const leads = [];
        for (const result of data.results.companies) {
            const co = result.company;
            if (!co.name)
                continue;
            const address = typeof co.registered_address === "string"
                ? co.registered_address
                : [co.registered_address?.street_address, co.registered_address?.locality, co.registered_address?.region, co.registered_address?.country]
                    .filter(Boolean).join(", ");
            // Add company as a lead
            leads.push(this.makeLead({
                firstName: co.name,
                lastName: "",
                company: co.name,
                title: co.company_type || "Registered Company",
                location: address || undefined,
                website: co.url || undefined,
                confidence: 0.7,
                tags: [
                    "company", "opencorporates",
                    co.jurisdiction_code,
                    ...(co.current_status ? [co.current_status.toLowerCase()] : []),
                    ...(co.company_type ? [co.company_type.toLowerCase()] : []),
                ],
                metadata: {
                    source: "OpenCorporates",
                    companyNumber: co.company_number,
                    jurisdiction: co.jurisdiction_code,
                    incorporationDate: co.incorporation_date,
                    inactiveDate: co.inactive_date,
                    status: co.current_status,
                    companyType: co.company_type,
                    registeredAddress: co.registered_address,
                    agent: co.agent?.name,
                    industryCodes: co.industry_codes,
                },
            }));
            // Add directors as separate leads
            if (co.directors?.length) {
                for (const dir of co.directors.slice(0, 3)) {
                    if (!dir.name)
                        continue;
                    const dirParts = dir.name.trim().split(/\s+/);
                    leads.push(this.makeLead({
                        firstName: dirParts[0] || dir.name,
                        lastName: dirParts.length > 1 ? dirParts.slice(1).join(" ") : "",
                        company: co.name,
                        title: dir.position || "Director",
                        confidence: 0.8,
                        tags: ["company", "opencorporates", "director"],
                        metadata: {
                            source: "OpenCorporates",
                            directorPosition: dir.position,
                            startDate: dir.start_date,
                            endDate: dir.end_date,
                            nationality: dir.nationality,
                            companyName: co.name,
                        },
                    }));
                }
            }
        }
        return leads.slice(0, count);
    }
    async getCompany(domain, options) {
        const name = domain.replace(/\.(com|io|co|org|net)$/, "").replace(/-/g, " ");
        const token = options?.apiToken ? `&api_token=${encodeURIComponent(options.apiToken)}` : '';
        const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(name)}&per_page=1${token}`;
        const data = await this.fetchJson(url);
        const co = data?.results?.companies?.[0]?.company;
        if (!co)
            return null;
        const address = typeof co.registered_address === "string"
            ? co.registered_address
            : [co.registered_address?.street_address, co.registered_address?.locality, co.registered_address?.region, co.registered_address?.country]
                .filter(Boolean).join(", ");
        return this.makeCompany({
            name: co.name,
            domain,
            website: co.url || `https://${domain}`,
            founded: co.incorporation_date,
            headquarters: address || undefined,
            industry: co.industry_codes?.[0]?.description || co.company_type,
            metadata: {
                companyNumber: co.company_number,
                jurisdiction: co.jurisdiction_code,
                status: co.current_status,
                companyType: co.company_type,
            },
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
exports.OpenCorporatesSourceSource = OpenCorporatesSourceSource;
exports.default = new OpenCorporatesSourceSource();
