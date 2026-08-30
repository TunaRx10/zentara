"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearchGateSourceSource = void 0;
// ResearchGate — ResearchGate publication and researcher scraping
const base_1 = require("../base");
class ResearchGateSourceSource extends base_1.BaseSource {
    name = "ResearchGate";
    id = "researchgate";
    category = "education";
    requiresApiKey = false;
    rateLimit = 10;
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    async search(query, options) {
        const url = `https://www.researchgate.net/search/publication?q=${encodeURIComponent(query)}`;
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": this.USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
            });
            if (!res.ok)
                return [];
            const html = await res.text();
            if (html.includes("captcha") || html.includes("Access denied")) {
                return [];
            }
            return this.parseHtml(html, options);
        }
        catch {
            return [];
        }
    }
    parseHtml(html, options) {
        const leads = [];
        const seen = new Set();
        // ResearchGate publication listings
        // Author names appear in links like: /scientific-contributions/Name-NNNNNNN
        // Publication titles in: <a href="/publication/..." class="nova-legacy-e-link...">Title</a>
        // Institution often appears as text nodes
        // Extract researcher profile links
        const researcherPattern = /href="\/profile\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let match;
        while ((match = researcherPattern.exec(html)) !== null) {
            const slug = match[1];
            const rawName = match[2].trim();
            if (!rawName || seen.has(rawName))
                continue;
            seen.add(rawName);
            const parts = rawName.split(/\s+/);
            const firstName = parts[0] || rawName;
            const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
            leads.push(this.makeLead({
                firstName,
                lastName,
                company: options?.company,
                title: "Researcher",
                website: `https://www.researchgate.net/profile/${slug}`,
                confidence: 0.5,
                tags: ["education", "researchgate", "researcher"],
                metadata: {
                    source: "ResearchGate",
                    profileSlug: slug,
                },
            }));
        }
        // Also extract publication titles and associated info
        const pubPattern = /href="\/publication\/(\d+)[^"]*"[^>]*class="[^"]*nova-legacy-e-link[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        const institutionPattern = /class="nova-legacy-e-text[^"]*institution[^"]*"[^>]*>([^<]+)</g;
        const institutions = [];
        while ((match = institutionPattern.exec(html)) !== null) {
            const inst = match[1].trim();
            if (inst)
                institutions.push(inst);
        }
        let pubIdx = 0;
        while ((match = pubPattern.exec(html)) !== null) {
            const pubId = match[1];
            const rawTitle = match[2].replace(/<[^>]+>/g, "").trim();
            if (!rawTitle)
                continue;
            // Try to find author names near this publication
            const contextStart = Math.max(0, match.index - 500);
            const contextEnd = Math.min(html.length, match.index + 500);
            const context = html.slice(contextStart, contextEnd);
            const authorNames = [];
            const authorInContext = /href="\/profile\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
            let authorMatch;
            while ((authorMatch = authorInContext.exec(context)) !== null) {
                const name = authorMatch[2].trim();
                if (name && !authorNames.includes(name))
                    authorNames.push(name);
            }
            if (authorNames.length > 0 && !seen.has(authorNames[0])) {
                const nameParts = authorNames[0].split(/\s+/);
                seen.add(authorNames[0]);
                leads.push(this.makeLead({
                    firstName: nameParts[0] || authorNames[0],
                    lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "",
                    company: institutions[pubIdx] || options?.company,
                    title: "Researcher",
                    website: `https://www.researchgate.net/publication/${pubId}`,
                    confidence: 0.5,
                    tags: ["education", "researchgate", "publication"],
                    metadata: {
                        source: "ResearchGate",
                        publicationTitle: rawTitle,
                        publicationId: pubId,
                        allAuthors: authorNames,
                        institution: institutions[pubIdx],
                    },
                }));
            }
            pubIdx++;
        }
        return leads;
    }
    async getCompany(domain) {
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net|edu)$/, ""),
            domain,
            website: `https://${domain}`,
            description: "Academic institution data from ResearchGate",
            industry: "Education",
        });
    }
    async getContact(email) {
        const [local, domain] = email.split("@");
        const parts = local.split(/[._-]/);
        return {
            name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
            email,
            company: domain.replace(/\.(com|io|co|org|net|edu)$/, ""),
            confidence: 0.5,
            source: this.name,
        };
    }
}
exports.ResearchGateSourceSource = ResearchGateSourceSource;
exports.default = new ResearchGateSourceSource();
