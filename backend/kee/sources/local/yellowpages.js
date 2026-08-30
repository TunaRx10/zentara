"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YellowPagesSource2Source = void 0;
// Yellow Pages — Yellow Pages business directory scraping
const base_1 = require("../base");
class YellowPagesSource2Source extends base_1.BaseSource {
    name = "Yellow Pages";
    id = "yellowpages";
    category = "local";
    requiresApiKey = false;
    rateLimit = 10;
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    async search(query, options) {
        const location = options?.location || "";
        const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}&geo_location_terms=${encodeURIComponent(location)}`;
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
            return this.parseHtml(html, options);
        }
        catch {
            return [];
        }
    }
    parseHtml(html, options) {
        const leads = [];
        const seen = new Set();
        // Yellow Pages listing cards
        // Each listing has class "result" and contains:
        //   <h2 class="n"><a href="...">Business Name</a></h2>
        //   <div class="phones phone primary">555-1234</div>
        //   <div class="street-address">123 Main St</div>
        //   <div class="locality">City, ST</div>
        //   <div class="categories">Category1, Category2</div>
        // Split by listing boundaries
        const listingBlocks = html.split(/class="result\b/);
        for (let i = 1; i < listingBlocks.length; i++) {
            const block = listingBlocks[i];
            // Extract business name
            const nameMatch = block.match(/<h2[^>]*class="n"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);
            if (!nameMatch)
                continue;
            const businessName = nameMatch[1].replace(/<[^>]+>/g, "").trim();
            if (!businessName || seen.has(businessName))
                continue;
            seen.add(businessName);
            // Extract URL
            const urlMatch = block.match(/<h2[^>]*class="n"[^>]*>\s*<a href="([^"]+)"/);
            const website = urlMatch ? `https://www.yellowpages.com${urlMatch[1]}` : undefined;
            // Extract phone
            const phoneMatch = block.match(/class="phones[^"]*"[^>]*>([\s\S]*?)<\/div>/);
            const phone = phoneMatch ? phoneMatch[1].replace(/<[^>]+>/g, "").trim() : undefined;
            // Extract street address
            const streetMatch = block.match(/class="street-address"[^>]*>([\s\S]*?)<\/div>/);
            const street = streetMatch ? streetMatch[1].replace(/<[^>]+>/g, "").trim() : "";
            // Extract locality (city, state)
            const localityMatch = block.match(/class="locality"[^>]*>([\s\S]*?)<\/div>/);
            const locality = localityMatch ? localityMatch[1].replace(/<[^>]+>/g, "").trim() : "";
            const location = [street, locality].filter(Boolean).join(", ");
            // Extract categories
            const catMatch = block.match(/class="categories"[^>]*>([\s\S]*?)<\/div>/);
            const categories = catMatch
                ? catMatch[1].replace(/<[^>]+>/g, "").split(",").map(c => c.trim()).filter(Boolean)
                : [];
            // Extract website link if available
            const siteMatch = block.match(/class="track-visit-website"[^>]*href="([^"]+)"/);
            const bizWebsite = siteMatch ? siteMatch[1] : website;
            // Extract rating
            const ratingMatch = block.match(/class="ratings[^"]*"[^>]*>\s*(\d+\.?\d*)/);
            leads.push(this.makeLead({
                firstName: businessName,
                lastName: "",
                company: businessName,
                phone: phone || undefined,
                location: location || options?.location,
                website: bizWebsite,
                confidence: 0.55,
                tags: ["local", "yellowpages", "business", ...categories.slice(0, 3)],
                metadata: {
                    source: "Yellow Pages",
                    businessName,
                    categories,
                    street,
                    locality,
                    rating: ratingMatch ? parseFloat(ratingMatch[1]) : undefined,
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
            description: "Business data from Yellow Pages",
            industry: "Local Business",
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
exports.YellowPagesSource2Source = YellowPagesSource2Source;
exports.default = new YellowPagesSource2Source();
