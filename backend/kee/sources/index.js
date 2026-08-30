"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLikelyEmails = exports.verifyPermutations = exports.generatePermutations = exports.leadEnricher = exports.LeadEnricher = exports.sourceManager = exports.SourceManager = void 0;
// Import all sources
const google_1 = __importDefault(require("./search/google"));
const bing_1 = __importDefault(require("./search/bing"));
const duckduckgo_1 = __importDefault(require("./search/duckduckgo"));
const brave_1 = __importDefault(require("./search/brave"));
const searxng_1 = __importDefault(require("./search/searxng"));
const google_cache_1 = __importDefault(require("./search/google-cache"));
const linkedin_1 = __importDefault(require("./professional/linkedin"));
const linkedin_live_1 = __importDefault(require("./professional/linkedin-live"));
const xing_1 = __importDefault(require("./professional/xing"));
const angellist_1 = __importDefault(require("./professional/angellist"));
const crunchbase_1 = __importDefault(require("./professional/crunchbase"));
const opencorporates_1 = __importDefault(require("./company/opencorporates"));
const sec_edgar_1 = __importDefault(require("./company/sec-edgar"));
const companies_house_1 = __importDefault(require("./company/companies-house"));
const glassdoor_1 = __importDefault(require("./company/glassdoor"));
const indeed_1 = __importDefault(require("./company/indeed"));
const builtin_1 = __importDefault(require("./company/builtin"));
const g2_1 = __importDefault(require("./company/g2"));
const builtwith_1 = __importDefault(require("./company/builtwith"));
const openstreetmap_1 = __importDefault(require("./local/openstreetmap"));
const google_maps_1 = __importDefault(require("./local/google-maps"));
const yelp_1 = __importDefault(require("./local/yelp"));
const yellowpages_1 = __importDefault(require("./local/yellowpages"));
const foursquare_1 = __importDefault(require("./local/foursquare"));
const bbb_1 = __importDefault(require("./local/bbb"));
const chamberofcommerce_1 = __importDefault(require("./local/chamberofcommerce"));
const thumbtack_1 = __importDefault(require("./local/thumbtack"));
const homeadvisor_1 = __importDefault(require("./local/homeadvisor"));
const twitter_1 = __importDefault(require("./social/twitter"));
const github_1 = __importDefault(require("./social/github"));
const reddit_1 = __importDefault(require("./social/reddit"));
const facebook_1 = __importDefault(require("./social/facebook"));
const instagram_1 = __importDefault(require("./social/instagram"));
const tiktok_1 = __importDefault(require("./social/tiktok"));
const youtube_1 = __importDefault(require("./social/youtube"));
const pinterest_1 = __importDefault(require("./social/pinterest"));
const github_orgs_1 = __importDefault(require("./developer/github-orgs"));
const stackoverflow_1 = __importDefault(require("./developer/stackoverflow"));
const devto_1 = __importDefault(require("./developer/devto"));
const npm_1 = __importDefault(require("./developer/npm"));
const pypi_1 = __importDefault(require("./developer/pypi"));
const dockerhub_1 = __importDefault(require("./developer/dockerhub"));
const producthunt_1 = __importDefault(require("./startup/producthunt"));
const indiehackers_1 = __importDefault(require("./startup/indiehackers"));
const betalist_1 = __importDefault(require("./startup/betalist"));
const f6s_1 = __importDefault(require("./startup/f6s"));
const gust_1 = __importDefault(require("./startup/gust"));
const samgov_1 = __importDefault(require("./government/samgov"));
const usaspending_1 = __importDefault(require("./government/usaspending"));
const census_1 = __importDefault(require("./government/census"));
const eu_register_1 = __importDefault(require("./government/eu-register"));
const patents_1 = __importDefault(require("./government/patents"));
const trademarks_1 = __importDefault(require("./government/trademarks"));
const google_scholar_1 = __importDefault(require("./education/google-scholar"));
const researchgate_1 = __importDefault(require("./education/researchgate"));
const orcid_1 = __importDefault(require("./education/orcid"));
const academia_1 = __importDefault(require("./education/academia"));
const wikidata_1 = __importDefault(require("./education/wikidata"));
const hunter_1 = __importDefault(require("./email/hunter"));
const clearbit_1 = __importDefault(require("./email/clearbit"));
const whois_1 = __importDefault(require("./email/whois"));
const dns_lookup_1 = __importDefault(require("./email/dns-lookup"));
const ssl_cert_1 = __importDefault(require("./email/ssl-cert"));
const email_guesser_1 = __importDefault(require("./email/email-guesser"));
const eventbrite_1 = __importDefault(require("./events/eventbrite"));
const meetup_1 = __importDefault(require("./events/meetup"));
const luma_1 = __importDefault(require("./events/luma"));
const conference_speakers_1 = __importDefault(require("./events/conference-speakers"));
// Master registry — 67 data sources
const ALL_SOURCES = [
    // Search (6)
    google_1.default, bing_1.default, duckduckgo_1.default, brave_1.default, searxng_1.default, google_cache_1.default,
    // Professional (5)
    linkedin_1.default, linkedin_live_1.default, xing_1.default, angellist_1.default, crunchbase_1.default,
    // Company (8)
    opencorporates_1.default, sec_edgar_1.default, companies_house_1.default, glassdoor_1.default, indeed_1.default, builtin_1.default, g2_1.default, builtwith_1.default,
    // Local (9)
    openstreetmap_1.default, google_maps_1.default, yelp_1.default, yellowpages_1.default, foursquare_1.default, bbb_1.default, chamberofcommerce_1.default, thumbtack_1.default, homeadvisor_1.default,
    // Social (8)
    twitter_1.default, github_1.default, reddit_1.default, facebook_1.default, instagram_1.default, tiktok_1.default, youtube_1.default, pinterest_1.default,
    // Developer (6)
    github_orgs_1.default, stackoverflow_1.default, devto_1.default, npm_1.default, pypi_1.default, dockerhub_1.default,
    // Startup (5)
    producthunt_1.default, indiehackers_1.default, betalist_1.default, f6s_1.default, gust_1.default,
    // Government (6)
    samgov_1.default, usaspending_1.default, census_1.default, eu_register_1.default, patents_1.default, trademarks_1.default,
    // Education (5)
    google_scholar_1.default, researchgate_1.default, orcid_1.default, academia_1.default, wikidata_1.default,
    // Email (6)
    hunter_1.default, clearbit_1.default, whois_1.default, dns_lookup_1.default, ssl_cert_1.default, email_guesser_1.default,
    // Events (4)
    eventbrite_1.default, meetup_1.default, luma_1.default, conference_speakers_1.default,
];
class SourceManager {
    sources;
    weights;
    constructor() {
        this.sources = new Map();
        this.weights = new Map();
        for (const source of ALL_SOURCES) {
            this.sources.set(source.id, source);
            this.weights.set(source.id, 1.0);
        }
    }
    /** Get all registered sources */
    getAll() {
        return Array.from(this.sources.values());
    }
    /** Get only enabled sources */
    getEnabled() {
        return this.getAll().filter((s) => s.enabled);
    }
    /** Get sources by category */
    getByCategory(category) {
        return this.getAll().filter((s) => s.category === category);
    }
    /** Get a source by ID */
    get(id) {
        return this.sources.get(id);
    }
    /** Enable/disable a source */
    setEnabled(id, enabled) {
        const source = this.sources.get(id);
        if (source)
            source.enabled = enabled;
    }
    /** Set weight for a source (affects result ranking) */
    setWeight(id, weight) {
        this.weights.set(id, Math.max(0, Math.min(5, weight)));
    }
    /** Get weight for a source */
    getWeight(id) {
        return this.weights.get(id) || 1.0;
    }
    /** Search across all enabled sources with concurrency control */
    async searchAll(query, options) {
        const enabled = this.getEnabled();
        const batchSize = 5; // concurrent requests
        const allLeads = [];
        for (let i = 0; i < enabled.length; i += batchSize) {
            const batch = enabled.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async (source) => {
                const weight = this.weights.get(source.id) || 1.0;
                const leads = await source.search(query, options);
                return leads.map((l) => ({
                    ...l,
                    confidence: Math.min(1, l.confidence * weight),
                    source: source.name,
                }));
            }));
            for (const result of results) {
                if (result.status === "fulfilled") {
                    allLeads.push(...result.value);
                }
            }
        }
        return this.deduplicate(allLeads);
    }
    /** Search specific sources by ID */
    async searchSources(sourceIds, query, options) {
        const allLeads = [];
        const promises = sourceIds.map(async (id) => {
            const source = this.sources.get(id);
            if (!source || !source.enabled)
                return [];
            try {
                return await source.search(query, options);
            }
            catch {
                return [];
            }
        });
        const results = await Promise.allSettled(promises);
        for (const result of results) {
            if (result.status === "fulfilled")
                allLeads.push(...result.value);
        }
        return this.deduplicate(allLeads);
    }
    /** Research a company across all sources that support it */
    async researchCompany(domain) {
        const enabled = this.getEnabled().filter((s) => s.getCompany);
        for (const source of enabled) {
            try {
                const data = await source.getCompany(domain);
                if (data)
                    return data;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    /** Find a contact across all sources that support it */
    async findContact(email) {
        const enabled = this.getEnabled().filter((s) => s.getContact);
        for (const source of enabled) {
            try {
                const data = await source.getContact(email);
                if (data && data.confidence > 0.5)
                    return data;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    /** Get summary stats */
    getStats() {
        const all = this.getAll();
        const categories = {};
        let apiRequired = 0;
        let enabled = 0;
        for (const s of all) {
            categories[s.category] = (categories[s.category] || 0) + 1;
            if (s.requiresApiKey)
                apiRequired++;
            if (s.enabled)
                enabled++;
        }
        return {
            total: all.length,
            enabled,
            apiKeyRequired: apiRequired,
            free: all.length - apiRequired,
            categories,
        };
    }
    /** Deduplicate leads by email or name+company */
    deduplicate(leads) {
        const seen = new Set();
        return leads.filter((lead) => {
            const key = lead.email || `${lead.firstName}-${lead.lastName}-${lead.company}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        }).sort((a, b) => b.confidence - a.confidence);
    }
}
exports.SourceManager = SourceManager;
// Singleton
exports.sourceManager = new SourceManager();
// Re-export new tools
var lead_enricher_1 = require("../enrichment/lead-enricher");
Object.defineProperty(exports, "LeadEnricher", { enumerable: true, get: function () { return lead_enricher_1.LeadEnricher; } });
Object.defineProperty(exports, "leadEnricher", { enumerable: true, get: function () { return lead_enricher_1.leadEnricher; } });
var permutator_1 = require("../email/permutator");
Object.defineProperty(exports, "generatePermutations", { enumerable: true, get: function () { return permutator_1.generatePermutations; } });
Object.defineProperty(exports, "verifyPermutations", { enumerable: true, get: function () { return permutator_1.verifyPermutations; } });
Object.defineProperty(exports, "findLikelyEmails", { enumerable: true, get: function () { return permutator_1.findLikelyEmails; } });
