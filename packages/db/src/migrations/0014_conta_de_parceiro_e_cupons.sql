-- Conta de Parceiro e esquema de cupons de indicacao — NR-114, ADR-0013, DEC-012.
--
-- ## `partners`/`coupons` ja existiam (0007_acrescimos.sql), mas sem dono
--
-- Nasceram pensados para cupom promocional emitido pela plataforma: sem PIX,
-- sem status de aprovacao, sem tabela de resgate. Esta migration da dono a
-- `partners` (quem se candidatou), aprovacao (Super Admin, ADR-0007) e um
-- segundo tipo de cupom — o de LOJISTA, indicando outro lojista, sem
-- comissao recorrente, so mes gratis cumulativo.
--
-- ## Dois tipos de cupom, nunca por escolha de quem cadastra
--
-- `coupons.partner_id` XOR `coupons.owner_company_id` (CHECK abaixo) —
-- o tipo se le pela FK preenchida, nunca por um campo "kind de referrer".
-- `coupons.kind`/`percent`/`amount_cents`/`discount_cycles` continuam
-- descrevendo so o desconto de quem RESGATA o cupom (sempre 30%, um ciclo,
-- ADR-0013) — igual nos dois tipos. O que diferencia o BENEFICIO DE QUEM
-- INDICOU e a tabela de destino do resgate: `partners.commission_percent`
-- (comissao recorrente, calculo fora desta migration) ou uma linha nova em
-- `lojista_free_month_credits` (credito, FIFO, tambem fora desta migration).
--
-- ## `partners`/`coupon_redemptions`: mesmo desenho de `company_connections`
--
-- Cross-tenant, sem dono unico de RLS por tenant — `ENABLE` + `FORCE ROW
-- LEVEL SECURITY` sem nenhuma politica permissiva, acesso so pelas funcoes
-- `partner_application_*`/`coupon_*` abaixo (`SECURITY DEFINER`, search_path
-- fixo, retorno minimo — mesmo padrao das migrations 0008/0009). As colunas
-- de empresa nao se chamam `company_id` de proposito, para nao cair na
-- guarda de schema que exige `tenant_isolation` em qualquer coluna com esse
-- nome literal (`packages/db/src/schema.test.ts`).
--
-- `coupons` tambem passa a ser `FORCE ROW LEVEL SECURITY` nesta migration —
-- antes estava na lista `NAO_TENANT` de `schema.test.ts`, sem RLS nenhuma:
-- aceitavel enquanto so guardava um nome e um percentual, mas agora convive
-- com `partners`, que guarda PIX. A leitura publica por codigo continua
-- possivel do mesmo jeito que `company_connections_search` ja prova: funcao
-- `SECURITY DEFINER` com retorno minimo (`coupon_lookup`), nunca a tabela
-- aberta direto.
--
-- ## `lojista_free_month_credits` e tenant normal, `coupon_redemptions` nao e
--
-- O resgate liga DUAS empresas (quem indicou, quem foi indicado) — nao tem
-- dono unico, e RLS por tenant nao serve. O credito de mes gratis pertence a
-- UMA empresa so (quem indicou) — e tenant-isolado normal, mesmo padrao de
-- `subscriptions`.

-- ---------------------------------------------------------------------------
-- partners — dono, PIX, aprovacao
-- ---------------------------------------------------------------------------

ALTER TABLE partners
  ADD COLUMN owner_company_id   uuid REFERENCES companies (id) ON DELETE RESTRICT,
  ADD COLUMN owner_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN pix_key            text,
  ADD COLUMN pix_key_type       text
                                  CHECK (pix_key_type IS NULL OR pix_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP')),
  ADD COLUMN message            text,
  ADD COLUMN status              text NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'active', 'rejected')),
  ADD COLUMN commission_percent numeric(7, 4) NOT NULL DEFAULT 30
                                  CHECK (commission_percent > 0 AND commission_percent <= 100),
  ADD COLUMN reviewed_by        uuid REFERENCES users (id),
  ADD COLUMN reviewed_at        timestamptz,
  ADD COLUMN review_note        text,
  ADD CONSTRAINT partners_revisao_consistente
    CHECK ((status = 'pending') = (reviewed_at IS NULL));

