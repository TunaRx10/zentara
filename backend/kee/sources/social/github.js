"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubSource2Source = void 0;
// GitHub — Real GitHub users search via public Search API (no auth required, 60 req/hr)
const base_1 = require("../base");
class GitHubSource2Source extends base_1.BaseSource {
    name = "GitHub";
    id = "github";
    category = "social";
    requiresApiKey = false;
    rateLimit = 10;
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "KeeLead/1.0",
    };
    async search(query, options) {
        const count = Math.min(options?.count || 10, 30);
        const leads = [];
        try {
            const searchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=${count}`;
            const searchResult = await this.fetchJson(searchUrl, this.headers);
            if (!searchResult?.items?.length) {
                return leads;
            }
            for (const user of searchResult.items) {
                try {
                    // Fetch detailed profile for each user
                    const profileUrl = `https://api.github.com/users/${encodeURIComponent(user.login)}`;
                    const profile = await this.fetchJson(profileUrl, this.headers);
                    if (!profile)
                        continue;
                    const nameParts = (profile.name || user.login).split(" ");
                    const firstName = nameParts[0] || user.login;
                    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
                    // Build tags from profile data
                    const tags = ["social", "github"];
                    if (profile.company)
                        tags.push("company");
                    if (profile.blog)
                        tags.push("has-website");
                    if (profile.twitter_username)
                        tags.push("has-twitter");
                    if (profile.public_repos > 50)
                        tags.push("prolific");
                    leads.push(this.makeLead({
                        firstName,
                        lastName,
                        company: profile.company?.replace(/^@/, "") || options?.company || undefined,
                        title: profile.bio || undefined,
                        email: profile.email || undefined,
                        location: profile.location || options?.location || undefined,
                        website: profile.blog || undefined,
                        twitter: profile.twitter_username ? `@${profile.twitter_username}` : undefined,
                        confidence: this.calculateConfidence(profile),
                        tags,
                        metadata: {
                            source: "GitHub",
                            github_username: profile.login,
                            github_url: profile.html_url,
                            avatar_url: profile.avatar_url,
                            public_repos: profile.public_repos,
                            followers: profile.followers,
                            following: profile.following,
                            bio: profile.bio,
                        },
                    }));
                }
                catch {
                    // Skip individual user fetch errors
                    continue;
                }
            }
        }
        catch {
            // Return empty on search failure
        }
        return leads;
    }
    async getCompany(domain) {
        try {
            // Search for orgs matching the domain name
            const orgName = domain.replace(/\.(com|io|co|org|net|dev)$/, "");
            const url = `https://api.github.com/orgs/${encodeURIComponent(orgName)}`;
            const org = await this.fetchJson(url, this.headers);
            if (!org)
                return null;
            return this.makeCompany({
                name: org.name || org.login,
                domain,
                website: org.blog || `https://github.com/${org.login}`,
                description: org.description || undefined,
                headquarters: org.location || undefined,
                logo: org.avatar_url,
                socialMedia: {
                    github: `https://github.com/${org.login}`,
                    ...(org.twitter_username ? { twitter: `https://twitter.com/${org.twitter_username}` } : {}),
                },
                metadata: {
                    public_repos: org.public_repos,
                    followers: org.followers,
                },
            });
        }
        catch {
            return null;
        }
    }
    async getContact(email) {
        try {
            // Try searching by email via GitHub API
            const url = `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email&per_page=1`;
            const result = await this.fetchJson(url, this.headers);
            if (!result?.items?.length) {
                // Fallback: extract name from email
                const [local, domain] = email.split("@");
                const parts = local.split(/[._-]/);
                return {
                    name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
                    email,
                    company: domain.replace(/\.(com|io|co|org|net)$/, ""),
                    confidence: 0.3,
                    source: this.name,
                };
            }
            const profileUrl = `https://api.github.com/users/${encodeURIComponent(result.items[0].login)}`;
            const profile = await this.fetchJson(profileUrl, this.headers);
            if (!profile)
                return null;
            return {
                name: profile.name || profile.login,
                email: profile.email || email,
                company: profile.company?.replace(/^@/, "") || undefined,
                twitter: profile.twitter_username ? `@${profile.twitter_username}` : undefined,
                location: profile.location || undefined,
                confidence: profile.email?.toLowerCase() === email.toLowerCase() ? 0.9 : 0.6,
                source: this.name,
            };
        }
        catch {
            return null;
        }
    }
    calculateConfidence(profile) {
        let score = 0.5;
        if (profile.email)
            score += 0.15;
        if (profile.name)
            score += 0.1;
        if (profile.company)
            score += 0.1;
        if (profile.location)
            score += 0.05;
        if (profile.blog)
            score += 0.05;
        if (profile.public_repos > 10)
            score += 0.05;
        return Math.min(score, 0.95);
    }
}
exports.GitHubSource2Source = GitHubSource2Source;
exports.default = new GitHubSource2Source();
