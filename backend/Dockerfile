# Zentara Backend — Dockerfile for Koyeb deployment
# Stateless container, Node 22 + Python 3 (minimal, for LinkedIn jobs-guest scraping)

FROM node:22-slim

# Minimal Python for LinkedIn jobs-guest + scrapers (photon)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* /root/.cache/*

# Python deps minimales (requests + bs4 pour jobs-guest, photon)
RUN pip3 install --no-cache-dir --break-system-packages requests beautifulsoup4 urllib3

WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy entire backend (vendored deps, linkedin/, scrapers/, etc.)
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p /app/data

# Koyeb sets PORT env var — fallback to 4000
ENV PORT=4000
ENV PYTHON=python3
ENV LISTEN_HOST=0.0.0.0
ENV ZENTARA_DB_PATH=/app/data/zentara.db

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "server.js"]