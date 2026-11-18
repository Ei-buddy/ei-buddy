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

# Espaco livre minimo para comecar o build. Cada commit gera tres imagens
# (~1,5, ~0,6 e ~2,2 GB desde a NR-235); abaixo disto o build pode encher o
# disco no meio do unpack e levar o Postgres junto — foi o que aconteceu no
# deploy #126.
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
# parte, imagem de deploy antigo e cache de build. As duas coisas se refazem.
# Volume (banco, WAL, redis, certificados do caddy) NAO entra: nada aqui toca
# em volume.
#
# O que fica de fora da limpeza, e por que — NR-236. A de 18/11 apagou tudo
# com `prune -a`, e o deploy seguinte morreu em 34 s: a imagem base do
# Dockerfile tinha ido junto, e baixa-la de novo dependia do Docker Hub, que
# deu timeout na VPS. E o cache de build levou o store do pnpm, que custa uma
# hora para refazer.
# - Imagens: so as `eibuddy-*` que nenhum container usa (a versao no ar fica,
#   como alvo da reversao), mais as sem nome. A base (`node:22-alpine`) e as
#   de postgres/redis/caddy ficam.
# - Cache de build: primeiro tudo MENOS os caches do pnpm (`exec.cachemount`).
#   So se ainda faltar espaco eles vao tambem — build lento e melhor que
#   build nenhum.
limpar_imagens_antigas() {
  local em_uso
  em_uso=$(docker ps -a --format '{{.Image}}' | sort -u)
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^eibuddy-' \
    | grep -vxF -e '<none>' -f <(printf '%s\n' "$em_uso") \
    | xargs -r docker rmi >/dev/null 2>&1 || true
  docker image prune -f >/dev/null || true
}

if precisa_build && [ "$livre_gb" -lt "$LIVRE_MINIMO_GB" ]; then
  passo "Pouco espaco (${livre_gb} GB): apagando imagens antigas e o cache de build (menos o do pnpm)"
  limpar_imagens_antigas
  # `type!=` e filtro do BuildKit; se o Docker da maquina nao entender, cai
  # para a limpeza inteira, que era o comportamento de antes.
  docker builder prune -af --filter 'type!=exec.cachemount' >/dev/null 2>&1 \
    || docker builder prune -af >/dev/null || true
  livre_gb=$(livre)
  echo "livre agora: ${livre_gb} GB"
  if [ "$livre_gb" -lt "$LIVRE_MINIMO_GB" ]; then
    passo "Ainda pouco (${livre_gb} GB): apagando tambem o cache do pnpm"
    docker builder prune -af >/dev/null || true
    livre_gb=$(livre)
    echo "livre agora: ${livre_gb} GB"
  fi
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

# Imagem base na maquina ANTES do build — NR-236.
#
# Com a base local, o BuildKit nem consulta o Docker Hub. Sem ela, o build
# baixa no primeiro passo, e a rede da VPS ja deu "TLS handshake timeout" ali.
# Aqui a mesma descida ganha tentativas com espera crescente; se nenhuma
# passar, codigo 3 — nada foi trocado.
TENTATIVAS_DE_PULL="${TENTATIVAS_DE_PULL:-5}"
ESPERA_ENTRE_PULLS_S="${ESPERA_ENTRE_PULLS_S:-15}"
garantir_imagens_base() {
  local imagem tentativa
  for imagem in $(sed -n 's/^FROM[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' apps/*/Dockerfile | sort -u); do
    docker image inspect "$imagem" >/dev/null 2>&1 && continue
    for tentativa in $(seq 1 "$TENTATIVAS_DE_PULL"); do
      echo "baixando ${imagem} (tentativa ${tentativa} de ${TENTATIVAS_DE_PULL})"
      docker pull -q "$imagem" && continue 2
      [ "$tentativa" -lt "$TENTATIVAS_DE_PULL" ] && sleep $((tentativa * ESPERA_ENTRE_PULLS_S))
    done
    printf '\n\033[31mNao foi possivel baixar %s em %s tentativas. Nada foi trocado.\033[0m\n' "$imagem" "$TENTATIVAS_DE_PULL"
    exit 3
  done
}

if precisa_build; then
  passo 'Imagem base dos Dockerfiles'
  garantir_imagens_base
  # Uma imagem por vez, e nao as tres juntas — NR-236. Mesmo com o lockfile
  # congelado e o store cheio, o pnpm baixa ~380 MB de metadados do npm por
  # app para conferir o lockfile; com o cache de metadados quente (NR-235),
  # leva 2 s e nao baixa nada. Em paralelo, as tres baixavam tudo ao mesmo
  # tempo pela rede lenta da VPS, com 4 GB de memoria: em 18/11 a maquina
  # parou de responder ate ao SSH no meio do build. Em sequencia, a primeira
  # enche o cache e as outras duas o reaproveitam.
  for servico in api worker web; do
    passo "Build da imagem ${servico} (cache da maquina; sem registry)"
    # Build que falha nao trocou nada: as imagens novas nem existem, e os
    # containers no ar seguem os de antes. Codigo 3, e nao reversao.
    if ! $COMPOSE build "$servico"; then
      printf '\n\033[31mO build de %s falhou. Nada foi trocado; a versao no ar segue a mesma.\033[0m\n' "$servico"
      exit 3
    fi
  done
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
# Cache de build com teto de 8 GB, e nunca o do pnpm (`exec.cachemount`) —
# NR-238. A camada do install de cada app fica no cache e e o que faz um
# deploy so de codigo nao instalar nada; a do web nem esta numa imagem (a
# imagem dele e so o standalone), entao um teto baixo a apagava a cada deploy.
# O teto antigo, de 5 GB, tambem levava o store e os metadados do pnpm, que
# sao os primeiros da fila quando o install sai do cache. Na conta de 18/11:
# store 1,5 GB, metadados 0,4 GB, installs 2,9 GB, o resto e de cada versao.
# `--reserved-space` e o nome novo de `--keep-storage`; o Docker que nao
# conhece um usa o outro.
docker builder prune -f --reserved-space 8GB --filter 'type!=exec.cachemount' >/dev/null 2>&1 \
  || docker builder prune -f --keep-storage 8GB --filter 'type!=exec.cachemount' >/dev/null 2>&1 \
  || true
df -h "$raiz_docker" | tail -1

passo "Deploy concluido — ${DEPLOY_TAG}"
