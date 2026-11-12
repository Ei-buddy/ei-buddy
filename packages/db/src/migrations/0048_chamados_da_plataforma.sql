-- Chamados vistos pela plataforma — NR-215.
--
-- Achado do QA: "Suporte — como enxergaremos os chamados?". Nao enxergavamos.
-- O chamado so existia dentro da loja que o abriu (RLS por empresa), e nada
-- gravava resposta com `author = 'suporte'`: o "painel proprio" que a 0007
-- previa nunca foi feito.
--
-- Mesmo caminho da 0008 (Super Admin): funcoes SECURITY DEFINER, que conferem
-- `platform_admin_is` DENTRO do banco antes de atravessar empresas. O papel da
-- aplicacao continua sem enxergar outra loja por conta propria; quem atravessa
-- e a funcao, e so para quem e Super Admin.
--
-- Situacao do chamado para a fila da plataforma (derivada, nao guardada):
--   responder  = nao encerrado e a ultima mensagem e do CLIENTE
--   aguardando = nao encerrado e a ultima mensagem e do SUPORTE
--   encerrados = status 'closed'

CREATE OR REPLACE FUNCTION platform_support_counts(p_requested_by uuid)
  RETURNS TABLE (responder bigint, aguardando bigint, encerrados bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve os chamados da plataforma.';
    END IF;

    RETURN QUERY
    WITH ultimo AS (
      SELECT t.status,
             (SELECT m.author FROM ticket_messages m
               WHERE m.ticket_id = t.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS autor
        FROM support_tickets t
    )
    SELECT count(*) FILTER (WHERE u.status <> 'closed' AND u.autor = 'cliente'),
           count(*) FILTER (WHERE u.status <> 'closed' AND u.autor = 'suporte'),
           count(*) FILTER (WHERE u.status = 'closed')
      FROM ultimo u;
  END;
  $$;

CREATE OR REPLACE FUNCTION platform_support_list(
  p_requested_by uuid,
  p_situacao text,
  p_limit integer,
  p_offset integer
)
  RETURNS TABLE (
    id uuid,
    company_id uuid,
    company_name text,
    protocol text,
    subject text,
    category text,
    status text,
    created_at timestamptz,
    updated_at timestamptz,
    last_author text,
    messages_count bigint,
    total_geral bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve os chamados da plataforma.';
    END IF;

    RETURN QUERY
    WITH base AS (
      SELECT t.id, t.company_id, COALESCE(c.trade_name, c.legal_name) AS company_name,
             t.protocol, t.subject, t.category, t.status, t.created_at, t.updated_at,
             (SELECT m.author FROM ticket_messages m
               WHERE m.ticket_id = t.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_author,
             (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages_count
        FROM support_tickets t
        JOIN companies c ON c.id = t.company_id
    )
    SELECT b.*, count(*) OVER () AS total_geral
      FROM base b
     WHERE p_situacao = 'todos'
        OR (p_situacao = 'responder' AND b.status <> 'closed' AND b.last_author = 'cliente')
        OR (p_situacao = 'aguardando' AND b.status <> 'closed' AND b.last_author = 'suporte')
        OR (p_situacao = 'encerrados' AND b.status = 'closed')
     ORDER BY b.updated_at DESC, b.id
     LIMIT p_limit OFFSET p_offset;
  END;
  $$;

CREATE OR REPLACE FUNCTION platform_support_ticket(p_requested_by uuid, p_ticket_id uuid)
  RETURNS TABLE (
    id uuid,
    company_id uuid,
    company_name text,
    protocol text,
    subject text,
    category text,
    status text,
    created_at timestamptz,
    updated_at timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve os chamados da plataforma.';
    END IF;

    RETURN QUERY
    SELECT t.id, t.company_id, COALESCE(c.trade_name, c.legal_name), t.protocol, t.subject,
           t.category, t.status, t.created_at, t.updated_at
      FROM support_tickets t
      JOIN companies c ON c.id = t.company_id
     WHERE t.id = p_ticket_id;
  END;
  $$;

CREATE OR REPLACE FUNCTION platform_support_messages(p_requested_by uuid, p_ticket_id uuid)
  RETURNS TABLE (
    id uuid,
    author text,
    author_name text,
    body text,
    attachment text,
    created_at timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin ve os chamados da plataforma.';
    END IF;

    RETURN QUERY
    SELECT m.id, m.author, m.author_name, m.body, m.attachment, m.created_at
      FROM ticket_messages m
     WHERE m.ticket_id = p_ticket_id
     ORDER BY m.created_at, m.id;
  END;
  $$;

-- Resposta do suporte. O nome gravado e "Suporte EiBuddy · <primeiro nome>":
-- a loja ve que e a equipe, e quem respondeu fica registrado na conversa.
-- Responder reabre o chamado encerrado — o cliente pode ter voltado ao assunto.
CREATE OR REPLACE FUNCTION platform_support_reply(
  p_requested_by uuid,
  p_ticket_id uuid,
  p_body text
)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_empresa uuid;
    v_nome text;
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin responde chamados da plataforma.';
    END IF;

    SELECT t.company_id INTO v_empresa FROM support_tickets t WHERE t.id = p_ticket_id;
    IF v_empresa IS NULL THEN
      RETURN false;
    END IF;

    SELECT NULLIF(split_part(btrim(u.name), ' ', 1), '') INTO v_nome
      FROM users u WHERE u.id = p_requested_by;

    INSERT INTO ticket_messages (company_id, ticket_id, author, author_name, body)
    VALUES (v_empresa, p_ticket_id, 'suporte',
            'Suporte EiBuddy' || COALESCE(' · ' || v_nome, ''), btrim(p_body));

    UPDATE support_tickets SET status = 'open', updated_at = now() WHERE id = p_ticket_id;
    RETURN true;
  END;
  $$;

CREATE OR REPLACE FUNCTION platform_support_close(p_requested_by uuid, p_ticket_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT platform_admin_is(p_requested_by) THEN
      RAISE EXCEPTION 'Somente Super Admin encerra chamados da plataforma.';
    END IF;

    UPDATE support_tickets SET status = 'closed', updated_at = now() WHERE id = p_ticket_id;
    RETURN FOUND;
  END;
  $$;

-- Executaveis por todos, como as da 0008: quem decide e a checagem la dentro.
GRANT EXECUTE ON FUNCTION platform_support_counts(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_list(uuid, text, integer, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_ticket(uuid, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_messages(uuid, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_reply(uuid, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_close(uuid, uuid) TO PUBLIC;

COMMENT ON FUNCTION platform_support_list(uuid, text, integer, integer) IS
  'Chamados de todas as lojas para o Super Admin (NR-215). Situacao: responder, aguardando, encerrados, todos.';
