FROM node:22.21.1-trixie-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY patches ./patches
COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY skills ./skills

RUN pnpm install --frozen-lockfile
RUN pnpm build

CMD ["bash"]
