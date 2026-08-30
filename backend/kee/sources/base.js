"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSource = void 0;
class BaseSource {
    enabled = true;
    makeLead(overrides) {
        return {
            firstName: "",
            lastName: "",
            source: this.name,
            confidence: 0.5,
            ...overrides,
        };
    }
    makeCompany(overrides) {
        return {
            name: "",
            ...overrides,
        };
    }
    async fetchJson(url, headers) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    randomFrom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    generatePhone() {
        return `+1 (${this.randomInt(200, 999)}) ${this.randomInt(200, 999)}-${this.randomInt(1000, 9999)}`;
    }
    generateDomain(company) {
        return company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
    }
}
exports.BaseSource = BaseSource;
