# Os manifestos do workspace (package.json de cada pacote, lockfile e config do
# pnpm), e so eles — NR-238. O install depende so disto; com o install antes do
# `COPY . .`, o BuildKit reaproveita a camada inteira enquanto nenhuma
# dependencia muda, e um deploy de codigo nao instala nada. Antes, todo commit
# invalidava o install, e na VPS ele levava de 8 a 50 minutos por app.
#
# O contexto entra por bind mount, sem virar camada; o RUN roda a cada build,
# mas a saida so muda quando um manifesto muda — e e o conteudo que o `COPY
# --from` abaixo compara.
#
# Os dois caches do pnpm entram aqui so para contar como usados a cada
# deploy: o Docker da VPS apaga cache montado que passa 48 h sem uso (regra 0
# da limpeza automatica dele, no diagnostico), e com o install quase sempre
# no cache eles ficariam parados.
FROM node:22-alpine AS manifestos
RUN --mount=type=bind,target=/src \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=pnpm-metadados,target=/root/.cache/pnpm,sharing=locked \
    mkdir /manifestos && cd /src \
    && for f in package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
                apps/*/package.json packages/*/package.json; do \
         mkdir -p "/manifestos/$(dirname "$f")" && cp "$f" "/manifestos/$f"; \
       done

FROM node:22-alpine

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
# So o que esta app usa: `--filter @na-regua/worker...` instala ela e os pacotes
# do workspace de que ela depende, e nao o resto — o app mobile (Expo, React
# Native), o Next e as ferramentas da raiz (eslint, playwright, turbo) ficavam
# em toda imagem, com 3,3 GB cada — NR-235. O cache de metadados do pnpm
# (~380 MB) tambem vai para um cache do BuildKit, e nao para a imagem.
#
# `sharing=locked`: um build por vez em cada cache, e o seguinte ESPERA em vez
# de abrir outro, vazio. Em 18/11 o build do web achou o store ainda preso pelo
# do worker, ganhou um store novo e baixou tudo de novo (50 min de install).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=pnpm-metadados,target=/root/.cache/pnpm,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @na-regua/worker...

# O codigo vem depois do install. O `.dockerignore` deixa o node_modules de
# fora, entao isto nao apaga o que o install montou.
COPY . .

WORKDIR /app/apps/worker

CMD ["pnpm", "start"]
