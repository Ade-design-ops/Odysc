# Build both applications from the repository root; secrets are runtime-only.
FROM node:24-bookworm-slim AS backend-build
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
COPY shared /build/shared
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_BACKEND=supabase \
    FRONTEND_DIST_DIRECTORY=/app/public \
    RESUME_DIRECTORY=/app/data/resumes \
    SUPABASE_DB_CA_FILE=/app/certs/supabase-root.crt \
    AUTH_FRONTEND_ROUTING=hash \
    SEED_DEMO=false
COPY --from=backend-build --chown=node:node /build/backend/package.json /build/backend/package-lock.json ./
COPY --from=backend-build --chown=node:node /build/backend/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /build/backend/dist ./dist
COPY --from=client-build --chown=node:node /build/client/dist ./public
COPY --chown=node:node deploy/supabase-root.crt ./certs/supabase-root.crt
RUN mkdir -p /app/data/resumes && chown -R node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
