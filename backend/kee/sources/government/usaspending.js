"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USASpendingSourceSource = void 0;
// USASpending — US government spending data
const base_1 = require("../base");
class USASpendingSourceSource extends base_1.BaseSource {
    name = "USASpending";
    id = "usaspending";
    category = "government";
    requiresApiKey = false;
    rateLimit = 30;
    async search(query, options) {
        const count = Math.min(options?.count || 10, 50);
        const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
        const body = {
            filters: {
                keywords: [query],
            },
            fields: [
                "Award ID",
                "Recipient Name",
                "Award Amount",
                "Start Date",
                "End Date",
                "Awarding Agency",
                "Awarding Sub Agency",
                "Award Type",
                "Description",
                "Recipient City",
                "Recipient State",
                "Recipient Country",
            ],
            limit: count,
            page: 1,
            sort: "Award Amount",
            order: "desc",
            subawards: false,
        };
        let data = null;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok)
                return [];
            data = (await res.json());
        }
        catch {
            return [];
        }
        if (!data?.results?.length)
            return [];
        const leads = [];
        const seen = new Set();
        for (const result of data.results) {
            const recipientName = result["Recipient Name"];
            if (!recipientName || seen.has(recipientName))
                continue;
            seen.add(recipientName);
            const location = [result["Recipient City"], result["Recipient State"], result["Recipient Country"]]
                .filter(Boolean).join(", ");
            const awardAmount = result["Award Amount"];
            const amountStr = awardAmount >= 1_000_000
                ? `$${(awardAmount / 1_000_000).toFixed(1)}M`
                : awardAmount >= 1_000
                    ? `$${(awardAmount / 1_000).toFixed(0)}K`
                    : `$${awardAmount.toFixed(0)}`;
            leads.push(this.makeLead({
                firstName: recipientName,
                lastName: "",
                company: recipientName,
                title: result["Award Type"] || "Government Contractor",
                location: location || undefined,
                confidence: 0.75,
                tags: [
                    "government", "usaspending", "federal-contractor",
                    ...(result["Awarding Agency"] ? [result["Awarding Agency"].toLowerCase().replace(/\s+/g, "-")] : []),
                ],
                metadata: {
                    source: "USASpending",
                    awardId: result["Award ID"],
                    awardAmount: awardAmount,
                    awardAmountFormatted: amountStr,
                    startDate: result["Start Date"],
                    endDate: result["End Date"],
                    awardingAgency: result["Awarding Agency"],
                    awardingSubAgency: result["Awarding Sub Agency"],
                    awardType: result["Award Type"],
                    description: result["Description"]?.slice(0, 200),
                    recipientCity: result["Recipient City"],
                    recipientState: result["Recipient State"],
                    recipientCountry: result["Recipient Country"],
                },
            }));
        }
        return leads;
    }
    async getCompany(domain) {
        const name = domain.replace(/\.(com|io|co|org|net)$/, "").replace(/-/g, " ");
        const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
        const body = {
            filters: { keywords: [name] },
            fields: ["Recipient Name", "Award Amount", "Awarding Agency", "Recipient City", "Recipient State"],
            limit: 1,
            page: 1,
            sort: "Award Amount",
            order: "desc",
            subawards: false,
        };
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok)
                return null;
            const data = (await res.json());
            const result = data.results?.[0];
            if (!result)
                return null;
            return this.makeCompany({
                name: result["Recipient Name"],
                domain,
                website: `https://${domain}`,
                headquarters: [result["Recipient City"], result["Recipient State"]].filter(Boolean).join(", "),
                metadata: {
                    totalAwardAmount: result["Award Amount"],
                    awardingAgency: result["Awarding Agency"],
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
exports.USASpendingSourceSource = USASpendingSourceSource;
exports.default = new USASpendingSourceSource();
