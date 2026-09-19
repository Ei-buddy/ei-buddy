#!/usr/bin/env bash
#
# Backup do Postgres de producao — NR-015, RNF-013/RNF-014.
#
# Roda NA MAQUINA, a partir da raiz do repo. Diario, pelo cron:
#
#   10 3 * * *  cd /opt/na-regua && ./infra/backup.sh >> /var/log/na-regua-backup.log 2>&1
#
# ## Por que base backup + WAL, e nao `pg_dump`
#
# `pg_dump` diario da RPO de 24 h: perder o dia inteiro de vendas entre um dump
# e o incidente. A RNF-013 pede <= 15 min, e isso so existe com recuperacao a
# ponto no tempo — um backup FISICO (`pg_basebackup`) mais os segmentos de WAL
# arquivados desde ele. O `archive_timeout=900` do compose e a outra metade.
#
# ## Onde o backup fica
#
# Em `BACKUP_DIR` (padrao `/var/backups/na-regua`), no host. Isso sozinho NAO
# atende a RNF-013: backup no mesmo disco morre com a maquina. Defina
# `BACKUP_REMOTO` com um destino de rclone (S3, R2, B2, SFTP — tanto faz, e o
# motivo de ser rclone) e o envio passa a acontecer aqui mesmo.
set -euo pipefail

COMPOSE="docker compose -f infra/docker-compose.prod.yml"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/na-regua}"
# Quantos backups base guardar. O WAL e aparado junto: o que sobra e sempre o
# necessario para restaurar a partir do mais ANTIGO que ficou.
MANTER="${MANTER:-7}"
# Destino do rclone, ex.: `b2:eibuddy-backups`. Vazio = so local.
BACKUP_REMOTO="${BACKUP_REMOTO:-}"

carimbo=$(date -u +%Y%m%dT%H%M%SZ)
destino="base-${carimbo}"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

passo "Backup ${carimbo}"

# O WAL corrente ANTES do backup. E ele que diz, depois, ate onde da para
# apagar o arquivo sem tornar este backup irrecuperavel — `pg_archivecleanup`
# apaga tudo que for anterior ao nome que receber.
inicio_wal=$($COMPOSE exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_walfile_name(pg_current_wal_lsn())"')
inicio_wal=$(printf '%s' "$inicio_wal" | tr -d '[:space:]')
echo "WAL no inicio: ${inicio_wal}"

passo 'Base backup'
# `-Ft -z`: tar comprimido, que e o que cabe em disco de VPS.
# `-Xs`: traz o WAL gerado DURANTE o backup junto, entao o conjunto restaura
#        sozinho mesmo que o arquivamento esteja atrasado.
$COMPOSE exec -T postgres sh -c \
  "pg_basebackup -U \"\$POSTGRES_USER\" -D '/backups/${destino}' -Ft -z -Xs -cfast"

$COMPOSE exec -T postgres sh -c \
  "printf '%s\n' '${inicio_wal}' > '/backups/${destino}/INICIO_WAL'"

passo 'Aparando backups antigos'
# `ls -1d` ordena por nome, e o nome e a data em UTC — entao ordem alfabetica e
# ordem cronologica, de proposito.
mapfile -t todos < <(ls -1d "${BACKUP_DIR}"/base-* 2>/dev/null | sort)
total=${#todos[@]}
if [ "$total" -gt "$MANTER" ]; then
  for antigo in "${todos[@]:0:$((total - MANTER))}"; do
    echo "removendo ${antigo}"
    rm -rf "$antigo"
  done
fi

passo 'Aparando WAL arquivado'
# O corte e o WAL inicial do backup mais ANTIGO que sobrou: o que vem antes
# dele nao serve para restaurar nada que ainda guardamos.
mapfile -t restantes < <(ls -1d "${BACKUP_DIR}"/base-* 2>/dev/null | sort)
if [ "${#restantes[@]}" -gt 0 ] && [ -f "${restantes[0]}/INICIO_WAL" ]; then
  corte=$(tr -d '[:space:]' < "${restantes[0]}/INICIO_WAL")
  echo "mantendo a partir de ${corte}"
  $COMPOSE exec -T postgres pg_archivecleanup /wal "$corte"
else
  echo 'nenhum backup com INICIO_WAL — nada aparado (primeira execucao?)'
fi

if [ -n "$BACKUP_REMOTO" ]; then
  passo "Enviando para ${BACKUP_REMOTO}"
  # `copy`, e nao `sync`: `sync` APAGA no destino o que sumiu na origem, e uma
  # falha na etapa de aparar aqui viraria exclusao la. Quem apaga no remoto e a
  # politica de retencao do bucket.
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTO" --transfers 4
else
  printf '\n\033[33mBACKUP_REMOTO nao definido — o backup existe so nesta maquina.\033[0m\n'
  printf 'Backup no mesmo disco nao atende a RNF-013: o incidente que leva a VM leva os dois.\n'
fi

passo "Concluido — ${BACKUP_DIR}/${destino}"
du -sh "${BACKUP_DIR}/${destino}" 2>/dev/null || true
