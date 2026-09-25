-- Historico de contatos do cliente — RF-011, NR-072.
--
-- A ficha do cliente ja mostrava um "Historico de contatos" desde que a tela
-- existe. Ele vinha de `mock-data`, e o botao "Novo contato" abria um aviso
-- dizendo que o lancamento entraria com o modulo de CRM. Nao entrou: o CRM que
-- existe (`crm_cards`, NR-109) e um quadro de oportunidades da loja, e nao o
-- diario de quem falou com quem.
--
-- ## Tabela propria, e nao uma coluna de texto em `customers`
--
-- Cada contato tem data, tipo e autor. Enfiar tudo num campo `notes` faria a
-- tela reconstruir isso por parsing, e "quando foi a ultima ligacao" viraria
-- uma pergunta sem resposta.
--
-- ## `happened_on` e `created_at` sao coisas diferentes
--
-- O lojista lanca hoje a ligacao de ontem — e a ordem que importa na ficha e a
-- do FATO, nao a do registro. `created_at` fica para auditoria ("quando isso
-- foi digitado"), e e por `happened_on` que a lista ordena.
--
-- `date` e nao `timestamptz`: ninguem anota a hora de uma visita, e um campo de
-- hora vazio viraria meia-noite em toda linha.
--
-- ## Chaves em ingles, texto em portugues na tela
--
-- `kind` guarda `call`/`whatsapp`/`visit`/`note`, como o resto do schema. O
-- texto que o lojista le mora na tela; gravar a prosa faria a primeira
-- mudanca de redacao virar migration.

CREATE TABLE customer_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,

  -- `ON DELETE CASCADE` e nao `RESTRICT`: cliente nao e apagado por DELETE
  -- neste sistema (sai da lista por `deleted_at`), entao o cascade so tem
  -- efeito no dia em que alguem limpar o banco de verdade — e ai um contato
  -- orfao, apontando para um cliente que nao existe, nao serve para nada.
  customer_id  uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

  -- `text` + CHECK, como o resto do schema: enum nativo nao volta atras, e esta
  -- lista e das mais provaveis de crescer (e-mail, mensagem no balcao).
  kind         text NOT NULL CHECK (kind IN ('call', 'whatsapp', 'visit', 'note')),

  -- O minimo existe para impedir a linha vazia: um contato sem descricao nao
  -- diz nada na ficha, e e mais facil recusar aqui do que explicar depois por
  -- que ha tres linhas em branco no historico.
  description  text NOT NULL CHECK (length(btrim(description)) >= 3),

  -- O dia do FATO. Ver o cabecalho.
  happened_on  date NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL
);

-- `company_id` na frente porque toda leitura passa pela RLS, que filtra por
-- ele — um indice que comeca por `customer_id` obrigaria o Postgres a escolher
-- entre o indice e o filtro do tenant.
--
-- `happened_on DESC` junto: a ficha mostra do mais recente para o mais antigo,
-- e sem isso cada abertura ordenaria a mao o que o indice ja poderia entregar.
CREATE INDEX customer_contacts_por_cliente
  ON customer_contacts (company_id, customer_id, happened_on DESC);

SELECT enable_tenant_isolation('customer_contacts');

COMMENT ON TABLE customer_contacts IS
  'Diario de contatos com o cliente (ligacao, WhatsApp, visita, observacao) — RF-011.';
COMMENT ON COLUMN customer_contacts.happened_on IS
  'O dia em que o contato aconteceu. Ordena a ficha. Nao confundir com created_at.';
