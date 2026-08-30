"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECEDGARSourceSource = void 0;
// SEC EDGAR — SEC EDGAR filings — US public companies (FREE)
const base_1 = require("../base");
class SECEDGARSourceSource extends base_1.BaseSource {
    name = "SEC EDGAR";
    id = "sec-edgar";
    category = "company";
    requiresApiKey = false;
    rateLimit = 10; // SEC asks for max 10 req/sec
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        // Use the full-text search endpoint
        const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&dateRange=custom&startdt=2020-01-01&enddt=2026-12-31&hits.hits.total=true&hits.hits._source=file_date,display_names,entity_name,entity_type,ciks,file_description,form_type&size=${count}`;
        const data = await this.fetchJson(url, {
            "User-Agent": "KeeLead/1.0 (contact@keelead.com)",
        });
        if (!data?.hits?.hits?.length)
            return [];
        const leads = [];
        const seen = new Set();
        for (const hit of data.hits.hits) {
            const source = hit._source;
            const entityName = source.entity_name;
            if (!entityName || seen.has(entityName))
                continue;
            seen.add(entityName);
            const cik = source.ciks?.[0];
            const displayName = source.display_names?.[0] || entityName;
            const parts = displayName.trim().split(/\s+/);
            // For individuals: try to parse name
            // For companies: use entity name as company
            const isCompany = source.entity_type === "company" || parts.length <= 2;
            if (isCompany) {
                leads.push(this.makeLead({
                    firstName: entityName,
                    lastName: "",
                    company: entityName,
                    title: "SEC Registered Entity",
                    website: cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` : undefined,
                    confidence: 0.7,
                    tags: ["company", "sec-edgar", "public-company", ...(source.form_type ? [source.form_type] : [])],
                    metadata: {
                        source: "SEC EDGAR",
                        entityName,
                        entityType: source.entity_type,
                        cik,
                        fileDate: source.file_date,
                        formType: source.form_type,
                        description: source.file_description,
                    },
                }));
            }
            else {
                leads.push(this.makeLead({
                    firstName: parts[0] || entityName,
                    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
                    company: entityName,
                    confidence: 0.6,
                    tags: ["company", "sec-edgar"],
                    metadata: {
                        source: "SEC EDGAR",
                        entityName,
                        cik,
                        fileDate: source.file_date,
                    },
                }));
            }
        }
        // Enrich first few leads with company details from submissions API
        for (const lead of leads.slice(0, 3)) {
            const cik = lead.metadata?.cik;
            if (!cik)
                continue;
            const paddedCik = cik.padStart(10, "0");
            const subUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
            const sub = await this.fetchJson(subUrl, {
                "User-Agent": "KeeLead/1.0 (contact@keelead.com)",
            });
            if (sub) {
                lead.website = lead.website || sub.website || sub.investorWebsite;
                lead.location = [sub.city, sub.stateLocation].filter(Boolean).join(", ");
                lead.phone = sub.phone;
                lead.metadata = {
                    ...lead.metadata,
                    sic: sub.sic,
                    sicDescription: sub.sicDescription,
                    stateOfIncorporation: sub.stateOfIncorporation,
                    ein: sub.ein,
                    ticker: sub.ticker,
                    exchanges: sub.exchanges,
                };
                if (sub.description) {
                    lead.confidence = 0.8;
                }
            }
        }
        return leads;
    }
    async getCompany(domain) {
        // Search SEC EDGAR for the company name
        const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(domain)}&hits.hits._source=entity_name,ciks&size=1`;
        const data = await this.fetchJson(url, {
            "User-Agent": "KeeLead/1.0 (contact@keelead.com)",
        });
        const hit = data?.hits?.hits?.[0];
        if (!hit?._source?.ciks?.[0])
            return null;
        const cik = hit._source.ciks[0].padStart(10, "0");
        const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
        const sub = await this.fetchJson(subUrl, {
            "User-Agent": "KeeLead/1.0 (contact@keelead.com)",
        });
        if (!sub)
            return null;
        return this.makeCompany({
            name: sub.name,
            domain,
            website: sub.website || `https://${domain}`,
            description: sub.description || sub.sicDescription,
            industry: sub.sicDescription,
            headquarters: [sub.city, sub.stateLocation].filter(Boolean).join(", "),
            metadata: {
                cik: sub.cik,
                ticker: sub.ticker,
                exchanges: sub.exchanges,
                sic: sub.sic,
                stateOfIncorporation: sub.stateOfIncorporation,
                ein: sub.ein,
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
exports.SECEDGARSourceSource = SECEDGARSourceSource;
exports.default = new SECEDGARSourceSource();
