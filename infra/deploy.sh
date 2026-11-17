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

# Espaco livre minimo para comecar o build. Cada commit gera tres imagens de
# ~2,6 GB; abaixo disto o build enche o disco no meio do unpack, depois de uma
# hora, e leva o Postgres junto — foi o que aconteceu no deploy #126.
LIVRE_MINIMO_GB="${LIVRE_MINIMO_GB:-10}"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

passo "Commit em deploy: ${DEPLOY_TAG}"
git --no-pager log -1 --format='%h %s' || true

passo "Espaco em disco (minimo ${LIVRE_MINIMO_GB} GB)"
raiz_docker=$(docker info --format '{{.DockerRootDir}}')
livre() { df -Pk "$raiz_docker" | awk 'NR == 2 { print int($4 / 1048576) }'; }
livre_gb=$(livre)
echo "livre em ${raiz_docker}: ${livre_gb} GB"
# A reversao sobe imagens que ja estao na maquina e nao builda nada: barrar
# por espaco justo ela, com o disco cheio do deploy que falhou, seria o pior
# momento.
#
# As TRES imagens, e nao so a do web: um build que caiu no meio pode ter
# deixado uma e nao as outras.
precisa_build() {
  local app
  for app in api worker web; do
    docker image inspect "eibuddy-${app}:${DEPLOY_TAG}" >/dev/null 2>&1 || return 0
  done
  return 1
}

# Pouco espaco: antes de desistir, apaga o que e RECONSTRUIVEL — NR-227.
#
# O deploy de 16/11 parou com 7 GB livres, e o que ocupava o disco era, em boa
# parte, imagem de deploy antigo e cache de build. As duas coisas se refazem:
# - `image prune -a` so apaga imagem que NENHUM container usa. A versao que
#   esta no ar fica — e ela o alvo da reversao, se este deploy falhar;
# - `builder prune -a` apaga o cache de build. O build seguinte fica mais
#   lento (baixa e compila de novo), e e so isso.
# Volume (banco, WAL, redis, certificados do caddy) NAO entra: `prune` de
# imagem e de cache nao toca em volume.
if precisa_build && [ "$livre_gb" -lt "$LIVRE_MINIMO_GB" ]; then
  passo "Pouco espaco (${livre_gb} GB): apagando imagens sem uso e o cache de build"
  docker image prune -af || true
  docker builder prune -af || true
  livre_gb=$(livre)
  echo "livre agora: ${livre_gb} GB"
fi

if precisa_build && [ "$livre_gb" -lt "$LIVRE_MINIMO_GB" ]; then
  printf '\n\033[31mSo %s GB livres, mesmo depois de limpar. Nada foi buildado.\033[0m\n' "$livre_gb"
  printf 'Veja `docker system df -v` e `du -sh /var/backups/na-regua` na maquina.\n'
  # Codigo PROPRIO: nada foi trocado, e o workflow nao precisa reverter (a
  # reversao rebuildaria a versao no ar por uma hora sem necessidade).
  exit 3
fi

# Redis doente: parar ANTES de buildar — NR-229.
#
# Migration e `up -d` recriam o container do Redis quando o compose muda, e ele
# so volta se conseguir reler o proprio log (AOF). Se ja nao esta saudavel
# agora, o deploy nao vai consertar: so gastaria uma hora de build para cair no
# mesmo lugar. Codigo 3: nada foi tocado.
REDIS="${CONTAINER_REDIS:-naregua-redis}"
if docker inspect "$REDIS" >/dev/null 2>&1; then
  saude_redis=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$REDIS")
  if [ "$saude_redis" != healthy ]; then
    printf '\n\033[31mO Redis (%s) nao esta saudavel: %s. Nada foi buildado.\033[0m\n' "$REDIS" "$saude_redis"
    printf 'Rode o workflow "Recuperar Redis — VPS" (infra/recuperar-redis.sh).\n'
    exit 3
  fi
fi

