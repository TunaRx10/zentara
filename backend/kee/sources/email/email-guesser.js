"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailGuesserSource = void 0;
// Email Guesser — Email Pattern Discovery & Intelligence Tool
const base_1 = require("../base");
class EmailGuesserSource extends base_1.BaseSource {
    name = "Email Guesser";
    id = "email-guesser";
    category = "email";
    requiresApiKey = false;
    rateLimit = 60;
    async search(query, options) {
        // Parse query: could be "john doe example.com", "john.doe@example.com", or "john doe"
        const parsed = this.parseQuery(query, options);
        if (!parsed.firstName || !parsed.domain)
            return [];
        const permutations = this.generatePermutations(parsed.firstName, parsed.lastName, parsed.domain);
        const verified = await this.verifyPermutations(permutations);
        return verified
            .filter((v) => v.hasMx)
            .map((v) => {
            const email = v.email;
            const local = email.split("@")[0];
            const domain = email.split("@")[1];
            const company = domain.replace(/\.(com|io|co|org|net|dev|ai)$/, "");
            return this.makeLead({
                firstName: parsed.firstName,
                lastName: parsed.lastName,
                email,
                company: options?.company || company.charAt(0).toUpperCase() + company.slice(1),
                title: options?.title || "Guessed Contact",
                website: `https://${domain}`,
                confidence: v.score,
                tags: ["email", "email-guesser", v.pattern],
                metadata: {
                    source: "Email Guesser",
                    pattern: v.pattern,
                    hasMxRecords: v.hasMx,
                    emailProvider: v.emailProvider,
                    allPermutations: permutations.length,
                },
            });
        })
            .sort((a, b) => b.confidence - a.confidence);
    }
    async getCompany(domain) {
        // Check if domain has valid MX records
        const mxCheck = await this.checkMxRecords(domain);
        if (!mxCheck.hasMx)
            return null;
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net|dev|ai)$/, ""),
            domain,
            website: `https://${domain}`,
            description: `Email-capable domain with ${mxCheck.mxCount} MX record(s). Provider: ${mxCheck.provider}`,
            metadata: {
                source: "Email Guesser",
                emailProvider: mxCheck.provider,
                mxRecords: mxCheck.records,
                mxCount: mxCheck.mxCount,
            },
        });
    }
    async getContact(email) {
        if (!email.includes("@"))
            return null;
        const [local, domain] = email.split("@");
        const mxCheck = await this.checkMxRecords(domain);
        const parts = local.split(/[._-]/);
        return {
            name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
            email,
            company: domain.replace(/\.(com|io|co|org|net|dev|ai)$/, ""),
            confidence: mxCheck.hasMx ? 0.6 : 0.2,
            source: this.name,
        };
    }
    /**
     * Generate all common email permutations for a person at a domain
     */
    generatePermutations(firstName, lastName, domain) {
        const f = firstName.toLowerCase().trim();
        const l = lastName.toLowerCase().trim();
        const emails = [];
        if (!f || !domain)
            return emails;
        const patterns = [];
        if (l) {
            // Full name patterns
            patterns.push({ pattern: "first.last", email: `${f}.${l}@${domain}` });
            patterns.push({ pattern: "firstlast", email: `${f}${l}@${domain}` });
            patterns.push({ pattern: "f.last", email: `${f[0]}.${l}@${domain}` });
            patterns.push({ pattern: "flast", email: `${f[0]}${l}@${domain}` });
            patterns.push({ pattern: "first_last", email: `${f}_${l}@${domain}` });
            patterns.push({ pattern: "first-last", email: `${f}-${l}@${domain}` });
            patterns.push({ pattern: "last.first", email: `${l}.${f}@${domain}` });
            patterns.push({ pattern: "lastfirst", email: `${l}${f}@${domain}` });
            patterns.push({ pattern: "l.first", email: `${l[0]}.${f}@${domain}` });
            patterns.push({ pattern: "lfirst", email: `${l[0]}${f}@${domain}` });
            patterns.push({ pattern: "firstl", email: `${f}${l[0]}@${domain}` });
            patterns.push({ pattern: "first.l", email: `${f}.${l[0]}@${domain}` });
        }
        // First-name-only patterns
        patterns.push({ pattern: "first", email: `${f}@${domain}` });
        if (l) {
            patterns.push({ pattern: "last", email: `${l}@${domain}` });
            patterns.push({ pattern: "f.l", email: `${f[0]}.${l[0]}@${domain}` });
            patterns.push({ pattern: "fl", email: `${f[0]}${l[0]}@${domain}` });
        }
        // Deduplicate
        const seen = new Set();
        for (const p of patterns) {
            if (!seen.has(p.email)) {
                seen.add(p.email);
                emails.push(p.email);
            }
        }
        return emails;
    }
    /**
     * Verify permutations against DNS MX records
     */
    async verifyPermutations(emails) {
        if (!emails.length)
            return [];
        const domain = emails[0].split("@")[1];
        const mxCheck = await this.checkMxRecords(domain);
        // Pattern confidence scoring
        const patternScores = {
            "first.last": 0.85,
            "firstlast": 0.7,
            "f.last": 0.65,
            "flast": 0.6,
            "first_last": 0.6,
            "first-last": 0.55,
            "last.first": 0.5,
            "lastfirst": 0.45,
            "l.first": 0.4,
            "lfirst": 0.35,
            "firstl": 0.5,
            "first.l": 0.45,
            first: 0.4,
            last: 0.35,
            "f.l": 0.3,
            fl: 0.25,
        };
        return emails.map((email) => {
            const local = email.split("@")[0];
            // Try to identify the pattern
            let pattern = "unknown";
            for (const [pat, _] of Object.entries(patternScores)) {
                // Simple pattern matching
                if (pattern === "unknown") {
                    pattern = pat;
                }
            }
            // More accurate pattern detection
            const firstName = local.split(/[._-]/)[0] || local;
            if (local.includes(".")) {
                const parts = local.split(".");
                if (parts[0].length === 1)
                    pattern = parts.length > 2 ? "f.last" : "f.l";
                else if (parts.length > 2)
                    pattern = "first.last";
                else
                    pattern = parts[1]?.length === 1 ? "first.l" : "first.last";
            }
            else if (local.includes("_")) {
                pattern = "first_last";
            }
            else if (local.includes("-")) {
                pattern = "first-last";
            }
            else if (local.length <= 2) {
                pattern = local.length === 1 ? "f" : "fl";
            }
            const baseScore = patternScores[pattern] || 0.3;
            return {
                email,
                hasMx: mxCheck.hasMx,
                score: mxCheck.hasMx ? baseScore : baseScore * 0.3,
                pattern,
                emailProvider: mxCheck.provider,
            };
        });
    }
    async checkMxRecords(domain) {
        try {
            const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
                signal: AbortSignal.timeout(5000),
            });
            const data = (await res.json());
            if (data.Status !== 0 || !data.Answer?.length) {
                return { hasMx: false, mxCount: 0, records: [], provider: "none" };
            }
            const records = data.Answer.map((a) => a.data);
            const provider = this.detectProvider(records);
            return {
                hasMx: true,
                mxCount: records.length,
                records,
                provider,
            };
        }
        catch {
            return { hasMx: false, mxCount: 0, records: [], provider: "unknown" };
        }
    }
    detectProvider(mxRecords) {
        const joined = mxRecords.join(" ").toLowerCase();
        if (joined.includes("google") || joined.includes("gmail"))
            return "Google Workspace";
        if (joined.includes("outlook") || joined.includes("microsoft"))
            return "Microsoft 365";
        if (joined.includes("proton"))
            return "ProtonMail";
        if (joined.includes("zoho"))
            return "Zoho";
        if (joined.includes("amazon") || joined.includes("ses"))
            return "Amazon SES";
        if (joined.includes("mimecast"))
            return "Mimecast";
        if (joined.includes("barracuda"))
            return "Barracuda";
        if (joined.includes("proofpoint"))
            return "Proofpoint";
        if (joined.includes("yahoo"))
            return "Yahoo Mail";
        if (joined.includes("icloud") || joined.includes("apple"))
            return "iCloud";
        return "Custom";
    }
    parseQuery(query, options) {
        // If options provide structured data, use that
        if (options?.company) {
            const domain = this.toDomain(options.company);
            const nameParts = query.trim().split(/\s+/);
            return {
                firstName: nameParts[0] || "",
                lastName: nameParts.slice(1).join(" "),
                domain,
            };
        }
        // Check if query contains an email
        if (query.includes("@")) {
            const [local, domain] = query.split("@");
            const parts = local.split(/[._-]/);
            return {
                firstName: parts[0] || "",
                lastName: parts.slice(1).join(" "),
                domain,
            };
        }
        // Check if query is "name domain" format
        const tokens = query.trim().split(/\s+/);
        if (tokens.length >= 2) {
            const lastToken = tokens[tokens.length - 1];
            if (lastToken.includes(".")) {
                // Last token is a domain
                return {
                    firstName: tokens[0],
                    lastName: tokens.slice(1, -1).join(" "),
                    domain: lastToken,
                };
            }
        }
        // Fallback: first word is name, rest could be company
        return {
            firstName: tokens[0] || "",
            lastName: tokens.slice(1).join(" "),
            domain: "",
        };
    }
    toDomain(company) {
        const cleaned = company.toLowerCase().replace(/[^a-z0-9\s.-]/g, "").trim();
        if (cleaned.includes("."))
            return cleaned;
        return cleaned.replace(/\s+/g, "") + ".com";
    }
}
exports.EmailGuesserSource = EmailGuesserSource;
exports.default = new EmailGuesserSource();
