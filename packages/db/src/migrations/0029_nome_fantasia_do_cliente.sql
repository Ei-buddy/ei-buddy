-- Nome fantasia do cliente pessoa juridica — RF-009, NR-072.
--
-- ## Por que uma coluna, e nao reaproveitar `name`
--
-- `customers.name` guarda a RAZAO SOCIAL quando o cliente e PJ — e e ela que
-- tem de sair na nota. O nome fantasia e outro dado: e como a loja conhece
-- aquele cliente, e e por ele que o lojista procura no balcao ("a padaria do
-- Ze", nao "ZE SILVA COMERCIO DE ALIMENTOS LTDA").
--
-- Guardar os dois no mesmo campo obrigaria a escolher qual deles a nota leva,
-- e a escolha errada e uma nota rejeitada.
--
-- ## Nulo aqui, obrigatorio la
--
-- A coluna aceita nulo porque a maioria dos clientes e pessoa FISICA, e
-- pessoa fisica nao tem nome fantasia. A obrigatoriedade e condicional — "PJ
-- precisa ter" — e isso e regra de contrato, nao de coluna: um CHECK aqui
-- precisaria reimplementar "este documento e um CNPJ", que ja existe em
-- `tipoDePessoa`, e as duas implementacoes divergiriam na primeira mudanca.

ALTER TABLE customers ADD COLUMN trade_name text;

COMMENT ON COLUMN customers.trade_name IS
  'Nome fantasia. Obrigatorio para PJ (validado em contracts); nulo para pessoa fisica.';
