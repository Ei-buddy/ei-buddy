-- Recuperar senha — NR-014, RF-119.
--
-- A tela "Esqueci minha senha" dizia "enviamos um link" e nao enviava nada.
-- Esta tabela guarda o link de redefinicao: um token de uso UNICO, com prazo.
--
-- ## O mesmo desenho de `sessions` (0004)
--
-- Guarda o HASH do token, nunca o token: um dump desta tabela com os tokens em
-- texto seria um punhado de senhas trocaveis. SHA-256 e nao KDF lento, pelo
-- mesmo motivo da sessao — sao 256 bits sorteados, nao ha palpite a atrasar.
--
-- RLS forcada SEM politica: nenhum tenant tem o que ler aqui, e quem pede o
-- link ainda nem entrou. Todo acesso passa pelas duas funcoes abaixo.

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- O e-mail para o qual o link foi mandado: e ele que identifica a credencial
  -- no provedor de identidade na hora de trocar a senha.
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX password_reset_tokens_hash_unico ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_por_usuario ON password_reset_tokens (user_id);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE password_reset_tokens IS
  'Links de redefinicao de senha — hash do token, uso unico, com prazo. RLS sem politica; acesso so pelas funcoes auth_password_reset_* (NR-014).';

-- Emite o link.
--
-- Apaga os links anteriores da mesma pessoa: so o ULTIMO vale. Quem pediu tres
-- vezes e clicou no primeiro e-mail recebe "link invalido" — e o certo, porque
-- um link velho esquecido numa caixa de entrada e uma porta aberta.
CREATE OR REPLACE FUNCTION auth_password_reset_issue(
  p_token_hash text,
  p_user_id uuid,
  p_email text,
  p_expires_at timestamptz
)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    DELETE FROM password_reset_tokens WHERE user_id = p_user_id;

    INSERT INTO password_reset_tokens (token_hash, user_id, email, expires_at)
    VALUES (p_token_hash, p_user_id, p_email, p_expires_at);
  END;
  $$;

COMMENT ON FUNCTION auth_password_reset_issue(text, uuid, text, timestamptz) IS
  'Grava o link de redefinicao e invalida os anteriores da mesma pessoa (NR-014).';

-- Consome o link: uso unico, dentro do prazo.
--
-- E encerra TODAS as sessoes da pessoa. Quem troca a senha porque desconfia que
-- alguem entrou precisa que esse alguem saia — e diferente da RF-006 (perder
-- acesso a UMA loja), aqui e a credencial da pessoa inteira que mudou.
CREATE OR REPLACE FUNCTION auth_password_reset_consume(p_token_hash text)
  RETURNS TABLE (user_id uuid, email text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_user_id uuid;
    v_email text;
  BEGIN
    UPDATE password_reset_tokens t
       SET used_at = now()
     WHERE t.token_hash = p_token_hash
       AND t.used_at IS NULL
       AND t.expires_at > now()
    RETURNING t.user_id, t.email INTO v_user_id, v_email;

    IF v_user_id IS NULL THEN
      RETURN;
    END IF;

    UPDATE sessions s SET revoked_at = now() WHERE s.user_id = v_user_id AND s.revoked_at IS NULL;

    RETURN QUERY SELECT v_user_id, v_email;
  END;
  $$;

COMMENT ON FUNCTION auth_password_reset_consume(text) IS
  'Consome o link (uso unico, no prazo) e encerra as sessoes da pessoa (NR-014).';