COMMENT ON COLUMN partners.owner_company_id IS
  'Empresa dona da candidatura a Parceiro — nao se chama company_id de proposito (ver guarda em schema.test.ts).';

CREATE UNIQUE INDEX partners_owner_company_unique ON partners (owner_company_id) WHERE deleted_at IS NULL;

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- coupons — segundo dono possivel (lojista), marca de ativacao
-- ---------------------------------------------------------------------------

ALTER TABLE coupons ALTER COLUMN partner_id DROP NOT NULL;

ALTER TABLE coupons
  ADD COLUMN owner_company_id uuid REFERENCES companies (id) ON DELETE RESTRICT,
  ADD COLUMN activated_at     timestamptz,
  ADD CONSTRAINT coupons_owner_check CHECK (
    (partner_id IS NOT NULL AND owner_company_id IS NULL) OR
    (partner_id IS NULL AND owner_company_id IS NOT NULL)
  );

COMMENT ON COLUMN coupons.activated_at IS
  'Nulo ate ativar. Cupom de parceiro nasce nulo (so ativa na aprovacao, ADR-0013); cupom de lojista nasce ja ativo.';

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- coupon_redemptions — vinculo permanente cliente -> indicador
-- ---------------------------------------------------------------------------

CREATE TABLE coupon_redemptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id           uuid NOT NULL REFERENCES coupons (id) ON DELETE RESTRICT,
  redeemed_company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  kind                text NOT NULL CHECK (kind IN ('partner', 'lojista')),
  referrer_partner_id uuid REFERENCES partners (id) ON DELETE SET NULL,
  referrer_company_id uuid REFERENCES companies (id) ON DELETE SET NULL,
  coupon_code         text NOT NULL,
  discount_percent    numeric(7, 4) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_referrer_check CHECK (
    (kind = 'partner' AND referrer_partner_id IS NOT NULL AND referrer_company_id IS NULL) OR
    (kind = 'lojista' AND referrer_company_id IS NOT NULL AND referrer_partner_id IS NULL)
  )
);

COMMENT ON TABLE coupon_redemptions IS
  'Copia no instante do resgate — sobrevive a cupom editado/desativado depois (ADR-0013). RLS sem politica; acesso so por coupon_redemption_record.';

-- Uma empresa nova so resgata UM cupom na vida — "uma vez por cliente novo".
CREATE UNIQUE INDEX coupon_redemptions_redeemed_company_unique ON coupon_redemptions (redeemed_company_id);
CREATE INDEX coupon_redemptions_por_parceiro ON coupon_redemptions (referrer_partner_id, created_at DESC);
CREATE INDEX coupon_redemptions_por_indicador ON coupon_redemptions (referrer_company_id, created_at DESC);

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- lojista_free_month_credits — credito cumulativo, consumo FIFO
-- ---------------------------------------------------------------------------

CREATE TABLE lojista_free_month_credits (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  source_redemption_id            uuid NOT NULL REFERENCES coupon_redemptions (id) ON DELETE RESTRICT,
  status                          text NOT NULL DEFAULT 'available'
                                     CHECK (status IN ('available', 'consumed')),
  consumed_at                     timestamptz,
  consumed_subscription_cycle_id  uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lojista_free_month_credits_consumo_consistente
    CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);

COMMENT ON TABLE lojista_free_month_credits IS
  'Um credito por indicacao de lojista concluida — cumulativo, consumido FIFO na geracao do proximo ciclo (ADR-0013, NR-117).';
COMMENT ON COLUMN lojista_free_month_credits.consumed_subscription_cycle_id IS
  'Referencia solta (sem FK) a subscription_cycles: essa tabela e criada por esta migration antes de subscription_cycles ganhar codigo de aplicacao (NR-063) — o vinculo vira FK de verdade quando o billing tiver dono.';

CREATE UNIQUE INDEX lojista_free_month_credits_source_unique ON lojista_free_month_credits (source_redemption_id);
CREATE INDEX lojista_free_month_credits_fifo ON lojista_free_month_credits (company_id, status, created_at);

SELECT enable_tenant_isolation('lojista_free_month_credits');

