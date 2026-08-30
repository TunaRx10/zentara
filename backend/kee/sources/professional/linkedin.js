"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkedInSource2Source = void 0;
// LinkedIn — LinkedIn profiles via Google search (avoids direct scraping)
const base_1 = require("../base");
class LinkedInSource2Source extends base_1.BaseSource {
    name = "LinkedIn";
    id = "linkedin";
    category = "professional";
    requiresApiKey = false;
    rateLimit = 10;
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    async search(query, options) {
        // Use Google to find LinkedIn profiles — avoids direct LinkedIn scraping
        const titleFilter = options?.title ? ` ${options.title}` : "";
        const companyFilter = options?.company ? ` ${options.company}` : "";
        const searchQuery = `site:linkedin.com/in ${query}${titleFilter}${companyFilter}`;
        const url = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=${options?.count || 10}`;
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
            // Check for CAPTCHA/block
            if (html.includes("captcha") || html.includes("unusual traffic") || html.includes("detected unusual traffic")) {
                return [];
            }
            return this.parseGoogleResults(html, options);
        }
        catch {
            return [];
        }
    }
    parseGoogleResults(html, options) {
        const leads = [];
        const seen = new Set();
        // Google result pattern:
        // <a href="https://www.linkedin.com/in/name-12345">Name - Title - Company | LinkedIn</a>
        // Or: <a href="/url?q=https://www.linkedin.com/in/name-12345&...">Name - Title | LinkedIn</a>
        // Match LinkedIn profile URLs in Google results
        const resultPattern = /href="(?:\/url\?q=)?(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"&\s]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        while ((match = resultPattern.exec(html)) !== null) {
            const linkedinUrl = match[1].replace(/&amp;/g, "&");
            const rawText = match[2].replace(/<[^>]+>/g, "").trim();
            // Skip if already seen
            if (seen.has(linkedinUrl))
                continue;
            seen.add(linkedinUrl);
            // Parse the link text — usually "Name - Title - Company | LinkedIn"
            const cleaned = rawText.replace(/\s*[-|]\s*LinkedIn\s*$/i, "").trim();
            const dashParts = cleaned.split(/\s*[-–—]\s*/);
            const nameStr = dashParts[0]?.trim() || "";
            if (!nameStr || nameStr.length < 2)
                continue;
            const parts = nameStr.split(/\s+/);
            const firstName = parts[0] || nameStr;
            const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
            // Extract title and company from subsequent parts
            const title = dashParts[1]?.trim() || undefined;
            const company = dashParts[2]?.trim() || options?.company;
            // Extract profile slug for metadata
            const slugMatch = linkedinUrl.match(/linkedin\.com\/in\/([^?&#]+)/);
            const slug = slugMatch ? slugMatch[1] : undefined;
            leads.push(this.makeLead({
                firstName,
                lastName,
                company,
                title,
                linkedin: linkedinUrl,
                confidence: 0.55,
                tags: ["professional", "linkedin"],
                metadata: {
                    source: "LinkedIn (via Google)",
                    linkedinUrl,
                    profileSlug: slug,
                    rawSnippet: rawText,
                    searchEngine: "google",
                },
            }));
        }
        return leads;
    }
    async getCompany(domain) {
        // Search Google for LinkedIn company page
        const url = `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/company ${domain}`)}`;
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": this.USER_AGENT,
                    "Accept": "text/html",
                },
            });
            if (!res.ok)
                return this.makeCompany({
                    name: domain.replace(/\.(com|io|co|org|net)$/, ""),
                    domain,
                    website: `https://${domain}`,
                });
            const html = await res.text();
            const companyMatch = html.match(/linkedin\.com\/company\/([^"&\s/]+)/);
            const companyName = companyMatch ? companyMatch[1].replace(/-/g, " ") : domain.replace(/\.(com|io|co|org|net)$/, "");
            return this.makeCompany({
                name: companyName,
                domain,
                website: companyMatch ? `https://www.linkedin.com/company/${companyMatch[1]}` : `https://${domain}`,
                description: "Company data from LinkedIn (via Google)",
                metadata: { source: "LinkedIn", foundVia: "google" },
            });
        }
        catch {
            return this.makeCompany({
                name: domain.replace(/\.(com|io|co|org|net)$/, ""),
                domain,
                website: `https://${domain}`,
            });
        }
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
exports.LinkedInSource2Source = LinkedInSource2Source;
exports.default = new LinkedInSource2Source();
