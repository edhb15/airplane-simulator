# Skyward multiplayer server — for Fly.io, Railway, Koyeb, a VPS or any Docker host.
#   docker build -t skyward-mp . && docker run -p 8080:8080 -e ALLOWED_ORIGINS=https://edhb15.github.io skyward-mp
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "server/server.js"]
