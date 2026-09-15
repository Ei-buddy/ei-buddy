-- ---------------------------------------------------------------------------
-- Nome de quem agiu, para a leitura da trilha — US-061
-- ---------------------------------------------------------------------------
--
-- ## O problema que esta funcao resolve
--
-- A US-061 pede, em voz alta, que a consulta mostre "o usuario humano que
-- confirmou, nao 'sistema'". Um `JOIN` com `users` dentro da consulta da
-- trilha nao entrega isso, porque `users` tem politica de RLS que so mostra
-- quem tem vinculo com a empresa do CONTEXTO (migration 0002).
--
-- O efeito pratico e que o nome sumiria exatamente nos dois casos que mais
-- interessam a quem audita:
--
--   1. o funcionario que SAIU — e "o que o fulano andou fazendo antes de ir
--      embora" e uma das perguntas que a historia existe para responder;
--   2. o proprio Super Admin agindo dentro da loja (ADR-0007) — ele nao tem
--      vinculo em `company_users`, entao a trilha registraria a acao dele sem
--      dizer quem foi. Auditoria que nao nomeia quem entrou de fora e a que
--      menos serve.
--
-- ## Por que atravessar a politica aqui e aceitavel
--
-- Mesmo desenho e mesmo limite das funcoes `auth_*` (migration 0003): retorno
-- MINIMO (id e nome, nada de e-mail, telefone ou `auth_subject`), igualdade
-- exata contra ids que quem chama ja tem em maos, e `search_path` fixo.
--
-- Quem chama so tem os ids porque ja leu a trilha da propria empresa, sob RLS.
-- Ou seja: nao da para descobrir nome de ninguem sem antes ter uma linha de
-- auditoria daquela pessoa na sua propria loja.

CREATE OR REPLACE FUNCTION audit_actor_names(p_ids uuid[])
  RETURNS TABLE (id uuid, name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, u.name
      FROM users u
     WHERE u.id = ANY (p_ids)
  $$;

COMMENT ON FUNCTION audit_actor_names(uuid[]) IS
  'Nome de quem agiu, para a leitura da trilha (US-061). Atravessa a politica de users como as funcoes auth_*, com retorno minimo — inclui quem saiu da loja e o Super Admin, que nao tem vinculo.';
