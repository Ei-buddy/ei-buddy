#!/bin/bash
# Prepara a sessao do Claude Code na nuvem com o mesmo banco da CI, e com o
# banco de desenvolvimento para subir web + api (`pnpm dev`).
#
# Sem Postgres, as suites de `db` usam `describe.skipIf(!DATABASE_URL)` e
# somem em silencio — e e justamente ali que ja moraram varias falhas de CI.
# O container nao tem daemon Docker, entao o `pnpm infra:up` nao serve: sobe
# o Postgres e o Redis nativos da imagem, com o usuario, a senha e o banco do
# servico de `.github/workflows/ci.yml`.
#
# So roda na nuvem. Idempotente: pode rodar de novo a cada sessao.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --- dependencias -----------------------------------------------------------
# `install` e nao `--frozen-lockfile`: o estado do container fica em cache
# depois do hook, e o install aproveita o que ja estiver la.
pnpm install --prefer-offline

# --- Postgres (espelha o servico da CI) --------------------------------------
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PG_DATA=/var/lib/postgresql/naregua
PG_LOG=/var/lib/postgresql/naregua.log

if [ ! -s "$PG_DATA/PG_VERSION" ]; then
  mkdir -p "$PG_DATA"
  chown postgres:postgres "$PG_DATA"
  su postgres -c "$PG_BIN/initdb -D $PG_DATA -U postgres --auth-local=trust --auth-host=scram-sha-256" >/dev/null
fi

if ! su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA status" >/dev/null 2>&1; then
  su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -l $PG_LOG -w -o '-c listen_addresses=localhost -c max_connections=200' start" >/dev/null
fi

psql_su() { su postgres -c "psql -h /var/run/postgresql -v ON_ERROR_STOP=1 -qAt -c \"$1\""; }

# Mesmo usuario da CI: dono e superusuario, como o POSTGRES_USER do servico.
if [ "$(psql_su "SELECT 1 FROM pg_roles WHERE rolname = 'naregua'")" != "1" ]; then
  psql_su "CREATE ROLE naregua LOGIN SUPERUSER PASSWORD 'naregua'"
fi
if [ "$(psql_su "SELECT 1 FROM pg_database WHERE datname = 'naregua_test'")" != "1" ]; then
  psql_su "CREATE DATABASE naregua_test OWNER naregua"
fi

# --- banco de desenvolvimento (para subir web + api e ver a tela) -------------
# O `naregua_test` acima e o da CI. Este e o do `.env.example`: roda com o papel
# de APLICACAO (`naregua_app`, sujeito a RLS) — com o superusuario, o
# `checkIsolation` da api recusa subir. Os papeis saem do mesmo script que o
# compose roda na criacao do volume.
if [ "$(psql_su "SELECT 1 FROM pg_database WHERE datname = 'naregua'")" != "1" ]; then
  psql_su "CREATE DATABASE naregua OWNER naregua"
  PGPASSWORD=naregua psql -h localhost -U naregua -d naregua -v ON_ERROR_STOP=1 -q \
    -f infra/postgres/init/01-extensions.sql
fi

[ -f .env ] || cp .env.example .env
pnpm db:migrate >/dev/null

# --- Redis --------------------------------------------------------------------
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --port 6379 >/dev/null
fi

# --- variaveis da sessao (as mesmas do job de testes da CI) ------------------
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export DATABASE_URL=postgresql://naregua:naregua@localhost:5432/naregua_test'
    echo 'export DATABASE_MIGRATION_URL=postgresql://naregua:naregua@localhost:5432/naregua_test'
    echo 'export REDIS_URL=redis://localhost:6379'
  } >> "$CLAUDE_ENV_FILE"
fi
