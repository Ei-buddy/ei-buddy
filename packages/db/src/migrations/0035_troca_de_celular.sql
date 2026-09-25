-- Trocar o celular pelo aplicativo — RF-132, ADR-0012, NR-113.
--
-- O celular do owner e o vinculo do canal WhatsApp (`channel_owner_by_phone`,
-- 0028): trocar o numero em `users` e o que faz o numero antigo deixar de
-- operar a loja pelo WhatsApp. Nao ha outra tabela a mexer — o canal le daqui.
--
-- Mesmo desenho das `auth_user_*` (0003): `users` tem RLS por empresa, e esta
-- escrita e sobre a PESSOA, que pode ser dona de mais de uma loja. Quem chama
-- ja se autenticou e passa o proprio id; nao ha como mirar outra pessoa sem
-- conhecer o id dela E ter a sessao dela.

CREATE OR REPLACE FUNCTION auth_user_contact(p_user_id uuid)
  RETURNS TABLE (email text, phone text, auth_subject text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT u.email, u.phone, u.auth_subject
      FROM users u
     WHERE u.id = p_user_id
  $$;

COMMENT ON FUNCTION auth_user_contact(uuid) IS
  'Contato da propria pessoa logada, para conferir a senha e trocar o celular (RF-132).';

-- O indice `users_phone_unico` e a guarda final contra dois donos com o mesmo
-- numero: o caso de uso confere antes, o banco confere de novo.
CREATE OR REPLACE FUNCTION auth_user_change_phone(p_user_id uuid, p_phone text)
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    UPDATE users
       SET phone = p_phone,
           updated_at = now()
     WHERE id = p_user_id
  $$;

COMMENT ON FUNCTION auth_user_change_phone(uuid, text) IS
  'Troca o celular da pessoa — e o que tira o numero antigo do canal WhatsApp (RF-132, ADR-0012).';
