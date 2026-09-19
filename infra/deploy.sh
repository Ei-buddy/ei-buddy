#!/usr/bin/env bash
#
# Deploy de producao na VPS — NR-015, ADR-0015.
#
# Roda NA MAQUINA, a partir do repo ja posicionado no commit desejado. Quem
# chama e o workflow `deploy.yml`, por SSH; rodar a mao funciona igual:
#
#   DEPLOY_TAG=$(git rev-parse HEAD) ./infra/deploy.sh
#
# Vive aqui, e nao dentro do YAML, para o deploy ser lido, revisado e
# corrigido como codigo — passo de workflow nao tem como ser testado sem
# abrir um PR e esperar a CI.
#
# ## O que ele garante
#
# - Build marcado com o COMMIT (`DEPLOY_TAG`), nao so `latest`: a imagem
#   anterior continua na maquina, e por isso reverter e subir de novo com a
#   tag antiga, sem buildar (RNF-064, teto de 10 min).
# - Migration antes de trocar os containers, com o papel de `BYPASSRLS`
#   (`DATABASE_MIGRATION_URL`). Era exatamente isto que faltava no deploy a
#   mao: subir codigo novo contra schema velho da 500 em tudo que a migration
#   ainda nao criou.
# - So termina com sucesso se `/health` responder 200 — e ele so responde 200
#   com banco E Redis de pe. Health check que sempre passa nao serve para nada.
#
# ## O que ele NAO faz
#
# Reverter migration. As migrations aqui sao forward-only, entao voltar o
# codigo NAO volta o schema — e o motivo de o rollback rodar com `MIGRAR=nao`.
# Migration que precise ser desfeita e migration nova, escrita para isso.
set -euo pipefail

COMPOSE="docker compose -f infra/docker-compose.prod.yml"

: "${DEPLOY_TAG:?DEPLOY_TAG e obrigatorio (o commit que esta subindo)}"
export DEPLOY_TAG

# `nao` no rollback: ver "O que ele NAO faz" acima.
MIGRAR="${MIGRAR:-sim}"

# Teto de espera do /health. RNF-064 fala em reverter rapido; 2 min e o que a
# ci-cd.md ja documentava como limite antes de considerar o deploy perdido.
ESPERA_DE_SAUDE_S="${ESPERA_DE_SAUDE_S:-120}"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

passo "Commit em deploy: ${DEPLOY_TAG}"
git --no-pager log -1 --format='%h %s' || true

passo 'Build das imagens (cache da maquina; sem registry)'
$COMPOSE build

if [ "$MIGRAR" = 'sim' ]; then
  # `run --rm` sobe postgres/redis antes por causa do `depends_on: healthy` do
  # servico api, entao isto funciona tanto no deploy do dia a dia quanto na
  # primeira subida da maquina, com o banco ainda vazio.
  #
  # `--workdir /app`: a imagem da api fica em /app/apps/api, e `db:migrate` e
  # script da RAIZ do workspace.
  passo 'Migrations (DATABASE_MIGRATION_URL, papel com BYPASSRLS)'
  $COMPOSE run --rm --workdir /app api pnpm db:migrate
else
  passo 'Migrations puladas (MIGRAR=nao) — rollback nao desfaz schema'
fi

passo 'Subindo os containers'
$COMPOSE up -d

passo "Esperando /health responder 200 (ate ${ESPERA_DE_SAUDE_S}s)"
# Pela rede interna do compose: api nao publica porta no host, so o caddy fala
# com a internet. Checar por dentro tambem tira DNS e TLS do caminho — aqui a
# pergunta e "a aplicacao subiu?", nao "o dominio resolve?".
limite=$((SECONDS + ESPERA_DE_SAUDE_S))
until $COMPOSE exec -T api wget -qO- http://127.0.0.1:3333/health >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$limite" ]; then
    printf '\n\033[31m/health nao passou em %ss. Ultima resposta:\033[0m\n' "$ESPERA_DE_SAUDE_S"
    $COMPOSE exec -T api wget -qO- http://127.0.0.1:3333/health || true
    printf '\nLog recente da api:\n'
    $COMPOSE logs --tail 50 api || true
    exit 1
  fi
  sleep 3
done

passo 'Saudavel. Limpando imagens orfas'
# So as sem tag: as `eibuddy-*:<commit>` ficam, e sao elas que tornam a
# reversao possivel sem rebuild.
docker image prune -f >/dev/null || true

passo "Deploy concluido — ${DEPLOY_TAG}"
