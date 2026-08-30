"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StackOverflowSourceSource = void 0;
// Stack Overflow — Real Stack Overflow developer search via public Stack Exchange API (no key required, 300 req/day)
const base_1 = require("../base");
class StackOverflowSourceSource extends base_1.BaseSource {
    name = "Stack Overflow";
    id = "stackoverflow";
    category = "developer";
    requiresApiKey = false;
    rateLimit = 30;
    headers = {
        "Accept": "application/json",
    };
    async search(query, options) {
        const count = Math.min(options?.count || 10, 30);
        const leads = [];
        try {
            const searchUrl = `https://api.stackexchange.com/2.3/search?intitle=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${count}&filter=withbody`;
            const searchResult = await this.fetchJson(searchUrl, this.headers);
            if (!searchResult?.items?.length) {
                return leads;
            }
            // Deduplicate by user_id to avoid multiple leads for same person
            const seenUsers = new Set();
            for (const question of searchResult.items) {
                const userId = question.owner.user_id;
                if (seenUsers.has(userId))
                    continue;
                seenUsers.add(userId);
                try {
                    // Fetch detailed user info
                    const userUrl = `https://api.stackexchange.com/2.3/users/${userId}?site=stackoverflow&filter=default`;
                    const userResult = await this.fetchJson(userUrl, this.headers);
                    const userDetail = userResult?.items?.[0];
                    const nameParts = question.owner.display_name.split(" ");
                    const firstName = nameParts[0] || question.owner.display_name;
                    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
                    // Extract email from about_me HTML if present
                    const email = userDetail?.about_me ? this.extractEmail(userDetail.about_me) : undefined;
                    // Extract website
                    const website = userDetail?.website_url || undefined;
                    // Extract location
                    const location = userDetail?.location || options?.location || undefined;
                    const tags = ["developer", "stackoverflow"];
                    if (question.tags.length > 0)
                        tags.push(...question.tags.slice(0, 5));
                    if (userDetail && userDetail.reputation > 1000)
                        tags.push("high-rep");
                    if (userDetail && userDetail.badge_counts.gold > 0)
                        tags.push("gold-badge");
                    const reputation = userDetail?.reputation || question.owner.reputation;
                    const badgeCounts = userDetail?.badge_counts;
                    leads.push(this.makeLead({
                        firstName,
                        lastName,
                        company: options?.company || undefined,
                        title: this.inferTitle(reputation, question.tags),
                        email,
                        location,
                        website,
                        confidence: this.calculateConfidence(userDetail, question),
                        tags,
                        metadata: {
                            source: "Stack Overflow",
                            stackoverflow_user_id: userId,
                            stackoverflow_url: question.owner.link,
                            avatar_url: question.owner.profile_image,
                            reputation,
                            badge_counts: badgeCounts ? {
                                gold: badgeCounts.gold,
                                silver: badgeCounts.silver,
                                bronze: badgeCounts.bronze,
                            } : undefined,
                            question_title: question.title,
                            question_score: question.score,
                            question_answer_count: question.answer_count,
                            question_link: question.link,
                            top_tags: question.tags.slice(0, 5),
                        },
                    }));
                }
                catch {
                    // If user detail fetch fails, still create a lead from question data
                    const nameParts = question.owner.display_name.split(" ");
                    leads.push(this.makeLead({
                        firstName: nameParts[0] || question.owner.display_name,
                        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "",
                        title: this.inferTitle(question.owner.reputation, question.tags),
                        confidence: 0.4,
                        tags: ["developer", "stackoverflow", ...question.tags.slice(0, 3)],
                        metadata: {
                            source: "Stack Overflow",
                            stackoverflow_user_id: userId,
                            stackoverflow_url: question.owner.link,
                            reputation: question.owner.reputation,
                            question_title: question.title,
                        },
                    }));
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
        // Stack Overflow doesn't provide company data directly
        // Try to find questions tagged with the company name
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: `Company info derived from Stack Overflow activity`,
            industry: "Technology",
        });
    }
    async getContact(email) {
        try {
            // Search for user by display name (best effort)
            const [local] = email.split("@");
            const searchUrl = `https://api.stackexchange.com/2.3/users?inname=${encodeURIComponent(local)}&site=stackoverflow&pagesize=5&sort=reputation&order=desc`;
            const result = await this.fetchJson(searchUrl, this.headers);
            if (!result?.items?.length) {
                const parts = local.split(/[._-]/);
                return {
                    name: parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
                    email,
                    confidence: 0.3,
                    source: this.name,
                };
            }
            // Find best match
            const bestMatch = result.items.find(u => {
                const normalizedName = u.display_name.toLowerCase().replace(/\s+/g, "");
                const normalizedLocal = local.toLowerCase().replace(/[._-]/g, "");
                return normalizedName.includes(normalizedLocal) || normalizedLocal.includes(normalizedName);
            }) || result.items[0];
            return {
                name: bestMatch.display_name,
                email,
                location: bestMatch.location || undefined,
                confidence: 0.5,
                source: this.name,
            };
        }
        catch {
            return null;
        }
    }
    extractEmail(html) {
        // Simple email extraction from about_me HTML
        const emailMatch = html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        return emailMatch?.[0];
    }
    inferTitle(reputation, tags) {
        if (reputation > 50000)
            return "Senior Developer / Stack Overflow Legend";
        if (reputation > 25000)
            return "Senior Developer";
        if (reputation > 10000)
            return "Experienced Developer";
        if (reputation > 5000)
            return "Developer";
        if (reputation > 1000)
            return "Developer";
        return "Developer";
    }
    calculateConfidence(user, question) {
        let score = 0.4;
        if (user) {
            if (user.location)
                score += 0.1;
            if (user.website_url)
                score += 0.1;
            if (user.about_me)
                score += 0.05;
            if (user.reputation > 1000)
                score += 0.1;
            if (user.reputation > 5000)
                score += 0.05;
            if (user.badge_counts.gold > 0)
                score += 0.05;
        }
        if (question.score > 5)
            score += 0.05;
        if (question.answer_count > 0)
            score += 0.05;
        return Math.min(score, 0.9);
    }
}
exports.StackOverflowSourceSource = StackOverflowSourceSource;
exports.default = new StackOverflowSourceSource();
