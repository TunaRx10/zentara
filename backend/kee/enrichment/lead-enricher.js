"use strict";
// KeeLead — Smart Enrichment Pipeline
// Aggregates data from multiple free sources into a comprehensive lead profile
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadEnricher = exports.LeadEnricher = void 0;
const index_1 = require("../sources/index");
class LeadEnricher {
    steps;
    constructor() {
        this.steps = this.buildSteps();
    }
    /**
     * Enrich a lead by querying multiple sources
     */
    async enrich(lead) {
        const enriched = {
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            title: lead.title,
            company: lead.company,
            sources: [],
            confidence: 0,
            enrichedAt: new Date().toISOString(),
            rawMetadata: {},
        };
        // Extract domain from email or website
        const domain = this.extractDomain(lead);
        if (domain)
            enriched.domain = domain;
        // Run all applicable enrichment steps
        const applicableSteps = this.steps.filter((s) => s.condition(lead));
        // Execute steps with concurrency control (batch of 3)
        for (let i = 0; i < applicableSteps.length; i += 3) {
            const batch = applicableSteps.slice(i, i + 3);
            await Promise.allSettled(batch.map(async (step) => {
                try {
                    await step.execute(lead, enriched);
                }
                catch {
                    // Step failed silently — continue with others
                }
            }));
        }
        // Calculate final confidence based on source count and data completeness
        enriched.confidence = this.calculateConfidence(enriched);
        return enriched;
    }
    /**
     * Enrich multiple leads in parallel
     */
    async enrichMany(leads, concurrency = 3) {
        const results = [];
        for (let i = 0; i < leads.length; i += concurrency) {
            const batch = leads.slice(i, i + concurrency);
            const enriched = await Promise.allSettled(batch.map((l) => this.enrich(l)));
            for (const result of enriched) {
                if (result.status === "fulfilled") {
                    results.push(result.value);
                }
            }
        }
        return results.sort((a, b) => b.confidence - a.confidence);
    }
    buildSteps() {
        return [
            // Step 1: WHOIS lookup for domain info
            {
                name: "WHOIS",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("whois");
                    if (!source)
                        return;
                    try {
                        const leads = await source.search(domain);
                        if (leads.length > 0) {
                            const whoisLead = leads[0];
                            enriched.founded = enriched.founded || whoisLead.metadata?.creationDate;
                            enriched.headquarters = enriched.headquarters || whoisLead.location;
                            this.addSource(enriched, "WHOIS", 0.15);
                            enriched.rawMetadata.whois = whoisLead.metadata;
                        }
                    }
                    catch {
                        // WHOIS failed
                    }
                },
            },
            // Step 2: DNS Lookup
            {
                name: "DNS Lookup",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("dns-lookup");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            enriched.company = enriched.company || companyData.name;
                            this.addSource(enriched, "DNS Lookup", 0.1);
                            enriched.rawMetadata.dns = companyData.metadata;
                        }
                    }
                    catch {
                        // DNS lookup failed
                    }
                },
            },
            // Step 3: SSL Certificate analysis
            {
                name: "SSL Certificate",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("ssl-cert");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            enriched.company = enriched.company || companyData.name;
                            this.addSource(enriched, "SSL Certificate", 0.1);
                            enriched.rawMetadata.ssl = companyData.metadata;
                        }
                    }
                    catch {
                        // SSL check failed
                    }
                },
            },
            // Step 4: BuiltWith Tech Stack Detection
            {
                name: "Tech Stack Detection",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("builtwith");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData?.techStack?.length) {
                            enriched.techStack = this.mergeArrays(enriched.techStack, companyData.techStack);
                            this.addSource(enriched, "BuiltWith", 0.15);
                            enriched.rawMetadata.techStack = companyData.techStack;
                        }
                    }
                    catch {
                        // Tech stack detection failed
                    }
                },
            },
            // Step 5: SEC EDGAR (US public companies)
            {
                name: "SEC EDGAR",
                condition: (lead) => !!(lead.company || this.extractDomain(lead)),
                execute: async (lead, enriched) => {
                    const query = lead.company || enriched.domain;
                    const source = index_1.sourceManager.get("sec-edgar");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(query);
                        if (companyData) {
                            enriched.company = enriched.company || companyData.name;
                            enriched.industry = enriched.industry || companyData.industry;
                            enriched.description = enriched.description || companyData.description;
                            enriched.headquarters = enriched.headquarters || companyData.headquarters;
                            enriched.phone = enriched.phone || companyData.metadata?.phone;
                            this.addSource(enriched, "SEC EDGAR", 0.2);
                            enriched.rawMetadata.secEdgar = companyData.metadata;
                        }
                    }
                    catch {
                        // SEC EDGAR failed
                    }
                },
            },
            // Step 6: OpenCorporates
            {
                name: "OpenCorporates",
                condition: (lead) => !!lead.company,
                execute: async (lead, enriched) => {
                    const source = index_1.sourceManager.get("opencorporates");
                    if (!source || !lead.company)
                        return;
                    try {
                        const leads = await source.search(lead.company, { count: 3 });
                        if (leads.length > 0) {
                            const best = leads[0];
                            enriched.company = enriched.company || best.company;
                            enriched.headquarters = enriched.headquarters || best.location;
                            this.addSource(enriched, "OpenCorporates", 0.15);
                            enriched.rawMetadata.openCorporates = best.metadata;
                        }
                    }
                    catch {
                        // OpenCorporates failed
                    }
                },
            },
            // Step 7: Wikidata
            {
                name: "Wikidata",
                condition: (lead) => !!(lead.company || this.extractDomain(lead)),
                execute: async (lead, enriched) => {
                    const query = lead.company || enriched.domain?.split(".")[0] || "";
                    if (!query)
                        return;
                    const source = index_1.sourceManager.get("wikidata");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(query);
                        if (companyData) {
                            enriched.company = enriched.company || companyData.name;
                            enriched.industry = enriched.industry || companyData.industry;
                            enriched.founded = enriched.founded || companyData.founded;
                            enriched.headquarters = enriched.headquarters || companyData.headquarters;
                            enriched.description = enriched.description || companyData.description;
                            this.addSource(enriched, "Wikidata", 0.15);
                            enriched.rawMetadata.wikidata = companyData.metadata;
                        }
                    }
                    catch {
                        // Wikidata failed
                    }
                },
            },
            // Step 8: GitHub organizations
            {
                name: "GitHub Orgs",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("github-orgs");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            enriched.company = enriched.company || companyData.name;
                            enriched.description = enriched.description || companyData.description;
                            enriched.github = companyData.socialMedia?.github || enriched.github;
                            this.addSource(enriched, "GitHub", 0.15);
                            enriched.rawMetadata.github = companyData.metadata;
                        }
                    }
                    catch {
                        // GitHub lookup failed
                    }
                },
            },
            // Step 9: NPM packages
            {
                name: "NPM",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("npm");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            enriched.techStack = this.mergeArrays(enriched.techStack, companyData.techStack);
                            this.addSource(enriched, "NPM", 0.1);
                            enriched.rawMetadata.npm = companyData.metadata;
                        }
                    }
                    catch {
                        // NPM lookup failed
                    }
                },
            },
            // Step 10: PyPI packages
            {
                name: "PyPI",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("pypi");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            enriched.techStack = this.mergeArrays(enriched.techStack, companyData.techStack);
                            this.addSource(enriched, "PyPI", 0.05);
                            enriched.rawMetadata.pypi = companyData.metadata;
                        }
                    }
                    catch {
                        // PyPI lookup failed
                    }
                },
            },
            // Step 11: Wayback Machine (historical data)
            {
                name: "Wayback Machine",
                condition: (lead) => !!this.extractDomain(lead),
                execute: async (lead, enriched) => {
                    const domain = enriched.domain;
                    const source = index_1.sourceManager.get("google-cache");
                    if (!source)
                        return;
                    try {
                        const companyData = await source.getCompany?.(domain);
                        if (companyData) {
                            this.addSource(enriched, "Wayback Machine", 0.05);
                            enriched.rawMetadata.wayback = companyData.metadata;
                        }
                    }
                    catch {
                        // Wayback lookup failed
                    }
                },
            },
            // Step 12: Email verification (if we have email)
            {
                name: "Email Verification",
                condition: (lead) => !!lead.email,
                execute: async (lead, enriched) => {
                    if (!lead.email)
                        return;
                    try {
                        const { verifyEmail } = await Promise.resolve().then(() => __importStar(require("../email/index")));
                        const result = await verifyEmail(lead.email);
                        enriched.emailScore = result.score;
                        enriched.emailValid = result.status === "valid";
                        this.addSource(enriched, "Email Verification", 0.15);
                        enriched.rawMetadata.emailVerification = {
                            score: result.score,
                            status: result.status,
                            details: result.details,
                        };
                    }
                    catch {
                        // Email verification failed
                    }
                },
            },
            // Step 13: Email Guesser (if we have name + domain but no email)
            {
                name: "Email Guesser",
                condition: (lead) => !lead.email && !!(lead.firstName && this.extractDomain(lead)),
                execute: async (lead, enriched) => {
                    if (!lead.firstName || !enriched.domain)
                        return;
                    const source = index_1.sourceManager.get("email-guesser");
                    if (!source)
                        return;
                    try {
                        const query = `${lead.firstName} ${lead.lastName || ""} ${enriched.domain}`.trim();
                        const results = await source.search(query, { count: 5 });
                        if (results.length > 0) {
                            const best = results[0];
                            enriched.email = best.email;
                            this.addSource(enriched, "Email Guesser", 0.1);
                            enriched.rawMetadata.emailGuesses = results.map((r) => ({
                                email: r.email,
                                confidence: r.confidence,
                                tags: r.tags,
                            }));
                        }
                    }
                    catch {
                        // Email guesser failed
                    }
                },
            },
        ];
    }
    extractDomain(lead) {
        // From email
        if (lead.email?.includes("@")) {
            const domain = lead.email.split("@")[1];
            if (domain && domain.includes("."))
                return domain;
        }
        // From website
        if (lead.website) {
            try {
                const url = new URL(lead.website.startsWith("http") ? lead.website : `https://${lead.website}`);
                return url.hostname;
            }
            catch {
                // Invalid URL
            }
        }
        // From company name (rough heuristic)
        if (lead.company) {
            const cleaned = lead.company.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (cleaned.length > 2)
                return `${cleaned}.com`;
        }
        return null;
    }
    addSource(enriched, sourceName, confidenceBoost) {
        if (!enriched.sources.includes(sourceName)) {
            enriched.sources.push(sourceName);
        }
        enriched.confidence = Math.min(1, enriched.confidence + confidenceBoost);
    }
    mergeArrays(existing, incoming) {
        const set = new Set(existing || []);
        for (const item of incoming || []) {
            set.add(item);
        }
        return Array.from(set);
    }
    calculateConfidence(enriched) {
        let score = 0;
        // Source count bonus (more sources = higher confidence)
        score += Math.min(0.3, enriched.sources.length * 0.05);
        // Data completeness
        if (enriched.firstName)
            score += 0.05;
        if (enriched.lastName)
            score += 0.05;
        if (enriched.email)
            score += 0.1;
        if (enriched.company)
            score += 0.1;
        if (enriched.industry)
            score += 0.05;
        if (enriched.headquarters)
            score += 0.05;
        if (enriched.founded)
            score += 0.05;
        if (enriched.techStack?.length)
            score += 0.05;
        if (enriched.phone)
            score += 0.05;
        if (enriched.linkedin || enriched.twitter || enriched.github)
            score += 0.05;
        // Email verification bonus
        if (enriched.emailValid)
            score += 0.1;
        return Math.min(1, score);
    }
}
exports.LeadEnricher = LeadEnricher;
// Singleton
exports.leadEnricher = new LeadEnricher();
