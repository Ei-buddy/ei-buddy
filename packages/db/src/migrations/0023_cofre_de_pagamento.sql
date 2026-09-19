-- Cofre da conta de recebimento do lojista — NR-044, ADR-0004.
--
-- ---------------------------------------------------------------------------
-- Por que uma tabela, e nao uma coluna em company_integrations
-- ---------------------------------------------------------------------------
--
-- A `company_integrations` ja tem `payments_api_key_secret_ref`, e o nome diz
-- o que ela guarda: uma REFERENCIA. Ela e a ficha de configuracao — quem le
-- "esta loja ja tem conta aprovada?" consulta aquela tabela, e ninguem que
-- pergunta isso precisa do segredo em memoria.
--
-- O segredo em si fica aqui, separado, pelo mesmo desenho de
-- `company_fiscal_credentials` (migration 0005): tabela propria, cifrada, lida
-- so por quem vai de fato chamar o provedor. Misturar os dois faria toda
-- consulta de status carregar a chave junto.
--
-- ---------------------------------------------------------------------------
-- Uma subconta por loja
-- ---------------------------------------------------------------------------
--
-- No Asaas cada loja e uma subconta com chave propria, e e isso que faz o
-- dinheiro cair na conta dela e nao na nossa. Por isso `company_id` e a chave
-- primaria: uma conta de recebimento por lojista, nunca uma chave de
-- plataforma reaproveitada.

CREATE TABLE company_payment_credentials (
  company_id     uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,

  -- Chave da subconta, cifrada. Vai no cabecalho `access_token` do Asaas.
  api_key        text,

  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON TABLE company_payment_credentials IS
  'Chave da subconta de recebimento do lojista, cifrada (NR-044). Separada de company_integrations: la fica a ficha de status, aqui o segredo.';

SELECT enable_tenant_isolation('company_payment_credentials');