if precisa_build; then
  passo 'Build das imagens (cache da maquina; sem registry)'
  $COMPOSE build
else
  # A reversao cai aqui: as imagens do commit anterior ficaram na maquina. O
  # `build` "so de cache" que rodava antes deixava de ser so cache quando a
  # limpeza de espaco apagava o cache — e a reversao de 17/11 rebuildou tudo
  # por uma hora.
  passo "Imagens de ${DEPLOY_TAG} ja estao na maquina: sem build"
fi

# Log do Redis reescrito a partir da MEMORIA, antes de recria-lo — NR-229.
#
# O Redis no ar tem os dados certos na memoria, mas o log em disco pode ter
# lixo (uma escrita pela metade num disco cheio) que ninguem ve ate ele reiniciar
# — foi o que derrubou o deploy e a reversao de 17/11. `BGREWRITEAOF` troca o
# log inteiro por um novo, gerado da memoria: o que o container recriado vai
# ler passa a ser, por construcao, o que estava no ar.
if docker inspect "$REDIS" >/dev/null 2>&1; then
  passo 'Redis: reescrevendo o log (AOF) a partir da memoria'
  # O contador `aof_rewrites` e o que prova que uma reescrita NOVA terminou:
  # `aof_last_bgrewrite_status:ok` sozinho pode ser de uma reescrita antiga.
  reescritas() { docker exec "$REDIS" redis-cli INFO persistence | tr -d '\r' | sed -n 's/^aof_rewrites://p'; }
  antes_redis=$(reescritas)
  # Erro aqui ("ja em andamento") nao e fatal: quem decide e o contador.
  docker exec "$REDIS" redis-cli BGREWRITEAOF || true
  limite_redis=$((SECONDS + ESPERA_DE_SAUDE_S))
  while :; do
    estado_redis=$(docker exec "$REDIS" redis-cli INFO persistence | tr -d '\r')
    if [ "$(sed -n 's/^aof_rewrites://p' <<<"$estado_redis")" -gt "$antes_redis" ] &&
      grep -qx 'aof_rewrite_in_progress:0' <<<"$estado_redis" &&
      grep -qx 'aof_rewrite_scheduled:0' <<<"$estado_redis"; then
      break
    fi
    if [ "$SECONDS" -ge "$limite_redis" ]; then
      printf '\n\033[31mA reescrita do AOF nao terminou em %ss. Nada foi trocado.\033[0m\n' "$ESPERA_DE_SAUDE_S"
      exit 3
    fi
    sleep 1
  done
  if ! grep -qx 'aof_last_bgrewrite_status:ok' <<<"$estado_redis"; then
    printf '\n\033[31mA reescrita do AOF falhou. Nada foi trocado.\033[0m\n'
    grep '^aof_' <<<"$estado_redis" || true
    exit 3
  fi
  echo 'log do Redis reescrito'
fi

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

passo 'Saudavel. Limpando imagens antigas'
# Ficam a do commit que acabou de subir e a mais recente antes dela — que e o
# alvo da reversao, e o motivo de a tag ser o commit. O resto so ocupava disco:
# sem isto, cada deploy deixava ~8 GB para tras ate o disco encher.
# `docker images` lista da mais nova para a mais antiga.
mapfile -t antigas < <(
  docker images --filter 'reference=eibuddy-*' --format '{{.Tag}}' \
    | grep -vxF -e "$DEPLOY_TAG" -e '<none>' | awk '!visto[$0]++' | tail -n +2
)
for tag in "${antigas[@]}"; do
  echo "removendo imagens ${tag}"
  docker images --filter "reference=eibuddy-*:${tag}" --format '{{.Repository}}:{{.Tag}}' \
    | xargs -r docker rmi >/dev/null || true
done
docker image prune -f >/dev/null || true
docker builder prune -f --keep-storage 5GB >/dev/null || true
df -h "$raiz_docker" | tail -1

passo "Deploy concluido — ${DEPLOY_TAG}"
