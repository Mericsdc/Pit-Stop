FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && mkdir -p /app/data && chown node:node /app/data

# .dockerignore allows only application source, scripts, public files and optional assets.
COPY --chown=node:node . .
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HEALTH_PORT || '3000') + '/healthz', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "src/index.js"]
