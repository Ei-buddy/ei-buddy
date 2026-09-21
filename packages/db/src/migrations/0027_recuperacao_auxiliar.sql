-- Recuperacao auxiliar para desambiguacao — RF-102, ADR-0017, NR-120.
--
-- ## O que esta tabela NAO e
--
-- Nao e fonte de numero. A ADR-0017 separa duas coisas que a ADR-0010 tinha
-- misturado: RECUPERAR (achar o produto pelo apelido) e a VERDADE (quanto
-- vendi, quanto deve). Isto e a primeira. O trecho recuperado sugere qual
-- `productId` passar a tool; o valor da resposta continua vindo da tool ->
-- `core` -> `domain`.
--
-- Por isso a coluna se chama `conteudo` e nao guarda preco, saldo nem
-- quantidade: o que estiver aqui pode estar velho, e dado que pode estar velho
-- nao entra em conta de dinheiro.
--
-- ## Por que trigrama, e nao vetor
--
-- A ADR-0017 diz "Postgres + extensao vetorial, OU EQUIVALENTE". Trigrama e o
-- equivalente que cabe hoje:
--
-- - `pgvector` nao esta na imagem da CI (`postgres:17-alpine`) nem na VPS.
--   Entrar com ele significa mexer nas duas antes de a primeira busca
--   funcionar;
-- - embedding tem custo por chamada, e custo de LLM e justamente o que a
--   QST-002 ainda nao respondeu (RNF-072);
-- - o caso da RF-102 e portugues de balcao — "coca 2l", "refri", "sabao em
--   po" —, que e semelhanca de ESCRITA, nao de significado.
--
-- A porta em `core` nao sabe qual dos dois esta atras. Trocar depois, com
-- evidencia de que faz falta, e substituir o adapter — nao refazer o desenho.
--
-- ## As extensoes vem daqui, e nao do script de init
--
-- `infra/postgres/init/01-extensions.sql` so roda na criacao do container, e a
-- CI sobe `postgres:17-alpine` sem monta-lo. Uma migration que dependesse dele
-- passaria local e quebraria na CI. As tres sao TRUSTED desde o PG13, entao o
-- dono do banco as instala sem ser superusuario.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Permite um indice GIN que comeca por `company_id` — ver o indice abaixo.
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE TABLE retrieval_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,

  -- De onde o trecho veio. `faq` nao aponta para linha nenhuma.
  kind         text NOT NULL CHECK (kind IN ('product', 'customer', 'faq')),
  -- O `products.id` / `customers.id` que a tool vai receber. Nulo em `faq`.
  ref_id       uuid,

  -- O texto como a pessoa o reconheceria.
  conteudo     text NOT NULL CHECK (length(conteudo) > 0),

  -- O mesmo texto sem acento e em minuscula, que e sobre o que a busca roda.
  --
  -- Coluna comum, e nao gerada: `unaccent` NAO e IMMUTABLE (depende do
  -- dicionario carregado), e o Postgres recusa usa-la em coluna gerada ou em
  -- indice. A saida usual e embrulhar numa funcao marcada IMMUTABLE a mao —
  -- uma mentira ao planejador que volta como indice corrompido depois de um
  -- upgrade do dicionario. Normalizar em quem escreve custa uma linha e nao
  -- mente para ninguem.
  normalizado  text NOT NULL,

  atualizado_em timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Um trecho por coisa indexada: reindexar o mesmo produto ATUALIZA, nao
-- acumula. Sem isto, renomear um produto deixaria o nome antigo respondendo
-- para sempre.
CREATE UNIQUE INDEX retrieval_chunks_por_origem
  ON retrieval_chunks (company_id, kind, ref_id)
  WHERE ref_id IS NOT NULL;

-- Comeca por `company_id`, como toda tabela de negocio: o `btree_gin` deixa a
-- coluna comum conviver com o operador de trigrama no mesmo indice. Assim o
-- proprio indice ja estreita por empresa, em vez de varrer os trigramas de
-- todas e deixar a RLS descartar depois.
CREATE INDEX retrieval_chunks_busca
  ON retrieval_chunks USING gin (company_id, normalizado gin_trgm_ops);

COMMENT ON TABLE retrieval_chunks IS
  'Trechos para desambiguacao (RF-102, ADR-0017). NAO e fonte de numero: sugere qual id passar a tool, nunca o valor.';

SELECT enable_tenant_isolation('retrieval_chunks');
