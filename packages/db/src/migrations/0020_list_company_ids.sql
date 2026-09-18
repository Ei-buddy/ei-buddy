-- ---------------------------------------------------------------------------
-- Lista de ids de empresa para varredura de plataforma — NR-062 T056
-- ---------------------------------------------------------------------------
--
-- ## O defeito
--
-- O job `conversation-purge` precisa percorrer TODAS as lojas. A composicao
-- do worker fazia `SELECT id FROM companies` dentro de `withPlatformScope`.
-- No papel da aplicacao — sem `app.company_id`, sem `BYPASSRLS` — a politica
-- raiz de `companies` (`id = current_company_id()`, 0002) chama
-- `current_company_id()`, e essa funcao LANCA desde a 0001:
--
--   Consulta sem empresa no contexto: app.company_id nao esta definido.
--
-- Cada corrida do expurgo morreria em producao. Os testes do consumidor
-- injetavam `listTenantIds` e ficavam verdes pelo motivo errado.
--
-- ## A correcao
--
-- A mesma da 0003 para o cadastro (`auth_cnpj_taken`): funcao `SECURITY
-- DEFINER` estreita, com as travas de la:
--
-- 1. `SET search_path` — sem isso, quem chama poderia criar uma tabela
--    `companies` num schema anterior no caminho de busca e a funcao, rodando
--    com privilegio do dono, leria a tabela do atacante.
-- 2. Retorno minimo. So `id`. Nunca `legal_name`, `cnpj` nem `email` — a
--    varredura precisa de quem varrer, nao do cadastro da loja.
-- 3. `STABLE`, sem escrita.
-- 4. Sem `BYPASSRLS` no papel da aplicacao. O buraco e esta funcao, nao o
--    papel.
--
-- Sobre GRANT vale o mesmo da 0003: a funcao nasce executavel por PUBLIC e
-- o GRANT abaixo deixa isso explicito. O papel da aplicacao muda por
-- ambiente e a migration nao o conhece; conceder a um nome fixo e trabalho
-- de implantacao (DEC-009). O contrapeso e o retorno: quem chamar so leva
-- uuids, nunca dado cadastral.

CREATE OR REPLACE FUNCTION list_company_ids()
  RETURNS TABLE (id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT c.id FROM companies c
  $$;

COMMENT ON FUNCTION list_company_ids() IS
  'Ids de todas as empresas, sem tenant no contexto. So id — nunca legal_name, cnpj ou email. Varredura de plataforma do expurgo de conversa (NR-062).';

GRANT EXECUTE ON FUNCTION list_company_ids() TO PUBLIC;
