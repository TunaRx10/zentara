"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrademarksSourceSource = void 0;
// USPTO Trademarks — USPTO TSDR & IBd API (FREE, no key needed)
const base_1 = require("../base");
class TrademarksSourceSource extends base_1.BaseSource {
    name = "USPTO Trademarks";
    id = "trademarks";
    category = "government";
    requiresApiKey = false;
    rateLimit = 30;
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        // USPTO Integrated Business Data (IBd) API — free, no key needed
        const params = new URLSearchParams({
            searchText: query,
            rows: String(Math.min(count, 50)),
            start: "0",
        });
        const url = `https://developer.uspto.gov/ibd-api/v1/trademark/search?${params}`;
        let data = null;
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "KeeLead/1.0",
                },
            });
            if (res.ok)
                data = await res.json();
        }
        catch { /* ignore */ }
        if (!data?.trademarks?.length)
            return [];
        const leads = [];
        const seen = new Set();
        for (const tm of data.trademarks) {
            const ownerName = tm.currentOwner || tm.ownerName || tm.correspondentName;
            if (!ownerName || seen.has(ownerName))
                continue;
            seen.add(ownerName);
            const isCompany = !ownerName.includes(" ") || ownerName.length > 30;
            const parts = ownerName.split(/\s+/);
            const firstName = isCompany ? ownerName : (parts[0] || "");
            const lastName = isCompany ? "" : (parts.slice(1).join(" ") || "");
            leads.push(this.makeLead({
                firstName,
                lastName,
                company: isCompany ? ownerName : undefined,
                title: "Trademark Owner",
                location: [tm.ownerCity || tm.correspondentAddress, tm.ownerState, tm.ownerCountry].filter(Boolean).join(", "),
                confidence: 0.65,
                tags: ["government", "trademarks", ...(tm.internationalClass || []).slice(0, 3)],
                metadata: {
                    source: "USPTO Trademarks",
                    serialNumber: tm.serialNumber,
                    markName: tm.markIdentification,
                    applicationDate: tm.applicationDate,
                    registrationDate: tm.registrationDate,
                    status: tm.status,
                    description: tm.markDescription?.slice(0, 200),
                    classes: tm.internationalClass,
                    attorney: tm.attorneyName,
                },
            }));
        }
        return leads.slice(0, count);
    }
    async getCompany(domain) {
        const query = domain.replace(/\.(com|io|co|org|net)$/, "");
        const url = `https://developer.uspto.gov/ibd-api/v1/trademark/search?searchText=${encodeURIComponent(query)}&rows=5`;
        try {
            const res = await fetch(url, {
                headers: { "Accept": "application/json", "User-Agent": "KeeLead/1.0" },
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            if (!data.trademarks?.length)
                return null;
            const tm = data.trademarks[0];
            return this.makeCompany({
                name: tm.currentOwner || tm.ownerName || query,
                domain,
                website: `https://${domain}`,
                description: `Trademark holder — ${tm.markIdentification}`,
                headquarters: [tm.ownerCity, tm.ownerState, tm.ownerCountry].filter(Boolean).join(", "),
                metadata: {
                    trademarkCount: data.total,
                    latestMark: tm.markIdentification,
                    status: tm.status,
                },
            });
        }
        catch {
            return null;
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
exports.TrademarksSourceSource = TrademarksSourceSource;
exports.default = new TrademarksSourceSource();
