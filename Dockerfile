# High Noon Hollow - one container, one game server.
FROM node:22-alpine

WORKDIR /app

# Dependencies first so code edits do not bust the layer cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY shared ./shared
COPY server ./server
COPY client ./client

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# /healthz reports live room and player counts, so this doubles as a readout.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O- http://127.0.0.1:8080/healthz > /dev/null || exit 1

USER node
CMD ["node", "server/index.js"]
