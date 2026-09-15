-- ---------------------------------------------------------------------------
-- Consentimento dos documentos legais — LGPD art. 8 §1, RF-02/RF-03
-- ---------------------------------------------------------------------------
--
-- ## O que esta tabela resolve
--
-- O aceite dos Termos e da Politica existia so como estado de tela: um
-- checkbox que liberava o botao e morria no navegador. Na pratica, nao havia
-- prova de consentimento de ninguem — e o art. 8 §1 poe o onus da prova em
-- quem trata o dado, nao no titular.
--
-- ## Por que uma linha por aceite, e nunca um UPDATE
--
-- O historico e o produto aqui. Sobrescrever o aceite anterior quando sai uma
-- versao nova apagaria justamente a prova de que a pessoa concordou com o
-- texto que estava em vigor NAQUELE dia — que e a unica coisa que importa se
-- alguem contestar um tratamento feito no passado. Por isso nao ha `UNIQUE`
-- por usuario e documento: repetir e o comportamento correto.
--
-- ## Por que nao existe tabela de documentos
--
-- A versao vigente mora em `packages/contracts/src/legal/legal.ts`, junto do
-- texto que ela descreve — subir a versao e editar a clausula sao o mesmo
-- commit. Uma tabela de documentos seria uma segunda fonte de verdade, e a
-- primeira divergencia produziria consentimento apontando para um texto que
-- nunca esteve no ar. Aqui so se guarda a STRING da versao aceita.
--
-- ## Sem politica de RLS
--
-- Mesmo desenho de `platform_admins` (0008) e `coupon_redemptions` (0014):
-- consentimento pertence a uma PESSOA, nao a uma empresa — a mesma pessoa
-- pode ser dona de mais de uma loja, e o aceite dela e um so. `ENABLE` +
-- `FORCE ROW LEVEL SECURITY` sem politica permissiva nega tudo; todo acesso
-- passa pelas funcoes `legal_consent_*` abaixo, `SECURITY DEFINER`.
--
-- Note que a coluna se chama `user_id` e nao ha `company_id` nenhuma: a
-- guarda de schema exige politica `tenant_isolation` em toda tabela que tenha
-- uma coluna com esse nome, e aqui a regra e a oposta.

CREATE TABLE user_consents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document_type     text NOT NULL CHECK (document_type IN ('privacy', 'terms')),
  document_version  text NOT NULL CHECK (length(trim(document_version)) > 0),
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  -- Prova de consentimento (RF-02). Opcionais porque nem todo caminho tem os
  -- dois: um aceite gravado por um job ou por um canal sem HTTP nao inventa
  -- um IP para preencher a coluna.
  ip                text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_consents IS
  'Prova de aceite dos documentos legais (LGPD art. 8 §1). Append-only: uma linha por aceite, nunca UPDATE. Sem politica de RLS: acesso so pelas funcoes legal_consent_*.';

-- Serve a pergunta que toda sessao faz: "o que esta pessoa ja aceitou?".
-- `accepted_at DESC` porque a resposta e sempre o aceite MAIS RECENTE de cada
-- documento — sem isso, a leitura ordenaria a mao a cada login.
CREATE INDEX user_consents_user_doc_idx
  ON user_consents (user_id, document_type, accepted_at DESC);

ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Registrar um aceite
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION legal_consent_record(
  p_user_id       uuid,
  p_type          text,
  p_version       text,
  p_ip            text,
  p_user_agent    text
) RETURNS TABLE (consent_id uuid, accepted_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF p_type NOT IN ('privacy', 'terms') THEN
      RAISE EXCEPTION 'Documento legal desconhecido: %', p_type;
    END IF;

    IF p_version IS NULL OR trim(p_version) = '' THEN
      RAISE EXCEPTION 'A versao do documento e obrigatoria.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
      RAISE EXCEPTION 'Usuario nao encontrado.';
    END IF;

    RETURN QUERY
      INSERT INTO user_consents (user_id, document_type, document_version, ip, user_agent)
      VALUES (p_user_id, p_type, trim(p_version), p_ip, p_user_agent)
      RETURNING user_consents.id, user_consents.accepted_at;
  END;
  $$;

COMMENT ON FUNCTION legal_consent_record(uuid, text, text, text, text) IS
  'Grava um aceite. Sempre INSERT: o historico por versao e a prova (RF-03).';

-- ---------------------------------------------------------------------------
-- O aceite mais recente de cada documento
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION legal_consent_latest(p_user_id uuid)
  RETURNS TABLE (document_type text, document_version text, accepted_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT DISTINCT ON (c.document_type)
           c.document_type, c.document_version, c.accepted_at
      FROM user_consents c
     WHERE c.user_id = p_user_id
     ORDER BY c.document_type, c.accepted_at DESC
  $$;

COMMENT ON FUNCTION legal_consent_latest(uuid) IS
  'Ultimo aceite de cada documento. Quem compara com a versao vigente e a aplicacao — o banco nao sabe qual versao esta no ar.';

-- ---------------------------------------------------------------------------
-- Historico completo — para atender pedido do titular (LGPD art. 18 II)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION legal_consent_history(p_user_id uuid)
  RETURNS TABLE (document_type text, document_version text, accepted_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT c.document_type, c.document_version, c.accepted_at
      FROM user_consents c
     WHERE c.user_id = p_user_id
     ORDER BY c.accepted_at DESC
  $$;

COMMENT ON FUNCTION legal_consent_history(uuid) IS
  'Todos os aceites, do mais recente ao mais antigo. O historico nao se apaga quando sai versao nova.';
