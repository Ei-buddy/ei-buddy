-- A auditoria precisa saber dizer "foi o sistema" — RNF-040, NR-044.
--
-- ## O defeito
--
-- `audit_logs.channel` aceitava so `'app'` e `'whatsapp'`. O tipo `Channel` em
-- `core` ja tinha quatro valores — `'app' | 'whatsapp' | 'api' | 'job'` —, e o
-- banco nunca acompanhou. Enquanto nenhum job escrevia dado de negocio, a
-- divergencia nao aparecia.
--
-- Apareceu na baixa por webhook: o cliente paga, o caso de uso registra a
-- baixa com `channel: 'job'`, o CHECK recusa, e a rota responde 500. Em
-- producao o Asaas reentregaria o aviso indefinidamente e nenhum titulo
-- baixaria — de novo, e desta vez com barulho em vez de silencio.
--
-- ## Por que NAO mentir no canal
--
-- A saida barata era mandar `'app'` no contexto do job. A tela de auditoria
-- passaria a dizer que uma baixa automatica veio do aplicativo, e quem
-- investigasse uma divergencia de caixa procuraria por uma pessoa que nunca
-- abriu a tela. Trilha que mente e pior que trilha que falta: a que falta
-- ninguem usa para concluir nada.
--
-- ## `api` entra junto
--
-- Pelo mesmo motivo de coerencia: os quatro valores do tipo passam a caber na
-- coluna. Deixar so `job` entrar resolveria o sintoma de hoje e deixaria a
-- mesma armadilha armada para o proximo.

-- O CHECK da 0007 e inline e sem nome, entao o Postgres batizou sozinho. O
-- nome automatico e `audit_logs_channel_check`, mas isso e convencao e nao
-- promessa: com uma segunda restricao na mesma coluna, viria com sufixo. Em
-- vez de apostar, este bloco acha a restricao pela DEFINICAO e derruba a que
-- existir — uma migration que falha por causa de um nome adivinhado trava o
-- deploy por nada.
DO $
DECLARE
  nome text;
BEGIN
  SELECT con.conname INTO nome
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'audit_logs'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%channel%';

  IF nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', nome);
  END IF;
END
$;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_channel_check
  CHECK (channel IN ('app', 'whatsapp', 'api', 'job'));

COMMENT ON COLUMN audit_logs.channel IS
  'De onde veio a acao. `job` e o sistema agindo sozinho (baixa por webhook, varredura) — ver ATOR_DO_SISTEMA em core.';
