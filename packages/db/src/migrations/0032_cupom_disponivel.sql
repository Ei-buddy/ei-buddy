-- O nome de cupom esta livre? Perguntado no CADASTRO, antes de criar a conta.
--
-- Sem esta pergunta, o cupom repetido so era pego dentro da candidatura de
-- Parceiro, que roda depois de a conta existir: a tela mostrava "nome de cupom
-- em uso" e o banco ja guardava a conta sem candidatura. Na nova tentativa, o
-- e-mail estava "em uso" e a pessoa ficava presa fora do cadastro.
--
-- SECURITY DEFINER pelo mesmo motivo de `auth_cnpj_taken`: `coupons` tem RLS
-- forcado e nenhuma politica de leitura para o papel da aplicacao. Devolve so
-- um booleano — nada do cupom nem de quem e o dono.
--
-- `upper` porque `partner_application_submit` grava o codigo em maiusculas:
-- "joao10" e "JOAO10" sao o mesmo cupom.

CREATE OR REPLACE FUNCTION coupon_code_taken(p_code text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM coupons c
      WHERE c.code = upper(btrim(p_code)) AND c.deleted_at IS NULL
    )
  $$;

COMMENT ON FUNCTION coupon_code_taken(text) IS
  'Este nome de cupom ja esta em uso? Booleano, sem empresa no contexto (NR-115).';
