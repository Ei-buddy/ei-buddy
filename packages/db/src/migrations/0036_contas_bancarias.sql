-- Contas bancarias da loja — RF-073, US-035.
--
-- A baixa ja registrava ONDE o dinheiro entrou ou saiu (`settlements.bank_account`,
-- texto livre), mas as opcoes eram uma lista fixa de nomes de banco. Esta
-- tabela e o cadastro que faltava: a loja diz quais contas tem, com o saldo
-- inicial, e a baixa escolhe entre elas.
--
-- O vinculo com a baixa e pelo NOME, e nao por chave estrangeira: as baixas
-- antigas ja gravaram texto, e reescrever o historico para apontar para ids
-- que nasceram depois seria inventar de onde o dinheiro veio. Por isso o nome
-- e unico na loja, sem diferenca de caixa.

CREATE TABLE bank_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  name                  text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  bank                  text CHECK (bank IS NULL OR char_length(btrim(bank)) BETWEEN 2 AND 60),
  agency                text CHECK (agency IS NULL OR char_length(agency) <= 20),
  account_number        text CHECK (account_number IS NULL OR char_length(account_number) <= 30),
  -- Pode ser negativo: conta que ja comeca no cheque especial existe.
  opening_balance_cents bigint NOT NULL DEFAULT 0,
  -- O saldo inicial e DESTE dia: baixas anteriores nao entram na conta.
  opening_date          date NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX bank_accounts_nome_unico ON bank_accounts (company_id, lower(name));

SELECT enable_tenant_isolation('bank_accounts');

COMMENT ON TABLE bank_accounts IS
  'Contas da loja (RF-073). A baixa grava o NOME em settlements.bank_account; o saldo e o inicial mais as baixas desde opening_date.';
