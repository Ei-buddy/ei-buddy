import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { ButtonLink } from '@/components/ui/Button'
import { IconArrowRight, IconPlus } from '@/components/Icons'
import { carregarPainel, type DiaDoGrafico } from '@/lib/painel-server'
import { describeDueDate, formaPagamentoLabel, formatMoney } from '@/lib/format'
import ChecklistInicial from '@/components/app/ChecklistInicial'
import MetaDiaria from '@/components/app/MetaDiaria'
import styles from './painel.module.css'

export const metadata: Metadata = {
  title: `Visão geral — ${BRAND}`,
}

/**
 * Visao geral — NR-013, US-059.
 *
 * ## Era um mockup
 *
 * A tela somava `lib/mock-data` e filtrava por `'2026-08-24'` escrito aqui.
 * "Bom dia, Marina" com o nome de ninguem, a data de agosto para sempre, sete
 * barras de altura inventada e um ticket medio com "+4% vs. ontem" digitado a
 * mao. Era a PRIMEIRA tela depois do login.
 *
 * ## Sem cache
 *
 * `dynamic` porque a tela le a sessao pelo cookie e mostra o dia de hoje.
 * Cacheada, o segundo lojista veria os numeros do primeiro — e o mesmo painel
 * apareceria amanha dizendo que e hoje.
 */
export const dynamic = 'force-dynamic'

const emReais = (centavos: number) => centavos / 100

/** O que uma leitura que falhou mostra no lugar do bloco. */
function NaoCarregou({ oque }: { oque: string }) {
  return (
    <EmptyState
      title={`Não deu para carregar ${oque}`}
      description="Atualize a página. Se continuar, os outros blocos seguem valendo."
    />
  )
}

