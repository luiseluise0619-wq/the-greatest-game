# High Noon Hollow - one container, one game server.
FROM node:22-alpine

WORKDIR /app

# Dependencies first so code edits do not bust the layer cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY shared ./shared
COPY server ./server
COPY client ./client
# three.js is served to the browser straight out of node_modules, so a running
# container is redistributing it, and its MIT notice travels with it. So does
# what the software does with what it knows. Both are named in .dockerignore as
# exceptions to the "*.md" rule - without those lines this COPY does not quietly
# skip them, it fails the build.
COPY NOTICE.md PRIVACY.md ./

# Telemetry appends to ./data. The process runs as `node`, so the directory has
# to exist and be writable by it - otherwise the server starts, warns, and
# quietly turns the playtest readout off, which is the one thing you deployed
# it to collect. Mount a volume here to keep it across restarts.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# /healthz reports live room and player counts, so this doubles as a readout.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O- http://127.0.0.1:8080/healthz > /dev/null || exit 1

USER node
CMD ["node", "server/index.js"]
