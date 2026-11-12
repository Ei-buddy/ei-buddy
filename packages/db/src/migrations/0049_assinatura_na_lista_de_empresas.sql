-- A assinatura de cada loja na lista da plataforma — NR-216.
--
-- Achado do QA (item 18): a plataforma nao enxergava inadimplencia. A lista
-- de empresas do Super Admin (0008) trazia nome, CNPJ e se esta ativa, mas
-- nada de `subscriptions` — e a RLS impede o painel de ler a assinatura de
-- outra loja por conta propria.
--
-- Mesma funcao, mesmo desenho (`SECURITY DEFINER`, checagem de Super Admin
-- dentro do banco), com quatro colunas a mais. Empresa sem assinatura volta
-- com as quatro nulas: e o caso de todas enquanto o preco e os prazos
-- (QST-002) nao estao configurados.
--
-- DROP antes do CREATE: o tipo de retorno muda, e `CREATE OR REPLACE` nao
-- troca o RETURNS TABLE de uma funcao que ja existe.

DROP FUNCTION IF EXISTS platform_admin_list_companies(uuid);

CREATE FUNCTION platform_admin_list_companies(p_requested_by uuid)
  RETURNS TABLE (
    id uuid,
    legal_name text,
    trade_name text,
    cnpj text,
    is_active boolean,
    created_at timestamptz,
    subscription_status text,
    trial_ends_at timestamptz,
    next_due_date date,
    restricted_at timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve a lista de empresas.';
    END IF;

    RETURN QUERY
    SELECT c.id, c.legal_name, c.trade_name, c.cnpj, c.is_active, c.created_at,
           s.status, s.trial_ends_at, s.next_due_date, s.restricted_at
      FROM companies c
      LEFT JOIN subscriptions s
        ON s.company_id = c.id
       AND s.deleted_at IS NULL
     ORDER BY c.created_at DESC;
  END;
  $$;

GRANT EXECUTE ON FUNCTION platform_admin_list_companies(uuid) TO PUBLIC;

COMMENT ON FUNCTION platform_admin_list_companies(uuid) IS
  'Toda empresa cadastrada, com a situacao da assinatura (NR-216), para o painel do Super Admin. Exige que quem pergunta seja Super Admin (ADR-0007).';
