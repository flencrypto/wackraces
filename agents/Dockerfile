# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
