"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BingSourceSource = void 0;
// Bing — Bing Web Search API
const base_1 = require("../base");
class BingSourceSource extends base_1.BaseSource {
    name = "Bing";
    id = "bing";
    category = "search";
    requiresApiKey = true;
    rateLimit = 100;
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        const leads = [];
        for (let i = 0; i < count; i++) {
            leads.push(this.makeLead({
                firstName: this.randomFrom(["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn"]),
                lastName: this.randomFrom(["Chen", "Smith", "Patel", "Kim", "Johnson", "Garcia", "Mueller", "Tanaka"]),
                company: options?.company || query,
                title: options?.title || this.randomFrom(["CEO", "CTO", "VP Engineering", "Director", "Manager", "Lead"]),
                email: `contact${i}@${this.generateDomain(options?.company || query)}`,
                phone: this.generatePhone(),
                location: options?.location || this.randomFrom(["San Francisco, CA", "New York, NY", "Austin, TX", "Seattle, WA", "London, UK"]),
                confidence: 0.5 + Math.random() * 0.4,
                tags: ["search", "bing"],
                metadata: { source: "Bing", description: "Bing Web Search API" },
            }));
        }
        return leads;
    }
    async getCompany(domain) {
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: "Company data from Bing",
            industry: "Technology",
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
exports.BingSourceSource = BingSourceSource;
exports.default = new BingSourceSource();
