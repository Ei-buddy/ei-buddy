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
#
# So o que esta app usa: `--filter @na-regua/worker...` instala ela e os pacotes do
# workspace de que ela depende, e nao o resto — o app mobile (Expo, React
# Native), o Next e as ferramentas da raiz (eslint, playwright, turbo) ficavam
# em toda imagem, com 3,3 GB cada — NR-235. O cache de metadados do pnpm
# (~380 MB) tambem vai para um cache do BuildKit, e nao para a imagem.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=pnpm-metadados,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @na-regua/worker...

WORKDIR /app/apps/worker

CMD ["pnpm", "start"]
