-- Focus NFe como revenda — NR-183.
--
-- A EiBuddy cadastra a empresa da loja na Focus pela API de empresas (token da
-- REVENDA), e a Focus devolve dois tokens da empresa: um de producao e um de
-- homologacao. Antes, o lojista colava o proprio token e cadastrava certificado
-- e CSC direto no painel da Focus; o certificado enviado aqui ficava guardado e
-- nunca saia.
--
-- ## Por que dois tokens
--
-- A Focus emite com tokens diferentes em cada ambiente. Guardar so o do
-- ambiente atual obrigaria a recadastrar a empresa na troca de homologacao para
-- producao. `focus_token` continua sendo o de PRODUCAO, como sempre foi.
--
-- ## CSC
--
-- O Codigo de Seguranca do Contribuinte e gerado pela loja no site da SEFAZ, um
-- par (id + codigo) por ambiente. O CODIGO e segredo — com ele se assina o QR
-- Code da NFC-e — e vai cifrado como o token. O ID nao e segredo: e so o numero
-- de ordem do CSC, e fica em claro.

ALTER TABLE company_fiscal_credentials
  ADD COLUMN focus_token_homologacao text,
  ADD COLUMN csc_producao            text,
  ADD COLUMN csc_id_producao         text
    CHECK (csc_id_producao IS NULL OR csc_id_producao ~ '^[0-9]{1,6}$'),
  ADD COLUMN csc_homologacao         text,
  ADD COLUMN csc_id_homologacao      text
    CHECK (csc_id_homologacao IS NULL OR csc_id_homologacao ~ '^[0-9]{1,6}$'),
  -- O id da empresa na Focus. Com ele, salvar de novo ATUALIZA em vez de
  -- tentar criar outra (a Focus recusa CNPJ repetido na mesma revenda).
  ADD COLUMN focus_company_id        text,
  -- Ultima sincronizacao com a Focus: quando deu certo, ou o que a Focus disse
  -- quando nao deu. A tela mostra os dois; sem isto, "salvei e nao emite" nao
  -- teria explicacao.
  ADD COLUMN focus_synced_at         timestamptz,
  ADD COLUMN focus_sync_error        text
    CHECK (focus_sync_error IS NULL OR char_length(focus_sync_error) <= 500);

-- CSC sem id nao serve, e id sem CSC nao assina nada.
ALTER TABLE company_fiscal_credentials
  ADD CONSTRAINT fiscal_csc_producao_completo
    CHECK (num_nonnulls(csc_producao, csc_id_producao) IN (0, 2)),
  ADD CONSTRAINT fiscal_csc_homologacao_completo
    CHECK (num_nonnulls(csc_homologacao, csc_id_homologacao) IN (0, 2));