-- ---------------------------------------------------------------------------
-- Candidatura de Parceiro — RF-02, RF-04 (prompt-conta-parceiro)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION partner_application_submit(
  p_owner_user_id uuid,
  p_owner_company_id uuid,
  p_pix_key text,
  p_pix_key_type text,
  p_message text,
  p_coupon_code text
)
  RETURNS TABLE (partner_id uuid, coupon_id uuid, coupon_code text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_partner_id uuid;
  v_coupon_id uuid;
  v_company_name text;
  v_coupon_code text;
BEGIN
  IF trim(p_pix_key) = '' THEN
    RAISE EXCEPTION 'Chave PIX e obrigatoria.';
  END IF;

  IF trim(p_message) = '' THEN
    RAISE EXCEPTION 'Conte o motivo do pedido de Parceiro.';
  END IF;

  SELECT COALESCE(c.trade_name, c.legal_name) INTO v_company_name
    FROM companies c
   WHERE c.id = p_owner_company_id;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Empresa nao encontrada.';
  END IF;

  /* Ausente ou so espaco = sugerido a partir do nome da empresa (RF-03) —
     mesma funcao que a tela usa para checar disponibilidade em tempo real. */
  v_coupon_code := CASE
    WHEN p_coupon_code IS NULL OR trim(p_coupon_code) = '' THEN coupon_code_suggest(v_company_name)
    ELSE upper(p_coupon_code)
  END;

  INSERT INTO partners (name, owner_company_id, owner_user_id, pix_key, pix_key_type, message)
  VALUES (v_company_name, p_owner_company_id, p_owner_user_id, p_pix_key, p_pix_key_type, p_message)
  RETURNING id INTO v_partner_id;

  INSERT INTO coupons (partner_id, code, kind, percent, discount_cycles)
  VALUES (v_partner_id, v_coupon_code, 'percent', 30, 1)
  RETURNING id INTO v_coupon_id;

  RETURN QUERY SELECT v_partner_id, v_coupon_id, v_coupon_code;
END;
$$;

COMMENT ON FUNCTION partner_application_submit(uuid, uuid, text, text, text, text) IS
  'Cria a candidatura (pending) e o cupom dela, ja inativo — so ativa na aprovacao (ADR-0013).';

CREATE OR REPLACE FUNCTION partner_application_resend(
  p_owner_company_id uuid,
  p_pix_key text,
  p_message text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM partners WHERE owner_company_id = p_owner_company_id AND deleted_at IS NULL FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Nenhuma candidatura de Parceiro encontrada para esta empresa.';
  END IF;

  IF v_status != 'rejected' THEN
    RAISE EXCEPTION 'So e possivel reenviar uma candidatura recusada.';
  END IF;

  UPDATE partners
     SET status = 'pending',
         pix_key = p_pix_key,
         message = p_message,
         reviewed_by = NULL,
         reviewed_at = NULL,
         review_note = NULL,
         updated_at = now()
   WHERE owner_company_id = p_owner_company_id;
END;
$$;

COMMENT ON FUNCTION partner_application_resend(uuid, text, text) IS
  'Reabre uma candidatura recusada para pending, sem carencia (ADR-0013).';

CREATE OR REPLACE FUNCTION partner_application_review(
  p_reviewed_by uuid,
  p_partner_id uuid,
  p_decision text,
  p_note text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT platform_admin_is(p_reviewed_by) THEN
    RAISE EXCEPTION 'Apenas Super Admin pode revisar candidatura de Parceiro.';
  END IF;

  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decisao invalida: %.', p_decision;
  END IF;

  SELECT status INTO v_status FROM partners WHERE id = p_partner_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Candidatura nao encontrada.';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Esta candidatura ja foi revisada.';
  END IF;

  UPDATE partners
     SET status = CASE WHEN p_decision = 'approve' THEN 'active' ELSE 'rejected' END,
         reviewed_by = p_reviewed_by,
         reviewed_at = now(),
         review_note = p_note,
         updated_at = now()
   WHERE id = p_partner_id;

  IF p_decision = 'approve' THEN
    UPDATE coupons SET activated_at = now(), updated_at = now()
     WHERE partner_id = p_partner_id AND activated_at IS NULL;
  END IF;
END;
$$;

COMMENT ON FUNCTION partner_application_review(uuid, uuid, text, text) IS
  'Aprova ou recusa — so Super Admin (ADR-0007/ADR-0013). Aprovar ativa o cupom junto.';

CREATE OR REPLACE FUNCTION partner_application_list_pending(p_requested_by uuid)
  RETURNS TABLE (
    partner_id     uuid,
    company_id     uuid,
    company_name   text,
    company_phone  text,
    company_email  text,
    pix_key        text,
    pix_key_type   text,
    message        text,
    coupon_code    text,
    created_at     timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT platform_admin_is(p_requested_by) THEN
    RAISE EXCEPTION 'Apenas Super Admin pode listar candidaturas de Parceiro.';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      c.id,
      COALESCE(c.trade_name, c.legal_name),
      c.phone,
      c.email,
      p.pix_key,
      p.pix_key_type,
      p.message,
      co.code,
      p.created_at
    FROM partners p
    JOIN companies c ON c.id = p.owner_company_id
    LEFT JOIN coupons co ON co.partner_id = p.id
    WHERE p.status = 'pending' AND p.deleted_at IS NULL
    ORDER BY p.created_at ASC;
END;
$$;

COMMENT ON FUNCTION partner_application_list_pending(uuid) IS
  'Fila de aprovacao do painel de Admin — so Super Admin (ADR-0013).';

CREATE OR REPLACE FUNCTION partner_application_mine(p_owner_company_id uuid)
  RETURNS TABLE (
    partner_id   uuid,
    status       text,
    pix_key      text,
    pix_key_type text,
    message      text,
    review_note  text,
    coupon_code  text,
    created_at   timestamptz,
    reviewed_at  timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT p.id, p.status, p.pix_key, p.pix_key_type, p.message, p.review_note, co.code, p.created_at, p.reviewed_at
      FROM partners p
      LEFT JOIN coupons co ON co.partner_id = p.id
     WHERE p.owner_company_id = p_owner_company_id AND p.deleted_at IS NULL
  $$;

COMMENT ON FUNCTION partner_application_mine(uuid) IS
  'Self-service: a propria empresa le o status da candidatura dela (ADR-0013).';

-- ---------------------------------------------------------------------------
-- Cupom — criacao para lojista, consulta publica, resgate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION coupon_code_available(p_code text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT NOT EXISTS (
      SELECT 1 FROM coupons WHERE upper(code) = upper(p_code) AND deleted_at IS NULL
    )
  $$;

COMMENT ON FUNCTION coupon_code_available(text) IS
  'Disponibilidade de nome de cupom, sem caixa nem espaco (ADR-0013).';

CREATE OR REPLACE FUNCTION coupon_code_suggest(p_base text)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix int := 0;
BEGIN
  v_base := upper(regexp_replace(coalesce(p_base, ''), '[^a-zA-Z0-9]', '', 'g'));
  IF v_base = '' THEN
    v_base := 'PARCEIRO';
  END IF;
  v_base := left(v_base, 12);

  v_candidate := v_base;
  WHILE EXISTS (SELECT 1 FROM coupons WHERE upper(code) = v_candidate AND deleted_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_candidate := v_base || v_suffix::text;
  END LOOP;

  RETURN v_candidate;
END;
$$;

COMMENT ON FUNCTION coupon_code_suggest(text) IS
  'Sugestao de nome de cupom a partir de um nome base, com sufixo numerico se colidir (ADR-0013).';

CREATE OR REPLACE FUNCTION coupon_create_for_company(p_owner_company_id uuid, p_code text)
  RETURNS TABLE (coupon_id uuid, coupon_code text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_coupon_id uuid;
BEGIN
  INSERT INTO coupons (owner_company_id, code, kind, percent, discount_cycles, activated_at)
  VALUES (p_owner_company_id, upper(p_code), 'percent', 30, 1, now())
  RETURNING id INTO v_coupon_id;

  RETURN QUERY SELECT v_coupon_id, upper(p_code);
END;
$$;

COMMENT ON FUNCTION coupon_create_for_company(uuid, text) IS
  'Cupom de lojista — ativo na hora, sem aprovacao (ADR-0013). Chamado no fim do cadastro de toda empresa nao-Parceiro.';

CREATE OR REPLACE FUNCTION coupon_lookup(p_code text)
  RETURNS TABLE (
    coupon_id        uuid,
    kind             text,
    referrer_label   text,
    active           boolean,
    discount_percent numeric
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT
      c.id,
      CASE WHEN c.partner_id IS NOT NULL THEN 'partner' ELSE 'lojista' END,
      COALESCE(p.name, oc.trade_name, oc.legal_name),
      c.activated_at IS NOT NULL
        AND c.revoked_at IS NULL
        AND c.deleted_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at > now())
        AND (c.max_redemptions IS NULL OR c.redeemed_count < c.max_redemptions),
      c.percent
    FROM coupons c
    LEFT JOIN partners p ON p.id = c.partner_id
    LEFT JOIN companies oc ON oc.id = c.owner_company_id
    WHERE upper(c.code) = upper(p_code) AND c.deleted_at IS NULL
  $$;

COMMENT ON FUNCTION coupon_lookup(text) IS
  'Consulta publica por codigo — retorno minimo, nunca PIX nem mensagem (ADR-0013, mesmo padrao de company_connections_search).';

CREATE OR REPLACE FUNCTION coupon_redemption_record(p_coupon_code text, p_redeemed_company_id uuid)
  RETURNS TABLE (redemption_id uuid, discount_percent numeric)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_kind text;
  v_referrer_owner_company_id uuid;
  v_redemption_id uuid;
BEGIN
  SELECT * INTO v_coupon FROM coupons WHERE upper(code) = upper(p_coupon_code) AND deleted_at IS NULL FOR UPDATE;

  IF v_coupon.id IS NULL THEN
    RAISE EXCEPTION 'Cupom nao encontrado.';
  END IF;

  IF v_coupon.activated_at IS NULL THEN
    RAISE EXCEPTION 'Este cupom ainda nao foi ativado.';
  END IF;

  IF v_coupon.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este cupom foi revogado.';
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now() THEN
    RAISE EXCEPTION 'Este cupom expirou.';
  END IF;

  IF v_coupon.max_redemptions IS NOT NULL AND v_coupon.redeemed_count >= v_coupon.max_redemptions THEN
    RAISE EXCEPTION 'Este cupom atingiu o limite de uso.';
  END IF;

  IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE redeemed_company_id = p_redeemed_company_id) THEN
    RAISE EXCEPTION 'Esta empresa ja resgatou um cupom antes.';
  END IF;

  IF v_coupon.partner_id IS NOT NULL THEN
    v_kind := 'partner';
    SELECT owner_company_id INTO v_referrer_owner_company_id FROM partners WHERE id = v_coupon.partner_id;
  ELSE
    v_kind := 'lojista';
    v_referrer_owner_company_id := v_coupon.owner_company_id;
  END IF;

  IF v_referrer_owner_company_id = p_redeemed_company_id THEN
    RAISE EXCEPTION 'Nao e possivel resgatar o proprio cupom.';
  END IF;

  INSERT INTO coupon_redemptions (
    coupon_id, redeemed_company_id, kind, referrer_partner_id, referrer_company_id, coupon_code, discount_percent
  ) VALUES (
    v_coupon.id, p_redeemed_company_id, v_kind,
    CASE WHEN v_kind = 'partner' THEN v_coupon.partner_id END,
    CASE WHEN v_kind = 'lojista' THEN v_coupon.owner_company_id END,
    v_coupon.code, v_coupon.percent
  )
  RETURNING id INTO v_redemption_id;

  UPDATE coupons SET redeemed_count = redeemed_count + 1, updated_at = now() WHERE id = v_coupon.id;

  IF v_kind = 'lojista' THEN
    INSERT INTO lojista_free_month_credits (company_id, source_redemption_id)
    VALUES (v_coupon.owner_company_id, v_redemption_id);
  END IF;

  RETURN QUERY SELECT v_redemption_id, v_coupon.percent;
END;
$$;

COMMENT ON FUNCTION coupon_redemption_record(text, uuid) IS
  'Resgate no cadastro — grava o vinculo permanente e, se lojista, o credito de mes gratis (ADR-0013). Uma empresa so resgata uma vez na vida.';