export default async function VisaoGeralPage() {
  const painel = await carregarPainel()

  return (
    <>
      <PageHeader
        title={
          painel.saudacao.nome === null
            ? painel.saudacao.texto
            : `${painel.saudacao.texto}, ${painel.saudacao.nome}`
        }
        subtitle={painel.data}
        actions={
          <ButtonLink href="/app/vendas/nova" data-tutorial="dashboard-nova-venda">
            <IconPlus size={17} />
            Nova venda
          </ButtonLink>
        }
      />

      <ChecklistInicial
        totalProdutos={painel.totalProdutos}
        totalClientes={painel.totalClientes}
        temVenda={painel.ultimasVendas !== null && painel.ultimasVendas.length > 0}
      />

      <div className={styles.stats} data-tutorial="dashboard-stats">
        {/*
          Um traco quando a leitura falhou, e nao "R$ 0,00": zero e uma
          resposta — o dia sem vendas — e uma rede que caiu nao e.
        */}
        <Stat
          label="Faturamento hoje"
          value={painel.hoje === null ? '—' : formatMoney(emReais(painel.hoje.grossCents))}
          hint={painel.hoje === null ? 'não carregou' : `${painel.hoje.salesCount} vendas`}
          tone={painel.hoje !== null && painel.hoje.grossCents > 0 ? 'positive' : undefined}
        />
        {/*
          Tres estados, e nao dois. O valor e um traco nos dois primeiros, mas o
          RODAPE precisa distinguir:

          - a leitura falhou -> "nao carregou"
          - leu, e nao houve venda -> "sem vendas hoje"
          - leu, e houve -> "por venda"

          A primeira versao daqui usava `painel.hoje?.averageTicketCents == null`
          para os dois primeiros casos e escrevia "sem vendas hoje" quando a api
          nao respondia — a queda de rede aparecia como um dia sem movimento, que
          e exatamente a confusao que o `null` do modulo existe para evitar.
          Apareceu ao abrir a tela com a api fora do ar.
        */}
        <Stat
          label="Ticket médio"
          value={
            painel.hoje?.averageTicketCents == null
              ? '—'
              : formatMoney(emReais(painel.hoje.averageTicketCents))
          }
          hint={
            painel.hoje === null
              ? 'não carregou'
              : painel.hoje.averageTicketCents === null
                ? 'sem vendas hoje'
                : 'por venda'
          }
        />
        <Stat
          label="A receber"
          value={painel.aReceber === null ? '—' : formatMoney(emReais(painel.aReceber.totalCents))}
          hint="em aberto"
        />
        <Stat
          label="A pagar"
          value={painel.aPagar === null ? '—' : formatMoney(emReais(painel.aPagar.totalCents))}
          hint={
            painel.aPagar === null
              ? 'não carregou'
              : painel.aPagar.vencidas === 0
                ? 'nada vencido'
                : `${painel.aPagar.vencidas} ${painel.aPagar.vencidas === 1 ? 'título vencido' : 'títulos vencidos'}`
          }
          tone={painel.aPagar !== null && painel.aPagar.vencidas > 0 ? 'warning' : undefined}
        />
      </div>

      <MetaDiaria faturamentoHojeCents={painel.hoje === null ? null : painel.hoje.grossCents} />

      <div className={styles.grid}>
        <Card
          title="Vendas na semana"
          className={styles.wide}
          action={
            <ButtonLink href="/app/vendas" variant="ghost" size="sm">
              Ver todas
              <IconArrowRight size={15} />
            </ButtonLink>
          }
        >
          {painel.semana === null ? (
            <NaoCarregou oque="o gráfico da semana" />
          ) : (
            <Grafico dias={painel.semana} />
          )}

          <h3 className={styles.subTitle}>Últimas vendas</h3>
          {painel.ultimasVendas === null ? (
            <NaoCarregou oque="as últimas vendas" />
          ) : painel.ultimasVendas.length === 0 ? (
            <EmptyState
              title="Nenhuma venda ainda"
              description="A primeira venda aparece aqui assim que você fechar o caixa."
              mascote
            />
          ) : (
            <ul className={styles.rows}>
              {painel.ultimasVendas.map((venda) => (
                <li key={venda.id} className={styles.row}>
                  <span className={styles.rowId}>#{venda.number}</span>
                  <span className={styles.rowMain}>
                    <strong>{venda.customerName ?? 'Sem cliente'}</strong>
                    <span>
                      {venda.payments
                        .map((p) => formaPagamentoLabel[p.method] ?? p.method)
                        .join(', ')}
                    </span>
                  </span>
                  {venda.status === 'cancelled' ? <Badge tone="danger">Cancelada</Badge> : null}
                  <span className={styles.rowValue}>
                    {formatMoney(emReais(venda.grossAmountCents - venda.discountCents))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Próximos vencimentos"
          action={
            <ButtonLink href="/app/financeiro/contas-a-pagar" variant="ghost" size="sm">
              Ver todos
              <IconArrowRight size={15} />
            </ButtonLink>
          }
        >
          {painel.vencimentos === null ? (
            <NaoCarregou oque="os vencimentos" />
          ) : painel.vencimentos.length === 0 ? (
            <EmptyState title="Nada a pagar" description="Nenhuma conta em aberto por agora." />
          ) : (
            <ul className={styles.rows}>
              {painel.vencimentos.map((conta) => (
                <li key={conta.id} className={styles.row}>
                  <span className={styles.rowMain}>
                    <strong>{conta.supplier ?? conta.description}</strong>
                    <span>{describeDueDate(conta.dueDate)}</span>
                  </span>
                  <span className={styles.rowValue}>
                    {formatMoney(emReais(conta.amountCents - conta.settledAmountCents))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Precisa de reposição"
          action={
            <ButtonLink href="/app/produtos" variant="ghost" size="sm">
              Ver catálogo
              <IconArrowRight size={15} />
            </ButtonLink>
          }
        >
          {painel.reposicao === null ? (
            <NaoCarregou oque="o estoque baixo" />
          ) : painel.reposicao.length === 0 ? (
            <EmptyState title="Estoque em ordem" description="Nenhum produto abaixo do mínimo." />
          ) : (
            <ul className={styles.rows}>
              {painel.reposicao.map((produto) => (
                <li key={produto.id} className={styles.row}>
                  <span className={styles.rowMain}>
                    <strong>{produto.description}</strong>
                    <span>mínimo {produto.minStock} un</span>
                  </span>
                  <span className={`${styles.rowValue} ${styles.alert}`}>{produto.stock} un</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

/**
 * As barras da semana.
 *
 * A altura e relativa ao MAIOR dia do periodo, e nao a uma escala fixa: o que
 * se quer ver de relance e qual dia vendeu mais, e uma escala fixa faria a
 * semana inteira parecer rasteira numa loja pequena e estourar numa grande.
 *
 * Semana sem venda nenhuma nao divide por zero — todas as barras ficam no
 * chao, o que e a leitura correta.
 */
function Grafico({ dias }: { dias: readonly DiaDoGrafico[] }) {
  const maior = Math.max(...dias.map((d) => d.grossCents), 0)

  return (
    <div className={styles.chart}>
      {dias.map((d) => (
        <div key={d.dia} className={styles.chartCol}>
          <span
            className={styles.bar}
            style={{ height: maior === 0 ? '0%' : `${(d.grossCents / maior) * 100}%` }}
            /* O valor tambem em texto: barra sozinha nao e leitura acessivel,
               e o rotulo diz o numero para quem usa leitor de tela. */
            title={`${d.rotulo}: ${formatMoney(emReais(d.grossCents))} em ${d.salesCount} vendas`}
          />
          <span className={styles.chartDay}>{d.rotulo}</span>
        </div>
      ))}
    </div>
  )
}
