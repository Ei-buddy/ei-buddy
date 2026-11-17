#!/usr/bin/env bash
#
# Recupera o Redis cujo AOF corrompeu — NR-229.
#
# Roda NA MAQUINA, do diretorio do repo. Quem chama e o workflow
# `recuperar-redis.yml`, por SSH; a mao funciona igual:
#
#   ./infra/recuperar-redis.sh
#
# ## O incidente que o motivou (17/11)
#
# O Redis roda com `--appendonly yes`: tudo o que ele grava vai para um log
# (`appendonlydir/*.incr.aof`) que ele RELE ao subir. No disco cheio de
# novembro, uma escrita nesse log ficou pela metade, e as seguintes foram
# gravadas depois do lixo. O Redis que estava no ar nao percebeu nada: os dados
# dele estao na MEMORIA. So quando o deploy recriou o container ele foi reler o
# log, achou o lixo ("Bad file format reading the append only file") e entrou
# em loop de reinicio — e api, worker e web, que dependem dele, nao subiram.
#
# ## Como ele recupera, sem perder dado
#
# Ao ser desligado, o Redis grava um retrato completo da memoria em
# `/data/dump.rdb` — e esse retrato e posterior a qualquer lixo no log. Entao:
#
# 1. confirma que o log esta MESMO corrompido e que o `dump.rdb` esta integro
#    (se qualquer um falhar, para sem mexer em nada);
# 2. guarda uma copia de tudo em `/data/recuperacao-<data>/` (nada e apagado);
# 3. sobe um Redis temporario, SEM rede, que le o `dump.rdb`;
# 4. liga o AOF nele (`CONFIG SET appendonly yes`), o que reescreve o log
#    inteiro a partir da memoria — log novo, limpo;
# 5. desliga o temporario, confere o log novo e religa o Redis de verdade;
# 6. sobe de novo api, worker e web, na versao que esta no `git` da maquina.
#
# O caminho "obvio" — so apagar o log e religar — sobe o Redis VAZIO: com o
# AOF ligado e sem log, ele ignora o `dump.rdb`. Testado.
set -euo pipefail

CONTAINER="${CONTAINER_REDIS:-naregua-redis}"
TEMPORARIO="${CONTAINER}-recuperacao"
COMPOSE="docker compose -f infra/docker-compose.prod.yml"
ESPERA_S="${ESPERA_S:-120}"
MANIFESTO=/data/appendonlydir/appendonly.aof.manifest

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
falha() { printf '\n\033[31m%s\033[0m\n' "$1"; }

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  falha "Nao existe container ${CONTAINER} nesta maquina."
  exit 1
}

imagem=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")
[ -n "$volume" ] || {
  falha "O ${CONTAINER} nao tem volume em /data. Nada foi mexido."
  exit 1
}

# Um container descartavel, sem rede, com o volume — para ler (`:ro`) ou para
# mexer nos arquivos. Usa a imagem que ja esta na maquina: nada e baixado.
no_volume() { docker run --rm --network none -v "${volume}:/data${2:-}" --entrypoint sh "$imagem" -c "$1"; }
ler_volume() { no_volume "$1" ':ro'; }

saude() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$CONTAINER"; }

# Confere o AOF numa COPIA, dentro do container descartavel: o
# `redis-check-aof` abre os arquivos para escrita mesmo sem `--fix`, e no
# volume montado `:ro` ele falha com "Read-only file system" — o que pareceria
# "corrompido" sem estar. Codigos: 0 integro, 1 corrompido, 9 nao deu para
# conferir.
verificar_aof() {
  set +e
  ler_volume "cp -a /data/appendonlydir /tmp/aof 2>/dev/null || exit 9
    redis-check-aof /tmp/aof/appendonly.aof.manifest"
  local codigo=$?
  set -e
  return "$codigo"
}

passo "Estado de ${CONTAINER} (volume ${volume})"
docker inspect -f 'status={{.State.Status}} reinicios={{.RestartCount}} saude=' "$CONTAINER" | tr -d '\n'
saude

if [ "$(saude)" = healthy ]; then
  echo 'O Redis esta saudavel: nao ha o que recuperar nele.'
