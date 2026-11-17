FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY . .

# O store do pnpm (o download de cada pacote) mora num cache do BuildKit que
# sobrevive entre builds na mesma maquina, e NAO na imagem — NR-230. Antes, todo
# commit invalidava o `COPY . .` e o install baixava ~1,4 GB do npm de novo; na
# VPS, com a conexao instavel, era boa parte da hora de cada deploy. Agora so
# desce o que mudou no lockfile.
#
# Sem `# syntax=`: `RUN --mount` ja vem no frontend embutido do BuildKit, e a
# linha faria o build baixar o frontend do Docker Hub a cada vez.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

WORKDIR /app/apps/worker

CMD ["pnpm", "start"]
