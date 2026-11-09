# AgentPM API image (used by docker-compose full stack)
FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mcp-stdio/package.json apps/mcp-stdio/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["pnpm", "--filter", "@agentpm/api", "start"]
