"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NPMSourceSource = void 0;
// NPM — NPM package authors
const base_1 = require("../base");
class NPMSourceSource extends base_1.BaseSource {
    name = "NPM";
    id = "npm";
    category = "developer";
    requiresApiKey = false;
    rateLimit = 60;
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${count}`;
        const data = await this.fetchJson(url);
        if (!data?.objects?.length)
            return [];
        const leads = [];
        for (const obj of data.objects) {
            const pkg = obj.package;
            const author = pkg.author;
            const publisher = pkg.publisher;
            const maintainers = pkg.maintainers || [];
            // Try to extract a name from author or publisher
            const nameStr = author?.name || publisher?.username || "";
            if (!nameStr)
                continue;
            const parts = nameStr.trim().split(/\s+/);
            const firstName = parts[0] || "";
            const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
            // Extract email from author, publisher, or first maintainer
            const email = author?.email || publisher?.email || maintainers[0]?.email || undefined;
            // Try to infer company from links
            let company;
            const repo = pkg.links?.repository || "";
            const homepage = pkg.links?.homepage || "";
            const urlMatch = (repo || homepage).match(/github\.com\/([^/]+)/);
            if (urlMatch)
                company = urlMatch[1];
            leads.push(this.makeLead({
                firstName,
                lastName,
                email,
                company: company || options?.company,
                title: "Package Author",
                website: pkg.links?.homepage || pkg.links?.repository || undefined,
                confidence: email ? 0.8 : 0.6,
                tags: ["developer", "npm", ...(pkg.keywords?.slice(0, 5) || [])],
                metadata: {
                    source: "NPM",
                    packageName: pkg.name,
                    description: pkg.description,
                    repository: pkg.links?.repository,
                    lastPublished: pkg.date,
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
            description: "Company data from NPM",
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
exports.NPMSourceSource = NPMSourceSource;
exports.default = new NPMSourceSource();
