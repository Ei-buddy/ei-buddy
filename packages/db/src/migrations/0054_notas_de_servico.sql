-- NFS-e da venda — DEC-031, NR-241.
--
-- Tabela propria, e nao linhas a mais em `invoices`: a NFS-e nacional e outro
-- documento. A chave tem 50 digitos (a da NFC-e, 44), o numero vem como texto
-- do Ambiente Nacional, e ela tem um estado que a NFC-e nao tem —
-- `processing`, o intervalo entre o pedido aceito e a autorizacao, porque a
-- emissao e ASSINCRONA.
--
-- Uma por venda: a venda manda os servicos numa nota so (a DPS leva um servico
-- por nota, com a descricao de todos). Rejeitada, a mesma linha volta a
-- `processing` quando o lojista corrige e pede de novo.

CREATE TABLE service_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  sale_id               uuid NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,

  status                text NOT NULL
                          CHECK (status IN ('processing', 'authorized', 'rejected', 'cancelled')),

  -- O que foi pedido: a soma dos servicos da venda e a parte deles no desconto.
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  discount_cents        bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  description           text NOT NULL,

  -- O que o Ambiente Nacional devolveu.
  number                text,
  access_key            text CHECK (access_key IS NULL OR access_key ~ '^[0-9]{50}$'),
  verification_code     text,
  danfse_url            text,
  public_url            text,
  xml_path              text,

  -- Rejeicao guardada para a tela explicar sem consultar o provedor.
  rejection_code        text,
  rejection_message     text,

  cancellation_reason   text,

  requested_at          timestamptz NOT NULL,
  issued_at             timestamptz,
  cancelled_at          timestamptz,
  -- Ultima consulta ao provedor: a tela so consulta de novo depois de um
  -- intervalo, e o worker conta quantas vezes ja perguntou.
  last_checked_at       timestamptz,
  checks                integer NOT NULL DEFAULT 0 CHECK (checks >= 0),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT service_invoices_uma_por_venda UNIQUE (company_id, sale_id),
  CONSTRAINT service_invoices_desconto_menor_que_o_valor CHECK (discount_cents < amount_cents),
  -- Autorizada tem numero e PDF; rejeitada tem o motivo. Sem isto a tela de
  -- estado fiscal poderia mentir sobre a venda.
  CONSTRAINT service_invoices_autorizada_completa
    CHECK (status <> 'authorized' OR (number IS NOT NULL AND danfse_url IS NOT NULL)),
  CONSTRAINT service_invoices_rejeitada_explica
    CHECK (status <> 'rejected' OR rejection_message IS NOT NULL)
);

-- O worker procura as que ainda estao processando.
CREATE INDEX service_invoices_processando
  ON service_invoices (company_id, requested_at)
  WHERE status = 'processing';

SELECT enable_tenant_isolation('service_invoices');

COMMENT ON TABLE service_invoices IS
  'NFS-e nacional da venda (DEC-031, NR-241). Uma por venda; assincrona: processing ate o Ambiente Nacional responder.';
