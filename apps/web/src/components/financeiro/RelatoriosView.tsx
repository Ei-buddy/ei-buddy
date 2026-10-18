'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  carregarFaturamento,
  carregarRankingDeClientes,
  carregarRankingDeProdutos,
  type Faturamento,
  type RankingDeClientes,
  type RankingDeProdutos,
} from '@/lib/relatorios-api'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Field, Input, PageHeader } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './relatorios.module.css'

/**
 * Faturamento mes a mes e rankings — NR-077, US-041.
 *
 * A tela nao soma nada. Todo numero daqui chega pronto da api, inclusive o
 * ticket medio e os meses zerados: sao os mesmos numeros que o assistente vai
 * responder (RF-108), e uma segunda aritmetica no navegador seria uma segunda
 * resposta para "quanto entrou em marco".
 *
 * ## As tres perguntas numa tela so
 *
 * Faturamento, ranking de clientes e ranking de produtos compartilham o
 * periodo. Separa-las em tres telas obrigaria a escolher o mesmo intervalo tres
 * vezes para comparar — e comparar e o motivo de olhar para elas.
 */

const emReais = (centavos: number) => centavos / 100

/** Quantos meses a tela mostra por padrao. */
const MESES_PADRAO = 12

const NOME_DO_MES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

/** '2026-03' vira 'mar/26'. Sem `Date`: aqui nao existe instante nenhum. */
function rotuloDoMes(month: string): string {
  const [ano, mes] = month.split('-')
  const indice = Number(mes) - 1
  return `${NOME_DO_MES[indice] ?? mes}/${(ano ?? '').slice(2)}`
}

/** Os ultimos `MESES_PADRAO` meses, terminando no ultimo dia do mes de `hoje`. */
function periodoPadrao(hoje: Date): { from: string; to: string } {
  const dois = (n: number) => String(n).padStart(2, '0')

  /* Campos LOCAIS de proposito: o periodo que o lojista ve e o do relogio
     dele. `toISOString` recuaria um dia em fuso negativo e o mes comecaria no
     dia 31 anterior. */
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()

  const inicio = new Date(ano, mes - (MESES_PADRAO - 1), 1)
  const ultimoDia = new Date(ano, mes + 1, 0).getDate()

  return {
    from: `${inicio.getFullYear()}-${dois(inicio.getMonth() + 1)}-01`,
    to: `${ano}-${dois(mes + 1)}-${dois(ultimoDia)}`,
  }
}

type Relatorios = {
  faturamento: Faturamento
  clientes: RankingDeClientes
  produtos: RankingDeProdutos
}

