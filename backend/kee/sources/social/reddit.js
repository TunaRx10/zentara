"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedditSourceSource = void 0;
// Reddit — Reddit user profiles
const base_1 = require("../base");
class RedditSourceSource extends base_1.BaseSource {
    name = "Reddit";
    id = "reddit";
    category = "social";
    requiresApiKey = false;
    rateLimit = 30; // Reddit is strict about rate limits
    async search(query, options) {
        const count = Math.min(options?.count || 10, 100);
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${count}&sort=relevance`;
        const data = await this.fetchJson(url, {
            "User-Agent": "KeeLead/1.0",
        });
        if (!data?.data?.children?.length)
            return [];
        const leads = [];
        const seen = new Set();
        for (const child of data.data.children) {
            const post = child.data;
            if (!post.author || post.author === "[deleted]" || post.author === "AutoModerator")
                continue;
            if (seen.has(post.author))
                continue;
            seen.add(post.author);
            // Extract organization hints from flair
            const company = post.author_flair_text || options?.company;
            leads.push(this.makeLead({
                firstName: post.author,
                lastName: "",
                company,
                title: `r/${post.subreddit} Contributor`,
                website: `https://reddit.com${post.permalink}`,
                confidence: 0.4,
                tags: [
                    "social", "reddit",
                    `subreddit:${post.subreddit}`,
                    ...(post.link_flair_text ? [post.link_flair_text] : []),
                ],
                metadata: {
                    source: "Reddit",
                    username: post.author,
                    subreddit: post.subreddit,
                    postTitle: post.title,
                    score: post.score,
                    numComments: post.num_comments,
                    flair: post.author_flair_text,
                    createdUtc: post.created_utc,
                },
            }));
        }
        return leads;
    }
    async getCompany(domain) {
        // Search Reddit for mentions of the company
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(domain)}&limit=5`;
        const data = await this.fetchJson(url, { "User-Agent": "KeeLead/1.0" });
        if (!data?.data?.children?.length)
            return null;
        const subreddits = new Set();
        let totalScore = 0;
        for (const child of data.data.children) {
            subreddits.add(child.data.subreddit);
            totalScore += child.data.score;
        }
        return this.makeCompany({
            name: domain.replace(/\.(com|io|co|org|net)$/, ""),
            domain,
            website: `https://${domain}`,
            description: `Mentioned in ${subreddits.size} subreddits with ${totalScore} total upvotes`,
            industry: "Technology",
            metadata: {
                subreddits: [...subreddits],
                totalMentions: data.data.children.length,
            },
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
exports.RedditSourceSource = RedditSourceSource;
exports.default = new RedditSourceSource();
