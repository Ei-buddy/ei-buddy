FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/api

EXPOSE 3333

CMD ["pnpm", "start"]
