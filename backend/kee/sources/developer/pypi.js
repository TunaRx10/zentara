"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PyPISourceSource = void 0;
// PyPI — Python package authors
const base_1 = require("../base");
class PyPISourceSource extends base_1.BaseSource {
    name = "PyPI";
    id = "pypi";
    category = "developer";
    requiresApiKey = false;
    rateLimit = 60;
    async search(query, options) {
        // PyPI doesn't have a search API, so we try exact package name match
        // and common variations (e.g. query as-is, with hyphens replaced by underscores)
        const candidates = [
            query,
            query.replace(/\s+/g, "-"),
            query.replace(/\s+/g, "_"),
            query.replace(/[\s-]+/g, "_"),
        ].filter((v, i, a) => a.indexOf(v) === i); // dedupe
        const leads = [];
        const seen = new Set();
        for (const pkgName of candidates.slice(0, 3)) {
            const url = `https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`;
            const data = await this.fetchJson(url);
            if (!data?.info)
                continue;
            const info = data.info;
            const authorName = info.author || info.maintainer || "";
            if (!authorName || seen.has(authorName))
                continue;
            seen.add(authorName);
            const parts = authorName.trim().split(/\s+/);
            const firstName = parts[0] || "";
            const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
            const email = info.author_email || info.maintainer_email || undefined;
            const website = info.home_page || info.project_urls?.Homepage || undefined;
            // Try to extract company from project URLs
            let company;
            const allUrls = Object.values(info.project_urls || {});
            for (const u of allUrls) {
                const m = u.match(/github\.com\/([^/]+)/);
                if (m) {
                    company = m[1];
                    break;
                }
            }
            leads.push(this.makeLead({
                firstName,
                lastName,
                email,
                company: company || options?.company,
                title: "Package Author",
                website,
                confidence: email ? 0.8 : 0.6,
                tags: ["developer", "pypi", "python"],
                metadata: {
                    source: "PyPI",
                    packageName: info.name,
                    description: info.summary,
                    license: info.license,
                    latestVersion: info.version,
                    projectUrls: info.project_urls,
                },
            }));
            if (leads.length >= (options?.count || 10))
                break;
        }
        return leads;
    }
    async getCompany(domain) {
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: "Company data from PyPI",
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
exports.PyPISourceSource = PyPISourceSource;
exports.default = new PyPISourceSource();