else
  passo 'O log (AOF) esta mesmo corrompido?'
  if ! ler_volume "test -f ${MANIFESTO}"; then
    falha 'Nao ha AOF no volume: o problema e outro. Nada foi mexido.'
    docker logs --tail 30 "$CONTAINER" 2>&1 || true
    exit 2
  fi
  codigo=0
  verificar_aof || codigo=$?
  case "$codigo" in
    1) echo 'sim — e e isso que impede o Redis de subir.' ;;
    0)
      falha 'O AOF passou na verificacao: o problema e outro. Nada foi mexido.'
      docker logs --tail 30 "$CONTAINER" 2>&1 || true
      exit 2
      ;;
    *)
      falha "Nao deu para conferir o AOF (codigo ${codigo}). Nada foi mexido."
      exit 2
      ;;
  esac

  passo 'O retrato da memoria (dump.rdb) esta integro?'
  if ! ler_volume 'test -s /data/dump.rdb && redis-check-rdb /data/dump.rdb'; then
    falha 'Sem dump.rdb integro. Nada foi mexido.'
    printf 'Ultimo recurso, na maquina: redis-check-aof --fix no manifesto, que\n'
    printf 'CORTA o log no defeito e perde o que veio depois dele.\n'
    exit 2
  fi

  passo "Parando ${CONTAINER} (esta em loop de reinicio)"
  docker stop "$CONTAINER" >/dev/null

  passo 'Guardando uma copia do que existe hoje'
  # O log corrompido SAI do lugar (com ele la, o Redis tentaria le-lo de novo)
  # mas fica no mesmo volume, junto com uma copia do dump.rdb.
  pasta=$(no_volume 'set -e
    d=/data/recuperacao-$(date -u +%Y%m%dT%H%M%SZ)
    mkdir "$d"
    cp -a /data/dump.rdb "$d"/
    mv /data/appendonlydir "$d"/
    echo "$d"')
  echo "copia em ${pasta} (dentro do volume ${volume})"

  passo 'Redis temporario, sem rede, lendo o dump.rdb'
  docker rm -f "$TEMPORARIO" >/dev/null 2>&1 || true
  docker run -d --name "$TEMPORARIO" --network none -v "${volume}:/data" "$imagem" \
    redis-server --appendonly no >/dev/null
  limite=$((SECONDS + ESPERA_S))
  until [ "$(docker exec "$TEMPORARIO" redis-cli ping 2>/dev/null)" = PONG ]; do
    if [ "$SECONDS" -ge "$limite" ]; then
      falha "O temporario nao respondeu em ${ESPERA_S}s."
      docker logs --tail 30 "$TEMPORARIO" 2>&1 || true
      exit 1
    fi
    sleep 2
  done
  chaves=$(docker exec "$TEMPORARIO" redis-cli DBSIZE)
  echo "chaves carregadas: ${chaves}"

  passo 'Ligando o AOF: o log e reescrito a partir da memoria'
  docker exec "$TEMPORARIO" redis-cli CONFIG SET appendonly yes >/dev/null
  limite=$((SECONDS + ESPERA_S))
  while :; do
    estado=$(docker exec "$TEMPORARIO" redis-cli INFO persistence | tr -d '\r')
    # `aof_rewrites` e o contador de reescritas desde que este Redis subiu: so
    # passa de 0 quando a que o CONFIG SET disparou termina.
    if grep -qx 'aof_enabled:1' <<<"$estado" &&
      [ "$(sed -n 's/^aof_rewrites://p' <<<"$estado")" -ge 1 ] &&
      grep -qx 'aof_rewrite_in_progress:0' <<<"$estado" &&
      grep -qx 'aof_rewrite_scheduled:0' <<<"$estado" &&
      docker exec "$TEMPORARIO" test -f "$MANIFESTO"; then
      break
    fi
    if [ "$SECONDS" -ge "$limite" ]; then
      falha "A reescrita do AOF nao terminou em ${ESPERA_S}s."
      grep '^aof_' <<<"$estado" || true
      exit 1
    fi
    sleep 1
  done
  grep -qx 'aof_last_bgrewrite_status:ok' <<<"$estado" || {
    falha 'A reescrita do AOF falhou.'
    grep '^aof_' <<<"$estado" || true
    exit 1
  }

  passo 'Desligando o temporario (grava o dump.rdb e fecha o log)'
  docker exec "$TEMPORARIO" redis-cli SHUTDOWN >/dev/null 2>&1 || true
  saida=$(docker wait "$TEMPORARIO")
  docker rm "$TEMPORARIO" >/dev/null
  [ "$saida" = 0 ] || {
    falha "O temporario saiu com codigo ${saida}."
    exit 1
  }

  passo 'Conferindo o log novo'
  if ! verificar_aof >/dev/null; then
    falha "O log novo nao passou na conferencia. ${CONTAINER} fica parado; a copia do original esta em ${pasta}."
    exit 1
  fi
  echo 'integro'

  passo "Religando ${CONTAINER}"
  docker start "$CONTAINER" >/dev/null
  limite=$((SECONDS + ESPERA_S))
  until [ "$(saude)" = healthy ]; do
    if [ "$SECONDS" -ge "$limite" ]; then
      falha "${CONTAINER} nao ficou saudavel em ${ESPERA_S}s."
      docker logs --tail 30 "$CONTAINER" 2>&1 || true
      exit 1
    fi
    sleep 2
  done
  agora=$(docker exec "$CONTAINER" redis-cli DBSIZE)
  echo "saudavel, com ${agora} chaves (o retrato tinha ${chaves}; chave com prazo pode ter vencido no meio)"
fi

passo "Subindo de novo o que estava no ar: $(git --no-pager log -1 --format='%h %s')"
# A versao e a do `git` da maquina, que o deploy (ou a reversao) deixou no
# commit que deveria estar no ar. `--no-build`: as imagens dela ja estao aqui;
# se nao estiverem, e melhor falhar do que buildar por uma hora no meio de uma
# recuperacao.
DEPLOY_TAG=$(git rev-parse HEAD)
export DEPLOY_TAG
$COMPOSE up -d --no-build

passo "Esperando /health responder 200 (ate ${ESPERA_S}s)"
limite=$((SECONDS + ESPERA_S))
until $COMPOSE exec -T api wget -qO- http://127.0.0.1:3333/health >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$limite" ]; then
    falha "/health nao passou em ${ESPERA_S}s."
    $COMPOSE logs --tail 50 api || true
    exit 1
  fi
  sleep 3
done

passo "No ar de novo — ${DEPLOY_TAG}"
