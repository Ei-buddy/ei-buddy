-- ---------------------------------------------------------------------------
-- Identidade da conversa e uma confirmacao aberta — NR-061
-- ---------------------------------------------------------------------------
--
-- ## O que esta migration resolve
--
-- As tabelas `conversations` e `confirmations` ja existem (0007). O que falta
-- e o cinto contra corrida: upsert da identidade da conversa sem duplicar a
-- row vigente, e no maximo UMA pendencia aberta por conversa (FR-010). Sem
-- estes unicos, dois `put` concorrentes viram duas identidades ou duas
-- abertas.
--
-- ## O que esta migration deliberadamente NAO faz
--
-- Sem colunas novas. Sem `created_at` em `confirmations` (o catalogo 0007 nao
-- tem). Sem INSERT em `messages` — historico/anafora e NR-062. Sem relaxar
-- `conversation_id` NOT NULL. Sem tocar em RLS: `enable_tenant_isolation`
-- ja rodou nas duas tabelas na 0007.
--
-- ## Unicos parciais, nao CHECK
--
-- `deleted_at IS NULL` e a vigente; uma conversa apagada pode nascer de novo
-- com a mesma identidade. `resolved_at IS NULL` e a aberta; a linha resolvida
-- permanece (FR-011), entao o unico NAO pode ser em `conversation_id` sozinho
-- sem o WHERE — senao o segundo pedido na mesma conversa colidiria com o
-- historico.

-- Identidade logica = (empresa, canal, interlocutor) entre vigentes.
-- `number_from` nulo nao entra neste unico (NULL != NULL no Postgres); o
-- store recusa interlocutor vazio em vez de criar conversa ambigua.
CREATE UNIQUE INDEX conversations_identidade_unica
  ON conversations (company_id, channel, number_from)
  WHERE deleted_at IS NULL;

-- Uma aberta por conversa. `company_id` na frente e a convencao de indice de
-- tabela de negocio (dados.md; schema.test.ts) — `conversation_id` ja e uuid
-- global, entao o par e equivalente ao unico so nele. O WHERE e o FR-010.
CREATE UNIQUE INDEX confirmations_uma_aberta_por_conversa
  ON confirmations (company_id, conversation_id)
  WHERE resolved_at IS NULL;
