import { gravarTrilha } from './audit-repository.js'
import type { SettlementOutput } from '@na-regua/contracts'
import type {
  NewSettlement,
  SettlementQueries,
  SettlementTransaction,
  SettlementUnitOfWork,
  TituloSnapshot,
} from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Baixa e estorno de titulo no banco — NR-029, RF-063 a RF-067.
 *
 * `core` tinha `settlePayable`, `settleReceivable` e `reverseSettlement` desde
 * a NR-029, com teste contra falso. Faltava quem gravasse — e sem isso nenhuma
 * rota podia expo-los: pagar uma conta, a operacao mais diaria do financeiro,
 * existia no repositorio e nao no produto.
 *
 * ## Duas tabelas, uma porta
 *
 * A baixa de RECEBIVEL e a de PAGAVEL vao para a mesma `settlements`, com
 * `receivable_id` XOR `payable_id` (db_0909 / NR-092). As colunas que so um
 * dos lados usa (`method`, `bank_account`) ficam nulas no outro.
 *
 * A porta e uma so porque a REGRA e uma so — parcial vira
 * `partially_settled`, completa vira `settled`, estorno e uma linha negativa —
 * e essa regra vive em `core`. Aqui embaixo cada uma vai para o seu lugar.
 */

const numero = (v: unknown): number => Number(v)

type LinhaTitulo = {
  id: string
  amount_cents: string | number
  settled_amount_cents: string | number
  status: string
  customer_id: string | null
  is_customer_debt: boolean
}

const paraSnapshot = (l: LinhaTitulo): TituloSnapshot => ({
  id: l.id,
  amountCents: numero(l.amount_cents),
  settledAmountCents: numero(l.settled_amount_cents),
  status: l.status,
  customerId: l.customer_id,
  isCustomerDebt: l.is_customer_debt,
})

type LinhaBaixa = {
  id: string
  payable_id?: string | null
  receivable_id?: string | null
  amount_cents: string | number
  method?: string | null
  bank_account?: string | null
  settled_on?: string | Date | null
  settled_at?: Date | null
  notes: string | null
  reverses_id: string | null
  created_at: Date
  created_by: string | null
}

/**
 * `settled_on` sai como TEXTO, e nunca de um `Date`.
 *
 * O driver devolve `date` como meia-noite UTC, e ler os campos locais desse
 * `Date` em maquina no fuso de Sao Paulo recua um dia — foi assim que todo
 * vencimento apareceu um dia antes. Onde a coluna e `timestamptz`
 * (`settlements.settled_at`), o recorte do ISO ja da o dia em UTC, que e o
 * mesmo instante gravado.
 */
function diaDaBaixa(l: LinhaBaixa): string {
  if (typeof l.settled_on === 'string') return l.settled_on.slice(0, 10)
  if (l.settled_on instanceof Date) return l.settled_on.toISOString().slice(0, 10)
  return (l.settled_at ?? l.created_at).toISOString().slice(0, 10)
}

const paraBaixa = (l: LinhaBaixa): SettlementOutput => ({
  id: l.id,
  payableId: l.payable_id ?? null,
  receivableId: l.receivable_id ?? null,
  amountCents: numero(l.amount_cents),
  method: (l.method ?? null) as SettlementOutput['method'],
  bankAccount: l.bank_account ?? null,
  settledOn: diaDaBaixa(l),
  notes: l.notes,
  reversesId: l.reverses_id,
  createdAt: l.created_at.toISOString(),
  createdBy: l.created_by,
})

