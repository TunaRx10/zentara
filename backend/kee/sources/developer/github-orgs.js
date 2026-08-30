"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubOrgsSourceSource = void 0;
// GitHub Organizations — Real GitHub org search via public Search API (no auth required, 60 req/hr)
const base_1 = require("../base");
class GitHubOrgsSourceSource extends base_1.BaseSource {
    name = "GitHub Organizations";
    id = "github-orgs";
    category = "developer";
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
            // Search for organizations specifically
            const searchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(query)}+type:org&per_page=${count}`;
            const searchResult = await this.fetchJson(searchUrl, this.headers);
            if (!searchResult?.items?.length) {
                return leads;
            }
            for (const org of searchResult.items) {
                try {
                    // Fetch detailed org info
                    const orgUrl = `https://api.github.com/orgs/${encodeURIComponent(org.login)}`;
                    const orgDetail = await this.fetchJson(orgUrl, this.headers);
                    if (!orgDetail)
                        continue;
                    // Fetch first few members
                    const membersUrl = `https://api.github.com/orgs/${encodeURIComponent(org.login)}/members?per_page=5`;
                    const members = await this.fetchJson(membersUrl, this.headers);
                    const tags = ["developer", "github-org"];
                    if (orgDetail.blog)
                        tags.push("has-website");
                    if (orgDetail.email)
                        tags.push("has-email");
                    if (orgDetail.twitter_username)
                        tags.push("has-twitter");
                    if (orgDetail.public_repos > 20)
                        tags.push("large-org");
                    // Create a lead for the org itself
                    const orgName = orgDetail.name || orgDetail.login;
                    const nameParts = orgName.split(" ");
                    leads.push(this.makeLead({
                        firstName: nameParts[0] || orgDetail.login,
                        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Organization",
                        company: orgName,
                        title: orgDetail.description || "GitHub Organization",
                        email: orgDetail.email || undefined,
                        location: orgDetail.location || options?.location || undefined,
                        website: orgDetail.blog || orgDetail.html_url,
                        twitter: orgDetail.twitter_username ? `@${orgDetail.twitter_username}` : undefined,
                        confidence: this.calculateOrgConfidence(orgDetail),
                        tags,
                        metadata: {
                            source: "GitHub Organizations",
                            org_type: "organization",
                            github_url: orgDetail.html_url,
                            avatar_url: orgDetail.avatar_url,
                            public_repos: orgDetail.public_repos,
                            followers: orgDetail.followers,
                            members_count: members?.length || 0,
                            members: members?.slice(0, 5).map(m => ({
                                login: m.login,
                                url: m.html_url,
                            })) || [],
                            description: orgDetail.description,
                        },
                    }));
                    // Also create leads for top members if available
                    if (members?.length) {
                        for (const member of members.slice(0, 3)) {
                            try {
                                const memberUrl = `https://api.github.com/users/${encodeURIComponent(member.login)}`;
                                const memberProfile = await this.fetchJson(memberUrl, this.headers);
                                if (!memberProfile)
                                    continue;
                                const memberNameParts = (memberProfile.name || member.login).split(" ");
                                leads.push(this.makeLead({
                                    firstName: memberNameParts[0] || member.login,
                                    lastName: memberNameParts.length > 1 ? memberNameParts.slice(1).join(" ") : "",
                                    company: orgName,
                                    title: memberProfile.bio || `Member at ${orgName}`,
                                    email: memberProfile.email || undefined,
                                    location: memberProfile.location || undefined,
                                    website: memberProfile.blog || undefined,
                                    twitter: memberProfile.twitter_username ? `@${memberProfile.twitter_username}` : undefined,
                                    confidence: this.calculateMemberConfidence(memberProfile),
                                    tags: ["developer", "github-org-member", orgDetail.login],
                                    metadata: {
                                        source: "GitHub Organizations",
                                        org_name: orgName,
                                        github_username: member.login,
                                        github_url: memberProfile.html_url,
                                        avatar_url: memberProfile.avatar_url,
                                        public_repos: memberProfile.public_repos,
                                        bio: memberProfile.bio,
                                    },
                                }));
                            }
                            catch {
                                continue;
                            }
                        }
                    }
                }
                catch {
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
            const orgName = domain.replace(/\.(com|io|co|org|net|dev)$/, "");
            const url = `https://api.github.com/orgs/${encodeURIComponent(orgName)}`;
            const org = await this.fetchJson(url, this.headers);
            if (!org)
                return null;
            // Fetch members for key people
            const membersUrl = `https://api.github.com/orgs/${encodeURIComponent(org.login)}/members?per_page=5`;
            const members = await this.fetchJson(membersUrl, this.headers);
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
                keyPeople: members?.map(m => ({
                    name: m.login,
                    title: "Member",
                    linkedin: undefined,
                    confidence: 0.5,
                })) || [],
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
            const url = `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email+type:org&per_page=1`;
            const result = await this.fetchJson(url, this.headers);
            if (!result?.items?.length) {
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
            const orgUrl = `https://api.github.com/orgs/${encodeURIComponent(result.items[0].login)}`;
            const org = await this.fetchJson(orgUrl, this.headers);
            if (!org)
                return null;
            return {
                name: org.name || org.login,
                email: org.email || email,
                company: org.name || org.login,
                twitter: org.twitter_username ? `@${org.twitter_username}` : undefined,
                location: org.location || undefined,
                confidence: org.email?.toLowerCase() === email.toLowerCase() ? 0.85 : 0.5,
                source: this.name,
            };
        }
        catch {
            return null;
        }
    }
    calculateOrgConfidence(org) {
        let score = 0.5;
        if (org.email)
            score += 0.15;
        if (org.name)
            score += 0.1;
        if (org.description)
            score += 0.05;
        if (org.blog)
            score += 0.05;
        if (org.location)
            score += 0.05;
        if (org.public_repos > 5)
            score += 0.05;
        return Math.min(score, 0.95);
    }
    calculateMemberConfidence(profile) {
        let score = 0.45;
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
        return Math.min(score, 0.9);
    }
}
exports.GitHubOrgsSourceSource = GitHubOrgsSourceSource;
exports.default = new GitHubOrgsSourceSource();
