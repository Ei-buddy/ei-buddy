#!/usr/bin/env bash
#
# Ensaio de restauracao — NR-015, RNF-014.
#
# Restaura o backup mais recente num Postgres DESCARTAVEL e confere que ele
# sobe e responde. Nao toca em nada de producao: container proprio, volume
# proprio, e os dois morrem no fim.
#
#   ./infra/restore-drill.sh
#
# Roda todo mes pelo workflow `restore-drill.yml` — e o historico de execucoes
# dele e o registro que a RNF-014 pede ("mensal, registrado").
#
# ## Por que isto existe
#
# Backup que nunca foi restaurado e uma pasta grande, nao um backup. Os modos
# de falha que so aparecem aqui: base truncada pelo disco cheio, WAL aparado
# demais, permissao errada no diretorio, versao de Postgres que mudou debaixo
# do arquivo.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/na-regua}"
IMAGEM="${IMAGEM_POSTGRES:-postgres:17-alpine}"
# O volume do WAL arquivado, para o ensaio exercitar a recuperacao a ponto no
# tempo, e nao so o base backup. O nome sai do `name:` do compose de producao.
VOLUME_WAL="${VOLUME_WAL:-na-regua-prod_wal-archive}"

CONTAINER="naregua-restore-drill"
VOLUME_ENSAIO="naregua-restore-drill-$(date -u +%Y%m%d%H%M%S)"

# O backup e FISICO: papeis e bancos vem de dentro dele, nao da imagem. Entao
# quem confere precisa ser o superusuario de PRODUCAO — `postgres` pode nem
# existir neste cluster.
le_do_env() { grep -E "^$1=" .env.production 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'[:space:]'; }
USUARIO="${POSTGRES_USER:-$(le_do_env POSTGRES_USER)}"
BANCO="${POSTGRES_DB:-$(le_do_env POSTGRES_DB)}"
USUARIO="${USUARIO:-postgres}"
BANCO="${BANCO:-postgres}"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

limpar() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_ENSAIO" >/dev/null 2>&1 || true
}
# Sai como sair — erro, sucesso ou Ctrl-C —, a maquina nao fica com sobra.
trap limpar EXIT

backup=$(ls -1d "${BACKUP_DIR}"/base-* 2>/dev/null | sort | tail -1 || true)
if [ -z "$backup" ]; then
  echo "Nenhum backup em ${BACKUP_DIR}. O ensaio falha de proposito: nao ha o que restaurar."
  exit 1
fi

passo "Ensaiando ${backup}"

docker volume create "$VOLUME_ENSAIO" >/dev/null

passo 'Desempacotando a base no volume descartavel'
# Dentro de um container, e nao no host: extrair como root no host deixaria os
# arquivos com dono errado e o Postgres recusaria subir por permissao — falha
# do ENSAIO, nao do backup.
docker run --rm \
  -v "$VOLUME_ENSAIO":/destino \
  -v "$backup":/origem:ro \
  "$IMAGEM" sh -c '
    set -e
    tar -xzf /origem/base.tar.gz -C /destino
    if [ -f /origem/pg_wal.tar.gz ]; then
      tar -xzf /origem/pg_wal.tar.gz -C /destino/pg_wal
    fi
    chown -R postgres:postgres /destino
    chmod 700 /destino
  '

passo 'Configurando a recuperacao'
# `recovery.signal` poe o Postgres em modo de recuperacao; o `restore_command`
# le o WAL arquivado. Sem alvo declarado, ele avanca ate o fim do que existir —
# que e exatamente a pergunta do RPO: "ate onde eu consigo voltar?".
docker run --rm \
  -v "$VOLUME_ENSAIO":/destino \
  "$IMAGEM" sh -c '
    set -e
    touch /destino/recovery.signal
    printf "restore_command = %s\n" "'"'"'cp /wal/%f %p'"'"'" >> /destino/postgresql.auto.conf
    chown postgres:postgres /destino/recovery.signal /destino/postgresql.auto.conf
  '

passo 'Subindo o Postgres do ensaio'
docker run -d --name "$CONTAINER" \
  -v "$VOLUME_ENSAIO":/var/lib/postgresql/data \
  -v "${VOLUME_WAL}":/wal:ro \
  "$IMAGEM" >/dev/null

passo 'Esperando aceitar conexao'
limite=$((SECONDS + 120))
until docker exec "$CONTAINER" pg_isready -q 2>/dev/null; do
  if [ "$SECONDS" -ge "$limite" ]; then
    echo 'O Postgres restaurado nao subiu em 120s. Log:'
    docker logs --tail 60 "$CONTAINER" || true
    exit 1
  fi
  sleep 3
done

passo 'Conferindo o conteudo'
# Subir nao basta: um diretorio vazio tambem sobe. O ensaio so passa se o
# schema e os dados estiverem la.
consulta="
  SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tabelas,
    (SELECT count(*) FROM schema_migrations) AS migrations;
"
saida=$(docker exec "$CONTAINER" psql -U "$USUARIO" -d "$BANCO" -tA -c "$consulta" 2>&1) || {
  echo "A consulta de conferencia falhou: $saida"
  exit 1
}

tabelas=$(printf '%s' "$saida" | cut -d'|' -f1 | tr -d '[:space:]')
migrations=$(printf '%s' "$saida" | cut -d'|' -f2 | tr -d '[:space:]')
echo "tabelas em public: ${tabelas} · migrations aplicadas: ${migrations}"

if [ "${tabelas:-0}" -lt 10 ] || [ "${migrations:-0}" -lt 1 ]; then
  echo 'Restaurou, mas veio vazio demais para ser o banco de producao.'
  exit 1
fi

passo "Ensaio OK — ${backup} restaura e responde"
