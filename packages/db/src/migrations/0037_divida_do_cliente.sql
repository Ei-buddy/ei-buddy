-- O recebivel diz se e divida do CLIENTE — RF-013, RF-066, RF-067.
--
-- ## O que estava errado
--
-- `mexeNoSaldoDoCliente` (core) decide se a baixa de um titulo abate o fiado.
-- Ela precisa da forma de pagamento, e `receivables` nao a guarda — entao o
-- repositorio derivava:
--
--     (SELECT MIN(p.method) FROM payments p WHERE p.sale_id = r.sale_id)
--
-- O comentario que justificava o `MIN` dizia: "na pratica so o parcelado gera
-- recebivel, e ele e de uma forma so". Nao e verdade. Uma venda paga metade em
-- dinheiro e metade no fiado gera DOIS recebiveis, e `MIN('cash','wallet')` e
-- `'cash'` — entao o "Fiado" daquela venda era lido como recebimento em
-- dinheiro, e pagar esse fiado NAO abatia o que o cliente devia.
--
-- Pagar metade agora e ficar devendo o resto e o caso mais comum do balcao.
--
-- ## Por que uma coluna, e nao consertar o `MIN`
--
-- Nao ha `MIN` que acerte: o recebivel nao tem como saber de qual dos
-- pagamentos ele nasceu, porque nao ha vinculo entre os dois. Derivar de novo
-- so trocaria um chute por outro.
--
-- A coluna guarda a RESPOSTA, nao a forma de pagamento — o comentario antigo
-- estava certo ao dizer que copiar `method` criaria duas versoes da mesma
-- verdade. "Esta divida e do cliente" e um fato do recebivel, decidido por
-- `core` no momento em que ele nasce, e nao um dado do pagamento.

ALTER TABLE receivables
  ADD COLUMN is_customer_debt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN receivables.is_customer_debt IS
  'Esta divida e do cliente (fiado ou cobranca nominal), e nao da adquirente. Decidido por core no nascimento — RF-013.';

-- ---------------------------------------------------------------------------
-- Backfill: o que o dado antigo permite dizer
-- ---------------------------------------------------------------------------
--
-- Recebivel de venda: so a DESCRICAO sobrou como sinal. `register-sale` grava
-- 'Fiado' para carteira e 'Recebimento em <forma>' para o resto — e e por essa
-- mesma descricao que o cancelamento de venda ja procurava o fiado hoje
-- (`sale-cancellation.ts`). Nao e bonito depender de texto; e o que existe,
-- e vale mais que deixar todo historico marcado como falso.
--
-- Recebivel avulso (sem venda) com cliente: e cobranca nominal, e o comentario
-- de `mexeNoSaldoDoCliente` ja dizia que conta.

UPDATE receivables
   SET is_customer_debt = true
 WHERE customer_id IS NOT NULL
   AND (description = 'Fiado' OR sale_id IS NULL);

-- ---------------------------------------------------------------------------
-- E o saldo devedor, que nunca foi somado
-- ---------------------------------------------------------------------------
--
-- `wallet_balance_cents` so era DECREMENTADO: na baixa, no estorno de venda e
-- na devolucao. Nada o incrementava quando a divida nascia — nem a venda no
-- fiado, nem a cobranca avulsa.
--
-- O efeito visivel: o filtro "Fiado" da lista de clientes usa
-- `wallet_balance_cents > 0` e nunca casava com ninguem; a consulta "quanto o
-- fulano me deve" respondia zero para quem devia; e cancelar uma venda no
-- fiado levava o saldo a NEGATIVO — o cliente aparecia com credito na loja que
-- ninguem lhe deu.
--
-- Recalcula do zero a partir dos titulos em aberto. Nao ha o que preservar do
-- valor antigo: ele e a soma de subtracoes sem as somas correspondentes.

UPDATE customers c
   SET wallet_balance_cents = COALESCE((
         SELECT SUM(r.amount_cents - r.settled_amount_cents)
           FROM receivables r
          WHERE r.customer_id = c.id
            AND r.is_customer_debt
            AND r.status IN ('open', 'partially_settled')
       ), 0);
