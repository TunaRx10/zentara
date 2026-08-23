"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHOISSourceSource = void 0;
// WHOIS — Domain lookup via RDAP (free, no key needed)
const base_1 = require("../base");
class WHOISSourceSource extends base_1.BaseSource {
    name = "WHOIS";
    id = "whois";
    category = "email";
    requiresApiKey = false;
    rateLimit = 30;
    async search(query, options) {
        const domain = query.includes("@") ? query.split("@")[1] : query;
        if (!domain || !domain.includes("."))
            return [];
        const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
        const data = await this.fetchJson(url);
        if (!data?.ldhName)
            return [];
        const leads = [];
        // Extract registrant info from entities
        const registrant = this.findEntity(data.entities || [], "registrant");
        const registrar = this.findEntity(data.entities || [], "registrar");
        const regName = this.extractFromVCard(registrant, "fn");
        const regEmail = this.extractFromVCard(registrant, "email");
        const regOrg = this.extractFromVCard(registrant, "org");
        const regAddr = this.extractFromVCard(registrant, "adr");
        const regPhone = this.extractFromVCard(registrant, "tel");
        const registrarName = this.extractFromVCard(registrar, "fn") || registrar?.handle;
        // Registration dates
        const registrationDate = data.events?.find(e => e.eventAction === "registration")?.eventDate;
        const expirationDate = data.events?.find(e => e.eventAction === "expiration")?.eventDate;
        const fullName = regName || domain.split(".")[0];
        const parts = fullName.trim().split(/\s+/);
        const firstName = parts[0] || "";
        const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
        if (firstName) {
            leads.push(this.makeLead({
                firstName,
                lastName,
                email: regEmail || undefined,
                phone: regPhone || undefined,
                company: regOrg || options?.company,
                title: "Domain Registrant",
                website: `https://${domain}`,
                confidence: regEmail ? 0.75 : 0.5,
                tags: ["email", "whois", "domain-registrant"],
                metadata: {
                    source: "WHOIS/RDAP",
                    domain: data.ldhName,
                    registrar: registrarName,
                    registrationDate,
                    expirationDate,
                    status: data.status,
                    address: regAddr,
                },
            }));
        }
        // Add registrar as a secondary lead if different
        if (registrarName && registrarName !== fullName) {
            leads.push(this.makeLead({
                firstName: registrarName,
                lastName: "",
                company: registrarName,
                title: "Domain Registrar",
                confidence: 0.4,
                tags: ["email", "whois", "registrar"],
                metadata: {
                    source: "WHOIS/RDAP",
                    role: "registrar",
                    registrarHandle: registrar?.handle,
                },
            }));
        }
        return leads;
    }
    findEntity(entities, role) {
        for (const entity of entities) {
            if (entity.roles?.includes(role))
                return entity;
            // Check nested entities (some RDAP servers nest registrar under registrant)
            if (entity.entities) {
                const found = this.findEntity(entity.entities, role);
                if (found)
                    return found;
            }
        }
        return undefined;
    }
    extractFromVCard(entity, field) {
        if (!entity?.vcardArray)
            return undefined;
        const vcard = entity.vcardArray[1];
        if (!Array.isArray(vcard))
            return undefined;
        for (const entry of vcard) {
            if (!Array.isArray(entry) || entry.length < 2)
                continue;
            const key = entry[0];
            const value = entry.length >= 4 ? entry[3] : entry[2];
            if (key === field) {
                if (typeof value === "string")
                    return value;
                if (Array.isArray(value))
                    return value.filter(Boolean).join(", ");
            }
        }
        return undefined;
    }
    async getCompany(domain) {
        const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
        const data = await this.fetchJson(url);
        if (!data?.ldhName)
            return null;
        const registrant = this.findEntity(data.entities || [], "registrant");
        const org = this.extractFromVCard(registrant, "org");
        const regDate = data.events?.find(e => e.eventAction === "registration")?.eventDate;
        return this.makeCompany({
            name: org || domain.split(".")[0],
            domain,
            website: `https://${domain}`,
            founded: regDate?.split("T")[0],
            description: `Domain: ${data.ldhName}`,
            industry: "Technology",
            metadata: {
                registrationDate: regDate,
                status: data.status,
            },
        });
    }
    async getContact(email) {
        const [local, domain] = email.split("@");
        if (!domain)
            return null;
        const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
        const data = await this.fetchJson(url);
        const registrant = this.findEntity(data?.entities || [], "registrant");
        const regName = this.extractFromVCard(registrant, "fn");
        const regEmail = this.extractFromVCard(registrant, "email");
        const regOrg = this.extractFromVCard(registrant, "org");
        return {
            name: regName || local,
            email: regEmail || email,
            company: regOrg || domain.replace(/\.(com|io|co|org|net)$/, ""),
            confidence: data?.ldhName ? 0.7 : 0.4,
            source: this.name,
        };
    }
}
exports.WHOISSourceSource = WHOISSourceSource;
exports.default = new WHOISSourceSource();
