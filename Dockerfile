# PeopleHub HRMS — production image (SPA + API + desktop-agent downloads in one container).
# Build:  docker build -t peoplehub .
# Run:    docker compose up -d   (see docker-compose.yml and docs/DEPLOYMENT.md)

# 1) Build the single-page app
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY client client
RUN npm run build -w client

# 2) Cross-compile the desktop agent for Windows and macOS (served from Productivity → Devices)
FROM golang:1.23-bookworm AS agent
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent .
ARG AGENT_VERSION=1.1.0
RUN go run ./tools/dist -out /agent/dist -version "$AGENT_VERSION"

# 3) Runtime: API server with production dependencies only
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DB_PATH=/data/hrms.db UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups AGENT_DIST_DIR=/app/agent/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY server server
COPY scripts scripts
COPY --from=web /app/client/dist client/dist
COPY --from=agent /agent/dist agent/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server/src/index.js"]