function escopo(tx: TransactionSql, companyId: string): SettlementTransaction {
  return {
    /*
     * A trilha entra NA transacao — NR-087.
     *
     * O INSERT mora em `gravarTrilha`, e nao aqui: duas copias dele
     * divergiriam no primeiro campo novo, e a errada seria a que ninguem le.
     * Fora da transacao, a entrada sobreviveria ao rollback e a trilha passaria
     * a registrar o que nao aconteceu — ver `TransactionalAuditTrail`.
     */
    record: (entrada) => gravarTrilha(tx, entrada),
    /**
     * O titulo a pagar, DENTRO da transacao.
     *
     * Ler aqui e nao fora: entre ler o saldo e grava-lo cabe outra baixa, e o
     * caso de uso decide "parcial ou completa" com base neste numero. Ler antes
     * da transacao decidiria sobre um saldo que ja mudou.
     *
     * `is_customer_debt` volta falso porque `payables` nao tem a coluna: quem paga
     * um fornecedor informa a CONTA de onde saiu, e nao a forma. A porta declara
     * o campo por causa do recebivel, e aqui a resposta honesta e nula. Como
     * `customer_id` tambem e nulo, `mexeNoSaldoDoCliente` responde nao — que e
     * o certo: conta a pagar nao mexe em fiado de cliente nenhum.
     *
     * Sem filtro de `deleted_at`: a tabela nao tem a coluna, de proposito.
     * "Nada e apagado: conta e cancelada" (RNF-040, 0010). Quem cancelou vira
     * `status = 'cancelled'`, e recusar a baixa de conta cancelada e regra de
     * `core` — nao um sumico silencioso aqui embaixo.
     */
    findPayable: async (_companyId, id) => {
      const [linha] = await tx<LinhaTitulo[]>`
        SELECT id, amount_cents, settled_amount_cents, status,
               NULL::uuid AS customer_id, false AS is_customer_debt
        FROM payables
        WHERE id = ${id}
      `
      return linha === undefined ? undefined : paraSnapshot(linha)
    },

    /**
     * O recebivel, e se a divida dele e do cliente.
     *
     * `is_customer_debt` e lido, e nao mais deduzido.
     *
     * Ate a migration 0037 a forma de pagamento saia de
     * `MIN(p.method) FROM payments WHERE sale_id = r.sale_id`, e o comentario
     * que justificava o `MIN` dizia: "na pratica so o parcelado gera recebivel,
     * e ele e de uma forma so". Nao e verdade — uma venda paga metade em
     * dinheiro e metade no fiado gera dois recebiveis, e `MIN('cash','wallet')`
     * e `'cash'`. O "Fiado" daquela venda era lido como recebimento em
     * dinheiro, e paga-lo nao abatia o que o cliente devia.
     *
     * Nao ha `MIN` que acerte: o recebivel nao sabe de qual pagamento nasceu.
     * Quem decide agora e `core`, uma vez, quando o titulo nasce.
     */
    findReceivable: async (_companyId, id) => {
      const [linha] = await tx<LinhaTitulo[]>`
        SELECT r.id, r.amount_cents, r.settled_amount_cents, r.status, r.customer_id,
               r.is_customer_debt
        FROM receivables r
        WHERE r.id = ${id}
      `
      return linha === undefined ? undefined : paraSnapshot(linha)
    },

    /**
     * Procura a baixa nas DUAS tabelas.
     *
     * Quem estorna tem um id de baixa na mao e nao sabe — nem precisa saber —
     * de qual tabela ele veio. Exigir o tipo junto empurraria para a tela uma
     * distincao que e detalhe de armazenamento.
     */
    findSettlement: async (_companyId, id) => {
      const [linha] = await tx<LinhaBaixa[]>`
        SELECT id, receivable_id, payable_id, amount_cents, method, bank_account,
               settled_on, settled_at, notes, reverses_id, created_at, created_by
        FROM settlements WHERE id = ${id}
      `
      return linha === undefined ? undefined : paraBaixa(linha)
    },

    /**
     * Ja existe estorno desta baixa? — RF-067.
     *
     * Sem isto, estornar duas vezes gravaria duas linhas negativas e o titulo
     * voltaria a dever mais do que devia. O indice unico do schema tambem
     * recusa, mas descobrir pela violacao de constraint daria ao lojista um
     * erro de banco no lugar de "esta baixa ja foi estornada".
     */
    hasReversal: async (_companyId, settlementId) => {
      const [linha] = await tx<{ existe: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM settlements WHERE reverses_id = ${settlementId}) AS existe
      `
      return linha?.existe === true
    },

    insertSettlement: async (baixa: NewSettlement) => {
      const [linha] = await tx<LinhaBaixa[]>`
        INSERT INTO settlements
          (company_id, receivable_id, payable_id, amount_cents, method, bank_account,
           settled_at, settled_on, notes, reverses_id, created_by, created_at)
        VALUES (${companyId}, ${baixa.receivableId}, ${baixa.payableId}, ${baixa.amountCents},
                ${baixa.method ?? (baixa.receivableId ? 'cash' : null)},
                ${baixa.bankAccount ?? (baixa.payableId ? 'nao informada' : null)},
                ${baixa.settledOn}, ${baixa.settledOn}, ${baixa.notes},
                ${baixa.reversesId}, ${baixa.createdBy}, ${baixa.createdAt})
        RETURNING id, receivable_id, payable_id, amount_cents, method, bank_account,
                  settled_on, settled_at, notes, reverses_id, created_at, created_by
      `
      if (linha === undefined) throw new Error('A baixa nao foi gravada.')
      return paraBaixa(linha)
    },

    /**
     * Grava o saldo e o status que passam a valer.
     *
     * Absolutos, e nao incrementos: quem decidiu os dois foi o caso de uso, com
     * o titulo lido DENTRO desta mesma transacao. Somar um delta aqui
     * reintroduziria a corrida que ler la dentro evitou.
     *
     * No recebivel, `settled_at` acompanha o status porque o schema EXIGE:
     * `CHECK ((settled_at IS NULL) = (status <> 'settled'))`.
     *
     * Nao e formalidade. O carimbo responde "quando este titulo foi quitado", e
     * um status `settled` sem data seria um recebivel liquidado que ninguem
     * sabe quando entrou — justamente o que se procura ao conferir o caixa. No
     * ESTORNO o caminho e o inverso: o status volta a `open` e a data tem de
     * voltar a ser nula, senao a constraint recusa. Foi ela que pegou isto.
     *
     * `payables` nao tem esse par: la o status basta.
     */
    updateTitulo: async (_companyId, tipo, id, settledAmountCents, status) => {
      const linhas =
        tipo === 'payable'
          ? await tx`
              UPDATE payables
                 SET settled_amount_cents = ${settledAmountCents},
                     status = ${status},
                     updated_at = now()
               WHERE id = ${id}
              RETURNING id
            `
          : await tx`
              UPDATE receivables
                 SET settled_amount_cents = ${settledAmountCents},
                     status = ${status},
                     settled_at = CASE WHEN ${status} = 'settled' THEN now() ELSE NULL END,
                     updated_at = now()
               WHERE id = ${id}
              RETURNING id
            `

      if (linhas.length === 0) {
        /* O caso de uso ja conferiu que existe, e estamos na mesma transacao.
           Chegar aqui e o titulo ter sumido no meio — falhar alto e melhor que
           gravar a baixa sem o titulo correspondente. */
        throw new Error(`Titulo ${id} desapareceu no meio da baixa.`)
      }
    },

    /**
     * Mexe no fiado do cliente — RF-013.
     *
     * Incremento, e nao valor absoluto: aqui o caso de uso sabe QUANTO mudou
     * (o valor da baixa) e nao qual o saldo final. Ler o saldo para somar em
     * JavaScript abriria a corrida que o `+ delta` no proprio UPDATE evita.
     */
    adjustCustomerBalance: async (_companyId, customerId, deltaCents) => {
      await tx`
        UPDATE customers
           SET wallet_balance_cents = wallet_balance_cents + ${deltaCents},
               updated_at = now()
         WHERE id = ${customerId}
      `
    },
  }
}

/**
 * As baixas de um titulo — RF-067.
 *
 * ## Por que nao entrou em `SettlementTransaction`
 *
 * Aquela porta e a da ESCRITA, e cada metodo dela roda dentro da transacao que
 * o caso de uso abriu. Esta consulta e o passo ANTERIOR: a tela lista as baixas
 * para a pessoa escolher qual estornar, e so entao o estorno abre a sua
 * transacao. Enfia-la la obrigaria a abrir uma transacao de escrita para ler.
 *
 * `withTenant` mesmo assim: e ele quem define `app.company_id`, e sem isso o
 * RLS recusa a leitura — nao devolve lista vazia, recusa. Por isso a consulta
 * nao filtra `company_id` na clausula: a politica ja filtra, e repetir aqui
 * daria a impressao de que ela e opcional.
 *
 * ## Da mais recente para a mais antiga
 *
 * A pergunta que traz alguem a esta lista e "a ultima baixa foi errada, como
 * desfaço". A primeira linha e a resposta.
 *
 * `created_at` como desempate, e nao so a data da baixa: duas baixas no mesmo
 * dia sao comuns (a parcial de manha e o resto a tarde), e a ordem entre elas
 * so existe no carimbo de gravacao. Sem o desempate, a lista trocaria de ordem
 * entre dois carregamentos iguais.
 */
export function createSettlementQueries(sql: Sql): SettlementQueries {
  return {
    listByTitulo: (companyId, tipo, tituloId) =>
      withTenant(sql, companyId, async (tx) => {
        const linhas =
          tipo === 'payable'
            ? await tx<LinhaBaixa[]>`
                SELECT id, payable_id, amount_cents, bank_account, settled_on, settled_at, notes,
                       reverses_id, created_at, created_by
                  FROM settlements
                 WHERE payable_id = ${tituloId}
                 ORDER BY COALESCE(settled_on, settled_at::date) DESC, created_at DESC
              `
            : await tx<LinhaBaixa[]>`
                SELECT id, receivable_id, amount_cents, method, settled_at, notes,
                       reverses_id, created_at, created_by
                  FROM settlements
                 WHERE receivable_id = ${tituloId}
                 ORDER BY settled_at DESC, created_at DESC
              `

        return linhas.map(paraBaixa)
      }),
  }
}

export function createSettlementUnitOfWork(sql: Sql): SettlementUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx, companyId))),
  }
}