export default function RelatoriosView() {
  const inicial = periodoPadrao(new Date())

  const [de, setDe] = useState(inicial.from)
  const [ate, setAte] = useState(inicial.to)
  const [dados, setDados] = useState<Relatorios | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(async (from: string, to: string) => {
    /*
     * As tres em paralelo, e nao em sequencia: sao leituras independentes do
     * mesmo periodo, e encadea-las triplicaria a espera sem nenhum ganho.
     */
    const [f, c, p] = await Promise.all([
      carregarFaturamento(from, to),
      carregarRankingDeClientes(from, to),
      carregarRankingDeProdutos(from, to),
    ])

    setCarregando(false)

    /*
     * Uma que falhe derruba a tela inteira. Mostrar duas listas e um espaco
     * vazio faria o lojista comparar um ranking com um faturamento que nao
     * carregou, e concluir que os numeros nao batem.
     */
    if (!f.ok) {
      setErro(f.erro)
      return
    }
    if (!c.ok) {
      setErro(c.erro)
      return
    }
    if (!p.ok) {
      setErro(p.erro)
      return
    }

    setErro(null)
    setDados({ faturamento: f.dados, clientes: c.dados, produtos: p.dados })
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` de `buscar` vem todos depois do await,
       nunca sincronos no corpo do efeito. */
    void (async () => {
      await buscar(inicial.from, inicial.to)
    })()
    /* So na montagem — trocar o periodo e um clique em "Ver". Um efeito sobre
       `de`/`ate` dispararia tres consultas a cada tecla digitada na data. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aplicarPeriodo = () => {
    setCarregando(true)
    setErro(null)
    void buscar(de, ate)
  }

  const periodoInvalido = de === '' || ate === '' || de > ate

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Faturamento mês a mês, e quem é o que puxou esse dinheiro"
        actions={<BotoesExportar lista="faturamento" filtros={{ from: de, to: ate }} />}
      />

      <Card>
        <div className={styles.periodo}>
          <Field label="De">
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Field>
          <Button onClick={aplicarPeriodo} disabled={periodoInvalido || carregando}>
            Ver
          </Button>
        </div>

        {periodoInvalido && de !== '' && ate !== '' ? (
          <p className={styles.aviso}>O início do período não pode ser depois do fim.</p>
        ) : null}

        {carregando ? (
          <SkeletonLinhas />
        ) : erro !== null ? (
          <EmptyState
            title="Não deu para montar os relatórios"
            description={erro}
            action={
              <Button variant="secondary" onClick={aplicarPeriodo}>
                Tentar de novo
              </Button>
            }
          />
        ) : dados === null ? null : (
          <>
            <Faturamento dados={dados.faturamento} />
            <Clientes dados={dados.clientes} />
            <Produtos dados={dados.produtos} />
          </>
        )}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Faturamento mes a mes.
 *
 * A barra e DECORACAO: quem carrega o dado e a tabela, com o valor escrito por
 * extenso em cada linha. Um grafico que so existe como largura de div nao se
 * le com leitor de tela nem sobrevive a impressao.
 */
function Faturamento({ dados }: { dados: Faturamento }) {
  const maior = Math.max(...dados.months.map((m) => m.netCents), 0)
  const totalBruto = dados.months.reduce((acc, m) => acc + m.grossCents, 0)

  return (
    <section className={styles.bloco}>
      <header className={styles.blocoCabecalho}>
        <h2 className={styles.blocoTitulo}>Faturamento mês a mês</h2>
        <span className={styles.blocoTotal}>
          Bruto: <strong>{formatMoney(emReais(totalBruto))}</strong> · Líquido:{' '}
          <strong>{formatMoney(emReais(dados.totalNetCents))}</strong>
        </span>
      </header>
      {/* Os dois, e cada um dizendo o que e: bruto sozinho parece dinheiro no
          caixa, liquido sozinho parece venda que sumiu. */}
      <p className={styles.legenda}>
        Bruto é o valor das vendas antes do desconto. Líquido é o que sobra depois do desconto, do
        imposto e da taxa de cartão.
      </p>

      <table className={styles.meses}>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">Vendas</th>
            {/* Sobre o liquido, como a coluna ao lado; o do historico de vendas
                e sobre o bruto. O rotulo diz qual e qual (DEC-024). */}
            <th scope="col">Ticket médio (líquido)</th>
            <th scope="col">Bruto</th>
            <th scope="col">Líquido</th>
          </tr>
        </thead>
        <tbody>
          {dados.months.map((m) => (
            <tr key={m.month} className={m.salesCount === 0 ? styles.mesParado : undefined}>
              <th scope="row">{rotuloDoMes(m.month)}</th>
              <td>{m.salesCount}</td>
              <td>
                {/*
                 * Nulo, e nao zero: "ticket medio R$ 0,00" diria que houve
                 * venda de valor nenhum. O travessao diz que nao houve venda.
                 */}
                {m.averageTicketCents === null ? '—' : formatMoney(emReais(m.averageTicketCents))}
              </td>
              <td className={styles.valor}>{formatMoney(emReais(m.grossCents))}</td>
              <td className={styles.valor}>
                <span className={styles.barraCaixa} aria-hidden="true">
                  <span
                    className={styles.barra}
                    style={{ width: maior === 0 ? '0%' : `${(m.netCents / maior) * 100}%` }}
                  />
                </span>
                {formatMoney(emReais(m.netCents))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/**
 * O que ficou de fora do ranking, dito em voz alta.
 *
 * Sem esta linha, o lojista soma as posicoes, compara com o faturamento e
 * conclui que um dos dois relatorios esta errado. Com ela, ele descobre quanto
 * do faturamento passou pelo balcao sem identificacao — que e uma informacao
 * de negocio, e nao um rodape tecnico.
 */
function Sobra({ rotulo, cents }: { rotulo: string; cents: number }) {
  if (cents === 0) return null

  return (
    <p className={styles.sobra}>
      {rotulo}: <strong>{formatMoney(emReais(cents))}</strong>
    </p>
  )
}

function Clientes({ dados }: { dados: RankingDeClientes }) {
  return (
    <section className={styles.bloco}>
      <div className={styles.blocoCabecalho}>
        <h2 className={styles.blocoTitulo}>Clientes que mais compraram</h2>
        <span className={styles.blocoAcoes}>
          <BotoesExportar lista="ranking-clientes" filtros={{ from: dados.from, to: dados.to }} />
        </span>
      </div>

      {dados.customers.length === 0 ? (
        <p className={styles.aviso}>Nenhuma venda com cliente identificado neste período.</p>
      ) : (
        <ol className={styles.ranking}>
          {dados.customers.map((c, i) => (
            <li key={c.customerId} className={styles.posicao}>
              <span className={styles.lugar}>{i + 1}</span>
              <span className={styles.nome}>{c.customerName}</span>
              <span className={styles.detalhe}>
                {c.salesCount} {c.salesCount === 1 ? 'compra' : 'compras'} · última em{' '}
                {formatarDia(c.lastSaleOn)}
              </span>
              <span className={styles.valor}>{formatMoney(emReais(c.netCents))}</span>
            </li>
          ))}
        </ol>
      )}

      <Sobra rotulo="Venda de balcão, sem cliente identificado" cents={dados.unidentifiedCents} />
    </section>
  )
}

function Produtos({ dados }: { dados: RankingDeProdutos }) {
  return (
    <section className={styles.bloco}>
      <div className={styles.blocoCabecalho}>
        <h2 className={styles.blocoTitulo}>Produtos mais vendidos</h2>
        <span className={styles.blocoAcoes}>
          <BotoesExportar lista="ranking-produtos" filtros={{ from: dados.from, to: dados.to }} />
        </span>
      </div>

      {dados.products.length === 0 ? (
        <p className={styles.aviso}>Nenhum produto do cadastro foi vendido neste período.</p>
      ) : (
        <ol className={styles.ranking}>
          {dados.products.map((p, i) => (
            <li key={p.productId} className={styles.posicao}>
              <span className={styles.lugar}>{i + 1}</span>
              <span className={styles.nome}>{p.productName}</span>
              <span className={styles.detalhe}>
                {p.quantity} {p.quantity === 1 ? 'unidade' : 'unidades'}
              </span>
              <span className={styles.valor}>{formatMoney(emReais(p.netCents))}</span>
            </li>
          ))}
        </ol>
      )}

      <Sobra rotulo="Venda avulsa, sem produto no cadastro" cents={dados.unlinkedCents} />
    </section>
  )
}

/** 'AAAA-MM-DD' vira 'DD/MM'. Recortando o texto, sem `Date` no meio. */
function formatarDia(dia: string): string {
  const [, mes, d] = dia.split('-')
  return `${d}/${mes}`
}
