-- Motivo da recusa do cupom — NR-063, RF-115.
--
-- ## O defeito
--
-- `coupon_lookup` (migration 0014) responde `active boolean`: um cupom
-- revogado, um vencido, um esgotado e um ainda nao aprovado devolvem todos
-- `false`. A RF-115 pede o MOTIVO EXATO da recusa, e um booleano so sabe
-- dizer "nao".
--
-- Na tela isso vira "cupom invalido" para os quatro casos, e as acoes de quem
-- le sao diferentes: conferir a digitacao, esperar a aprovacao, pedir outro
-- codigo, ou desistir porque alguem chegou antes.
--
-- ## Por que aqui, e nao em `core`
--
-- A tentacao seria devolver as colunas cruas (`revoked_at`, `expires_at`,
-- `redeemed_count`, `max_redemptions`) e decidir em TypeScript. Duas razoes
-- contra:
--
-- 1. `coupon_lookup` e consulta PUBLICA por codigo — quem digita um cupom
--    ainda nao tem empresa. Devolver as colunas cruas transformaria a funcao
--    num contador de resgates de qualquer codigo que alguem adivinhe. O
--    retorno minimo e o que torna a leitura publica aceitavel.
-- 2. `active` continua sendo calculado aqui. Ter o booleano no SQL e o motivo
--    no TypeScript seriam duas respostas para "este cupom vale?", e elas
--    divergem na primeira mudanca de regra.
--
-- ## A ordem do CASE e regra, nao arrumacao
--
-- Da recusa mais definitiva para a mais circunstancial:
--
--   revogado -> nao aprovado -> vencido -> esgotado
--
-- Um cupom revogado no mes passado que tambem esgotou a cota responde
-- "revogado". Invertida, a tela mandaria o lojista pedir mais cotas ao
-- parceiro de um codigo que foi morto de proposito.
--
-- ## `DROP` e nao `CREATE OR REPLACE`
--
-- Postgres recusa trocar o tipo de retorno de uma funcao existente, e
-- acrescentar coluna ao `RETURNS TABLE` e trocar o tipo. Nenhum codigo de
-- producao chama `coupon_lookup` hoje (so a suite de `partner-coupons`), e a
-- recriacao acontece na mesma transacao da migration.

DROP FUNCTION IF EXISTS coupon_lookup(text);

CREATE FUNCTION coupon_lookup(p_code text)
  RETURNS TABLE (
    coupon_id        uuid,
    kind             text,
    referrer_label   text,
    active           boolean,
    discount_percent numeric,
    reason           text
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
      c.percent,
      CASE
        WHEN c.revoked_at IS NOT NULL THEN 'revoked'
        WHEN c.activated_at IS NULL THEN 'inactive'
        WHEN c.expires_at IS NOT NULL AND c.expires_at <= now() THEN 'expired'
        WHEN c.max_redemptions IS NOT NULL AND c.redeemed_count >= c.max_redemptions
          THEN 'exhausted'
        ELSE 'ok'
      END
    FROM coupons c
    LEFT JOIN partners p ON p.id = c.partner_id
    LEFT JOIN companies oc ON oc.id = c.owner_company_id
    WHERE upper(c.code) = upper(p_code) AND c.deleted_at IS NULL
  $$;

COMMENT ON FUNCTION coupon_lookup(text) IS
  'Consulta publica por codigo — retorno minimo, nunca PIX nem mensagem (ADR-0013). `reason` diz POR QUE quando `active` e falso (RF-115).';

GRANT EXECUTE ON FUNCTION coupon_lookup(text) TO PUBLIC;
