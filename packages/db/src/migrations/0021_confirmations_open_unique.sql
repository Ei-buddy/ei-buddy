-- ---------------------------------------------------------------------------
-- Uma confirmacao aberta por conversa — NR-061
-- ---------------------------------------------------------------------------
--
-- ## Por que 0021 e nao 0018
--
-- A NR-061 nasceu com `0018_confirmations_identity`, que tambem criava o
-- unico de identidade em `conversations`. A NR-062 chegou antes na `main`
-- com a 0019 e o mesmo unico (`IF NOT EXISTS`). Renumerar evita colidir
-- checksum/ordem com ambientes que ja aplicaram a 0019, e deixa a 0021
-- so com o que ainda falta: no maximo UMA pendencia aberta por conversa
-- (FR-010).
--
-- ## O que esta migration deliberadamente NAO faz
--
-- Sem colunas novas. Sem `created_at` em `confirmations`. Sem INSERT em
-- `messages`. Sem o unico de `conversations` (ja na 0019). Sem tocar em RLS.

-- Uma aberta por conversa. `company_id` na frente e a convencao de indice de
-- tabela de negocio (dados.md; schema.test.ts) — `conversation_id` ja e uuid
-- global, entao o par e equivalente ao unico so nele. O WHERE e o FR-010.
-- IF NOT EXISTS: quem ja rodou a 0018 antiga desta branch nao quebra.
CREATE UNIQUE INDEX IF NOT EXISTS confirmations_uma_aberta_por_conversa
  ON confirmations (company_id, conversation_id)
  WHERE resolved_at IS NULL;
