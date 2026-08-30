"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearXNGSourceSource = void 0;
// SearXNG — Meta search engine aggregating results from multiple engines
const base_1 = require("../base");
class SearXNGSourceSource extends base_1.BaseSource {
    name = "SearXNG";
    id = "searxng";
    category = "search";
    requiresApiKey = false;
    rateLimit = 60;
    // Public SearXNG instances that support JSON API
    INSTANCES = [
        "https://searx.be",
        "https://search.sapti.me",
        "https://searxng.site",
        "https://search.bus-hit.me",
        "https://searx.work",
        "https://search.ononoki.org",
        "https://searx.tuxcloud.net",
    ];
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        // Try each instance until one works
        for (const instance of this.INSTANCES) {
            const leads = await this.tryInstance(instance, query, count, options);
            if (leads.length > 0)
                return leads;
        }
        return [];
    }
    async tryInstance(instance, query, count, options) {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "KeeLead/1.0 (Lead Generation Tool)",
                    "Accept": "application/json",
                },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok)
                return [];
            const data = await res.json();
            if (!data?.results?.length)
                return [];
            return this.parseResults(data, options, instance);
        }
        catch {
            return [];
        }
    }
    parseResults(data, options, instance) {
        const leads = [];
        const seen = new Set();
        for (const result of data.results) {
            if (!result.title || !result.url)
                continue;
            // Deduplicate by URL
            if (seen.has(result.url))
                continue;
            seen.add(result.url);
            // Try to extract a person name from the title
            // Common patterns: "Name - Title | Company", "Name's Profile", "Name (Company)"
            const { firstName, lastName, title, company } = this.extractPersonFromTitle(result.title, result.content);
            // Determine if this looks like a person or organization
            const isPerson = firstName.length > 0 && lastName.length > 0;
            // Calculate confidence based on score and content quality
            const baseConfidence = 0.45;
            const scoreBonus = result.score ? Math.min(result.score / 100, 0.15) : 0;
            const contentBonus = result.content && result.content.length > 50 ? 0.05 : 0;
            const confidence = Math.min(baseConfidence + scoreBonus + contentBonus, 0.75);
            // Extract tags from engines
            const engines = result.engines || (result.engine ? [result.engine] : []);
            const engineTags = engines.slice(0, 5);
            leads.push(this.makeLead({
                firstName: isPerson ? firstName : result.title.slice(0, 50),
                lastName: isPerson ? lastName : "",
                company: company || options?.company,
                title: title || (isPerson ? undefined : result.content?.slice(0, 100)),
                website: result.url,
                confidence,
                tags: ["search", "searxng", "meta-search", ...engineTags, ...(result.category ? [result.category] : [])],
                metadata: {
                    source: "SearXNG",
                    instance,
                    engines,
                    searxScore: result.score,
                    category: result.category,
                    snippet: result.content?.slice(0, 300),
                    publishedDate: result.publishedDate,
                    originalTitle: result.title,
                    query: data.query,
                    totalResults: data.number_of_results,
                },
            }));
        }
        // Also extract answers if available (direct answers from search engines)
        if (data.answers?.length) {
            for (const answer of data.answers) {
                if (seen.has(answer))
                    continue;
                seen.add(answer);
                leads.unshift(this.makeLead({
                    firstName: "Direct Answer",
                    lastName: "",
                    title: answer.slice(0, 200),
                    confidence: 0.7,
                    tags: ["search", "searxng", "direct-answer"],
                    metadata: {
                        source: "SearXNG",
                        directAnswer: answer,
                        instance,
                    },
                }));
            }
        }
        // Extract infobox data if available
        if (data.infoboxes?.length) {
            for (const infobox of data.infoboxes) {
                if (!infobox.infobox)
                    continue;
                const parts = infobox.infobox.split(/\s+/);
                const firstName = parts[0] || infobox.infobox;
                const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
                leads.unshift(this.makeLead({
                    firstName,
                    lastName,
                    company: infobox.infobox,
                    title: infobox.content?.slice(0, 200),
                    website: infobox.urls?.[0]?.url,
                    confidence: 0.7,
                    tags: ["search", "searxng", "infobox"],
                    metadata: {
                        source: "SearXNG",
                        infoboxName: infobox.infobox,
                        infoboxContent: infobox.content?.slice(0, 500),
                        infoboxUrls: infobox.urls,
                        instance,
                    },
                }));
            }
        }
        return leads;
    }
    extractPersonFromTitle(title, snippet) {
        // Clean the title
        let cleaned = title
            .replace(/\s*[-|–—]\s*(?:LinkedIn|Twitter|GitHub|Facebook|Instagram|YouTube|About|Profile|Home)\s*$/i, "")
            .replace(/\s*\(.*?\)\s*$/, "")
            .trim();
        // Pattern: "Name - Title at Company"
        const dashPattern = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[-–—]\s*(.+?)(?:\s+(?:at|@)\s+(.+))?$/);
        if (dashPattern) {
            return {
                firstName: dashPattern[1].split(/\s+/)[0],
                lastName: dashPattern[1].split(/\s+/).slice(1).join(" "),
                title: dashPattern[2],
                company: dashPattern[3],
            };
        }
        // Pattern: "Name | Title at Company"
        const pipePattern = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*\|\s*(.+?)(?:\s+(?:at|@)\s+(.+))?$/);
        if (pipePattern) {
            return {
                firstName: pipePattern[1].split(/\s+/)[0],
                lastName: pipePattern[1].split(/\s+/).slice(1).join(" "),
                title: pipePattern[2],
                company: pipePattern[3],
            };
        }
        // Pattern: "Name - Company" or "Name, Title"
        const simplePattern = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[-–—,]\s*(.+)$/);
        if (simplePattern) {
            return {
                firstName: simplePattern[1].split(/\s+/)[0],
                lastName: simplePattern[1].split(/\s+/).slice(1).join(" "),
                title: simplePattern[2],
            };
        }
        // If it looks like a person's name (2-4 capitalized words)
        const namePattern = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
        if (namePattern) {
            const parts = namePattern[1].split(/\s+/);
            return {
                firstName: parts[0],
                lastName: parts.slice(1).join(" "),
            };
        }
        // Default: use first two words as name
        const words = cleaned.split(/\s+/);
        if (words.length >= 2 && words[0].match(/^[A-Z]/)) {
            return {
                firstName: words[0],
                lastName: words.slice(1, 3).join(" "),
            };
        }
        return { firstName: "", lastName: "" };
    }
    async getCompany(domain) {
        // Use SearXNG to search for company info
        for (const instance of this.INSTANCES) {
            const url = `${instance}/search?q=${encodeURIComponent(`site:${domain}`)}&format=json`;
            try {
                const res = await fetch(url, {
                    headers: { "Accept": "application/json" },
                    signal: AbortSignal.timeout(5000),
                });
                if (!res.ok)
                    continue;
                const data = await res.json();
                if (!data?.results?.length)
                    continue;
                const firstResult = data.results[0];
                return this.makeCompany({
                    name: domain.replace(/\.(com|io|co|org|net)$/, ""),
                    domain,
                    website: firstResult.url || `https://${domain}`,
                    description: firstResult.content?.slice(0, 500) || "Company data from SearXNG",
                    metadata: {
                        source: "SearXNG",
                        searchResults: data.results.slice(0, 5).map(r => ({
                            title: r.title,
                            url: r.url,
                            snippet: r.content?.slice(0, 200),
                        })),
                    },
                });
            }
            catch {
                continue;
            }
        }
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
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
exports.SearXNGSourceSource = SearXNGSourceSource;
exports.default = new SearXNGSourceSource();
