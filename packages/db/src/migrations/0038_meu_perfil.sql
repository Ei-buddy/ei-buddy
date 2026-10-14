-- Meu perfil: trocar nome e e-mail pelo aplicativo — NR-153.
--
-- Mesmo desenho das `auth_user_*` (0003, 0035): `users` tem RLS por empresa, e
-- esta escrita e sobre a PESSOA, que pode ser dona de mais de uma loja. Quem
-- chama ja se autenticou e passa o proprio id.

CREATE OR REPLACE FUNCTION auth_user_change_name(p_user_id uuid, p_name text)
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    UPDATE users
       SET name = p_name,
           updated_at = now()
     WHERE id = p_user_id
  $$;

COMMENT ON FUNCTION auth_user_change_name(uuid, text) IS
  'Troca o nome da pessoa logada (NR-153).';

-- O indice `users_email_unico` (lower) e a guarda final contra duas contas com
-- o mesmo e-mail: o caso de uso confere antes, o banco confere de novo.
CREATE OR REPLACE FUNCTION auth_user_change_email(p_user_id uuid, p_email text)
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    UPDATE users
       SET email = p_email,
           updated_at = now()
     WHERE id = p_user_id
  $$;

COMMENT ON FUNCTION auth_user_change_email(uuid, text) IS
  'Troca o e-mail da pessoa logada — e o e-mail de entrar e de recuperar a senha (NR-153).';

-- O contato passa a trazer o nome: a tela de perfil mostra os tres juntos.
DROP FUNCTION IF EXISTS auth_user_contact(uuid);

CREATE FUNCTION auth_user_contact(p_user_id uuid)
  RETURNS TABLE (email text, phone text, auth_subject text, name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT u.email, u.phone, u.auth_subject, u.name
      FROM users u
     WHERE u.id = p_user_id
  $$;

COMMENT ON FUNCTION auth_user_contact(uuid) IS
  'Contato da propria pessoa logada, para conferir a senha e trocar celular, e-mail e nome (RF-132, NR-153).';
