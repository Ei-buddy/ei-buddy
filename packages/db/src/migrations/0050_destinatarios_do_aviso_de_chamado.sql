-- Para quem vai o aviso de chamado novo — DEC-029, NR-220.
--
-- Decisao de 15/11: todo Super Admin recebe o aviso por e-mail. A lista de
-- Super Admins so sai pelas funcoes `platform_admin_*`, que exigem que QUEM
-- PERGUNTA seja Super Admin (0008). Aqui nao ha quem pergunte: quem dispara o
-- aviso e o lojista abrindo um chamado.
--
-- Por isso uma funcao propria, e estreita de proposito: devolve so nome e
-- e-mail de quem e Super Admin ativo (e com conta ativa) — nada de loja,
-- nada de chamado. E o que o envio de um aviso precisa, e nada a mais.

CREATE OR REPLACE FUNCTION platform_alert_recipients()
  RETURNS TABLE (name text, email text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT u.name, u.email
      FROM platform_admins pa
      JOIN users u ON u.id = pa.user_id
     WHERE pa.revoked_at IS NULL
       AND u.is_active
     ORDER BY u.name, u.email;
  $$;

GRANT EXECUTE ON FUNCTION platform_alert_recipients() TO PUBLIC;

COMMENT ON FUNCTION platform_alert_recipients() IS
  'Nome e e-mail dos Super Admins ativos, para avisos da plataforma (DEC-029). So isso: nada de loja.';
