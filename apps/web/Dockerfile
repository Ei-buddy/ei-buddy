# Os manifestos do workspace (package.json de cada pacote, lockfile e config do
# pnpm), e so eles — NR-238. O install depende so disto; com o install antes do
# `COPY . .`, o BuildKit reaproveita a camada inteira enquanto nenhuma
# dependencia muda, e um deploy de codigo nao instala nada. Antes, todo commit
# invalidava o install, e na VPS ele levava de 8 a 50 minutos por app.
#
# O contexto entra por bind mount, sem virar camada; o RUN roda a cada build,
# mas a saida so muda quando um manifesto muda — e e o conteudo que o `COPY
# --from` abaixo compara.
FROM node:22-alpine AS manifestos
RUN --mount=type=bind,target=/src \
    mkdir /manifestos && cd /src \
    && for f in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
                apps/*/package.json packages/*/package.json; do \
         mkdir -p "/manifestos/$(dirname "$f")" && cp "$f" "/manifestos/$f"; \
       done

FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app

COPY --from=manifestos /manifestos/ ./

# O store do pnpm (o download de cada pacote) mora num cache do BuildKit que
# sobrevive entre builds na mesma maquina, e NAO na imagem — NR-230: quando o
# install roda, so desce o que mudou no lockfile.
#
# Sem `# syntax=`: `RUN --mount` ja vem no frontend embutido do BuildKit, e a
# linha faria o build baixar o frontend do Docker Hub a cada vez.
#
# So o que esta app usa: `--filter @na-regua/web...` instala ela e os pacotes do
# workspace de que ela depende, e nao o resto (o app mobile, as ferramentas da
# raiz) — NR-235. O cache de metadados do pnpm (~380 MB) tambem vai para um
# cache do BuildKit.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=pnpm-metadados,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @na-regua/web...

# O codigo vem depois do install. O `.dockerignore` deixa o node_modules de
# fora, entao isto nao apaga o que o install montou.
COPY . .

WORKDIR /app/apps/web

RUN pnpm build

# A imagem que roda leva so o servidor standalone do Next e os arquivos que ele
# carrega (~65 MB), e nao o node_modules do build (~2 GB) — NR-238. Na VPS,
# exportar e desempacotar a imagem do web levava 14 minutos por deploy, e cada
# versao guardada para a reversao ocupava 2 GB de disco.
FROM node:22-alpine

WORKDIR /app

# O servidor standalone escuta em HOSTNAME:PORT. Sem isto ele pegaria o
# HOSTNAME que o Docker poe no container (o id dele) e nao atenderia em
# localhost.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# O Next grava o cache de imagens otimizadas em `.next/cache`: o dono e o
# usuario que roda o servidor, e nao root.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
