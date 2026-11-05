-- Cadastro de fornecedor — achado do QA: "cadastro de fornecedor, poder
-- cadastrar por completo".
--
-- Ate aqui o fornecedor era texto solto: digitado na entrada de mercadoria,
-- no produto e na conta a pagar, cada vez de um jeito. Sem cadastro nao havia
-- CNPJ, contato nem endereco, e "Distribuidora Boa Vista" e "Dist. Boa Vista"
-- eram dois fornecedores. A tabela nova guarda o fornecedor uma vez; a compra
-- passa a apontar para ele (`purchases.supplier_id`), e o texto antigo fica
-- como esta — e o nome que saiu na nota.
--
-- So o nome e obrigatorio: o lojista cadastra o fornecedor na hora da compra,
-- muitas vezes so com o nome da nota. CNPJ, inscricao estadual, contato e
-- endereco completam quando ele tiver.
CREATE TABLE suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,

  -- Razao social (ou o nome, para pessoa fisica).
  name               text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  trade_name         text CHECK (trade_name IS NULL OR char_length(trade_name) <= 160),
  -- So digitos: 11 (CPF) ou 14 (CNPJ). Quem valida o digito e o contrato.
  document           text CHECK (document IS NULL OR document ~ '^([0-9]{11}|[0-9]{14})$'),
  state_registration text CHECK (state_registration IS NULL OR char_length(state_registration) <= 30),
  email              text CHECK (email IS NULL OR char_length(email) <= 160),
  phone              text CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$'),
  contact_name       text CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),

  zip_code           text CHECK (zip_code IS NULL OR zip_code ~ '^[0-9]{8}$'),
  street             text CHECK (street IS NULL OR char_length(street) <= 160),
  number             text CHECK (number IS NULL OR char_length(number) <= 20),
  complement         text CHECK (complement IS NULL OR char_length(complement) <= 80),
  district           text CHECK (district IS NULL OR char_length(district) <= 80),
  city               text CHECK (city IS NULL OR char_length(city) <= 80),
  state              text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),

  notes              text CHECK (notes IS NULL OR char_length(notes) <= 500),
  is_active          boolean NOT NULL DEFAULT true,

  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Excluir e esconder: a compra antiga continua apontando para ele.
  deleted_at         timestamptz
);

-- O mesmo CNPJ/CPF uma vez por loja — entre os que nao foram excluidos.
CREATE UNIQUE INDEX suppliers_documento_unico
  ON suppliers (company_id, document)
  WHERE document IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX suppliers_por_nome ON suppliers (company_id, lower(name));

SELECT enable_tenant_isolation('suppliers');

COMMENT ON TABLE suppliers IS
  'Cadastro de fornecedor (NR-191): razao social, CNPJ, IE, contato e endereco.';

-- A compra aponta para o fornecedor cadastrado. Nula nas compras antigas e na
-- que ainda for lancada so com o nome: o texto em `purchases.supplier` segue.
ALTER TABLE purchases
  ADD COLUMN supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT;

CREATE INDEX purchases_por_fornecedor ON purchases (company_id, supplier_id)
  WHERE supplier_id IS NOT NULL;
