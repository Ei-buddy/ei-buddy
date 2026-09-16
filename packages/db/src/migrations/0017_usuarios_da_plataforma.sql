-- ---------------------------------------------------------------------------
-- Usuarios da plataforma, para o Super Admin — NR-121, ADR-0007
-- ---------------------------------------------------------------------------
--
-- ## Por que uma funcao, e nao uma consulta
--
-- `users` tem politica de RLS que so mostra quem tem vinculo com a empresa do
-- CONTEXTO (migration 0002), e o Super Admin nao tem empresa ativa quando esta
-- no painel — a consulta comum devolveria zero linhas para ele.
--
-- Mesmo desenho das outras funcoes do painel (`platform_admin_list`,
-- `platform_admin_list_companies`): `SECURITY DEFINER`, `search_path` fixo, e
-- a PRIMEIRA coisa que faz e exigir `platform_admin_is`. A checagem aqui nao
-- substitui a de `core`; e a que sobra de pe se alguem, um dia, chamar a
-- funcao por fora.
--
-- ## O que devolve junto
--
-- A tela precisa responder "quem e essa pessoa e o que ela pode" numa linha
-- so. Buscar as lojas de cada usuario num segundo pedido faria N+1 e, pior,
-- uma tela que mostra o nome antes de saber o acesso — que e justamente o
-- dado pelo qual se abre esta tela. Por isso as lojas vem agregadas em JSON, e
-- `is_platform_admin` vem calculado.
--
-- `total_geral` acompanha a pagina (`count(*) OVER ()`) pelo mesmo motivo da
-- lista de espera: um `SELECT count(*)` em separado varreria de novo e as duas
-- leituras discordariam assim que alguem se cadastrasse no meio.

CREATE OR REPLACE FUNCTION platform_admin_list_users(
  p_requested_by uuid,
  p_search text,
  p_limit int,
  p_offset int
)
  RETURNS TABLE (
    user_id uuid,
    name text,
    email text,
    is_active boolean,
    created_at timestamptz,
    is_platform_admin boolean,
    last_access_at timestamptz,
    companies jsonb,
    total_geral bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve os usuarios da plataforma.';
    END IF;

    RETURN QUERY
    SELECT
      u.id,
      u.name,
      u.email,
      u.is_active,
      u.created_at,
      EXISTS (
        SELECT 1 FROM platform_admins pa
         WHERE pa.user_id = u.id AND pa.revoked_at IS NULL
      ),
      (SELECT max(s.issued_at) FROM sessions s WHERE s.user_id = u.id),
      COALESCE(
        (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'companyId', c.id,
                     'name', COALESCE(c.trade_name, c.legal_name),
                     'role', cu.role
                   )
                   ORDER BY COALESCE(c.trade_name, c.legal_name)
                 )
            FROM company_users cu
            JOIN companies c ON c.id = cu.company_id
           WHERE cu.user_id = u.id
        ),
        '[]'::jsonb
      ),
      count(*) OVER ()
      FROM users u
     WHERE p_search IS NULL
        OR p_search = ''
        OR u.name ILIKE '%' || p_search || '%'
        OR u.email ILIKE '%' || p_search || '%'
     /* Quem entrou por ultimo primeiro: a tela existe para agir sobre gente
        ativa, e quem acabou de chegar e o motivo mais comum de abri-la. */
     ORDER BY u.created_at DESC
     LIMIT p_limit OFFSET p_offset;
  END;
  $$;

COMMENT ON FUNCTION platform_admin_list_users(uuid, text, int, int) IS
  'Usuarios de toda a plataforma, com lojas e acesso de Super Admin. Exige que quem pergunta seja Super Admin (ADR-0007, NR-121).';
