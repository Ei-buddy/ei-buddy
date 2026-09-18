-- ---------------------------------------------------------------------------
-- Identidade da conversa vigente e janela de mensagens — NR-062
-- ---------------------------------------------------------------------------
--
-- ## Por que estes indices
--
-- As tabelas `conversations` e `messages` ja existem (0007). O que falta e
-- (1) o unico parcial da identidade logica — `(company_id, channel,
-- number_from)` entre vigentes — e (2) o indice da janela que o `loadActive`
-- consulta: as mensagens vigentes de UM fio, da mais recente para tras, no
-- teto de 12 (RNF-075).
--
-- A NR-061 deixaria o unico na 0018; esta branch ainda nao tem essa
-- migration, e o upsert do historico precisa do mesmo cinto contra corrida.
-- Sem ele, dois `append` concorrentes viram duas identidades para o mesmo
-- (empresa, canal, interlocutor). Sem o indice da janela, cada turno do
-- assistente vira seq-scan em `messages`.
--
-- ## O que esta migration deliberadamente NAO faz
--
-- Sem colunas novas. Sem rename de `number_from` (a coluna continua
-- `number_from`, nunca `peer`). Sem o unico de confirmacao aberta
-- (`confirmations_uma_aberta_por_conversa`) — isso e NR-061. Sem INSERT em
-- `messages`. Sem relaxar RLS: `enable_tenant_isolation` ja rodou nas duas
-- tabelas na 0007. Sem DROP do indice antigo
-- `messages_company_conversation_idx`.
--
-- ## Unico parcial, nao CHECK
--
-- `deleted_at IS NULL` e a vigente; uma conversa fechada no expurgo de 30 d
-- pode nascer de novo com a mesma identidade. `number_from` nulo nao entra
-- neste unico (NULL != NULL no Postgres); o store recusa interlocutor vazio
-- em vez de criar conversa ambigua.

-- IF NOT EXISTS: a 0018 da NR-061 cria o mesmo unico; nesta branch a 0018
-- nao existe, mas um Postgres local que ja aplicou aquela fatia nao pode
-- recusar a 0019.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_identidade_unica
  ON conversations (company_id, channel, number_from)
  WHERE deleted_at IS NULL;

-- A pergunta do recorte: as vigentes desta conversa, da mais nova para a
-- mais antiga, para o LIMIT 12. `company_id` na frente e a convencao de
-- indice de tabela de negocio (schema.test.ts).
CREATE INDEX IF NOT EXISTS messages_por_conversa
  ON messages (company_id, conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;
