-- Quem opera o WhatsApp de uma loja — RF-094, RF-095, ADR-0012, NR-113.
--
-- ## A pergunta que nao cabe dentro de uma empresa
--
-- O webhook da Meta traz um NUMERO. Nao traz cookie, nem Bearer, nem empresa.
-- Para saber de qual loja aquela mensagem fala, e preciso ler `users` e
-- `company_users` ANTES de existir tenant no contexto — e a politica de
-- `company_users` filtra justamente pela empresa do contexto.
--
-- Mesmo desenho de `auth_user_by_phone` e `auth_memberships` (0003), e pelo
-- mesmo motivo. As travas sao as de la: `search_path` fixo, retorno minimo,
-- `STABLE`, e nenhum `BYPASSRLS` no papel da aplicacao — o buraco e esta
-- funcao, nao o papel.
--
-- ## Por que uma funcao propria, e nao `auth_memberships`
--
-- Aquela ordena por `legal_name`, porque serve a tela de escolher loja, em que
-- ordem alfabetica e o que ajuda. Aqui "a primeira empresa" da ADR-0012 e a
-- primeira em ORDEM DE VINCULO: com ordem alfabetica, renomear uma loja
-- mudaria qual delas o chip opera — sem ninguem tocar no canal.
--
-- ## Retorno minimo, e nao "o usuario"
--
-- So `company_id` e `user_id`. Nome, e-mail e telefone nao saem: quem chama
-- precisa montar um `ExecutionContext`, e nada mais. Devolver o cadastro
-- transformaria a funcao num consultor de usuario por telefone para qualquer
-- um que alcance o banco.
--
-- ## So `owner`
--
-- Ponto 4 da ADR-0012: staff e contador nao tem canal. O filtro mora aqui,
-- e nao em quem chama, para nao haver um segundo lugar em que a regra possa
-- ser esquecida.

CREATE OR REPLACE FUNCTION channel_owner_by_phone(p_phone text)
  RETURNS TABLE (company_id uuid, user_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT cu.company_id, u.id
      FROM users u
      JOIN company_users cu ON cu.user_id = u.id
     WHERE u.phone = p_phone
       AND u.is_active
       AND cu.is_active
       AND cu.role = 'owner'
     -- `company_id` desempata: sem ele, dois vinculos criados no mesmo
     -- instante devolveriam ora um, ora outro, e o canal trocaria de loja
     -- entre duas mensagens.
     ORDER BY cu.created_at, cu.company_id
     LIMIT 1
  $$;

COMMENT ON FUNCTION channel_owner_by_phone(text) IS
  'Vinculo do canal WhatsApp: telefone -> primeira empresa em que a pessoa e owner (RF-094, ADR-0012). Retorno minimo, sem cadastro.';

GRANT EXECUTE ON FUNCTION channel_owner_by_phone(text) TO PUBLIC;
