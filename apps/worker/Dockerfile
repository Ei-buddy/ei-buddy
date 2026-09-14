FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/worker

CMD ["pnpm", "start"]
