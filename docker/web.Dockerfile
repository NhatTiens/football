FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/api-football/package.json packages/api-football/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/sync/package.json packages/sync/package.json
RUN npm ci
COPY . .
RUN npm run build -w @football-ai/web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@football-ai/web"]
