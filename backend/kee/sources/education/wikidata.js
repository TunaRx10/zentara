"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikidataSource = void 0;
// Wikidata SPARQL — Free company/people data from world's largest knowledge base
const base_1 = require("../base");
class WikidataSource extends base_1.BaseSource {
    name = "Wikidata";
    id = "wikidata";
    category = "company";
    requiresApiKey = false;
    rateLimit = 10; // Wikidata asks for polite usage
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        const results = await this.queryCompanies(query, count);
        if (!results.length)
            return [];
        return results.map((r) => {
            const name = r.companyLabel?.value || "";
            const parts = name.trim().split(/\s+/);
            return this.makeLead({
                firstName: parts[0] || name,
                lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
                company: name,
                title: r.industryLabel?.value || "Company",
                website: r.website?.value,
                location: r.headquartersLabel?.value,
                confidence: r.website?.value ? 0.7 : 0.5,
                tags: [
                    "company",
                    "wikidata",
                    ...(r.industryLabel?.value ? [r.industryLabel.value] : []),
                    ...(r.countryLabel?.value ? [r.countryLabel.value] : []),
                ],
                metadata: {
                    source: "Wikidata",
                    wikidataUri: r.company?.value,
                    industry: r.industryLabel?.value,
                    founded: r.inception?.value?.split("T")[0], // ISO date
                    headquarters: r.headquartersLabel?.value,
                    website: r.website?.value,
                    employees: r.numberOfEmployees?.value,
                    ceo: r.ceoLabel?.value,
                    country: r.countryLabel?.value,
                },
            });
        });
    }
    async getCompany(domain) {
        // Search by domain name as company name
        const companyName = domain.replace(/\.(com|io|co|org|net|dev|ai)$/, "");
        const results = await this.queryCompanies(companyName, 5);
        if (!results.length)
            return null;
        const best = results[0];
        const name = best.companyLabel?.value || companyName;
        return this.makeCompany({
            name,
            domain,
            website: best.website?.value || `https://${domain}`,
            description: best.description?.value,
            industry: best.industryLabel?.value,
            headquarters: best.headquartersLabel?.value,
            founded: best.inception?.value?.split("T")[0],
            metadata: {
                source: "Wikidata",
                wikidataUri: best.company?.value,
                employees: best.numberOfEmployees?.value,
                ceo: best.ceoLabel?.value,
                country: best.countryLabel?.value,
            },
        });
    }
    async getContact(email) {
        const domain = email.split("@")[1];
        if (!domain)
            return null;
        const companyName = domain.replace(/\.(com|io|co|org|net|dev|ai)$/, "");
        const results = await this.queryCompanies(companyName, 1);
        if (!results.length)
            return null;
        const [local] = email.split("@");
        const parts = local.split(/[._-]/);
        return {
            name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
            email,
            company: results[0].companyLabel?.value || companyName,
            confidence: 0.4,
            source: this.name,
        };
    }
    async queryCompanies(query, limit) {
        const sparql = `
      SELECT ?company ?companyLabel ?industryLabel ?inception ?headquartersLabel ?website ?description ?numberOfEmployees ?ceoLabel ?countryLabel WHERE {
        ?company wdt:P31/wdt:P279* wd:Q783794 .
        ?company rdfs:label ?companyLabel .
        FILTER(LANG(?companyLabel) = "en")
        FILTER(CONTAINS(LCASE(?companyLabel), LCASE("${this.escapeSparql(query)}")))
        OPTIONAL { ?company wdt:P452 ?industry }
        OPTIONAL { ?company wdt:P571 ?inception }
        OPTIONAL { ?company wdt:P159 ?headquarters }
        OPTIONAL { ?company wdt:P856 ?website }
        OPTIONAL { ?company schema:description ?description . FILTER(LANG(?description) = "en") }
        OPTIONAL { ?company wdt:P1128 ?numberOfEmployees }
        OPTIONAL { ?company wdt:P169 ?ceo }
        OPTIONAL { ?company wdt:P17 ?country }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      }
      LIMIT ${limit}
    `.trim();
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`;
        try {
            const res = await fetch(url, {
                headers: {
                    Accept: "application/sparql-results+json",
                    "User-Agent": "KeeLead/1.0 (https://keelead.com; contact@keelead.com)",
                },
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok)
                return [];
            const data = (await res.json());
            return data.results?.bindings || [];
        }
        catch {
            return [];
        }
    }
    escapeSparql(input) {
        // Escape special characters for SPARQL string literals
        return input
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r");
    }
}
exports.WikidataSource = WikidataSource;
exports.default = new WikidataSource();
