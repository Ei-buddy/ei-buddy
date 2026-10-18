'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  carregarDre,
  type Dre,
  type LinhaDoDre,
  ROTULO_DO_TIPO,
  type TipoDeConta,
} from '@/lib/contabilidade-api'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Field, Input, PageHeader } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './dre.module.css'

/**
 * DRE simplificado — NR-077, RF-085, RF-086. US-041.
 *
 * A tela nao calcula nada. A ordem das subtracoes vem de `domain` e chega
 * pronta: e exatamente a parte que nao pode variar entre esta tela, o resumo do
 * assistente (RF-108) e a exportacao do contador (RF-087). Somar aqui daria uma
 * segunda resposta para "o mes fechou no azul".
 */

const emReais = (centavos: number) => centavos / 100

/** Primeiro e ultimo dia do mes de uma data, em AAAA-MM-DD. */
function mesDe(hoje: Date): { from: string; to: string } {
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()
  const dois = (n: number) => String(n).padStart(2, '0')

  /* `new Date(ano, mes + 1, 0)` e o ultimo dia do mes — inclusive em fevereiro
     bissexto, sem tabela de dias. Tudo em campos LOCAIS: `toISOString` aqui
     recuaria um dia em fuso negativo e o mes comecaria no dia 31 anterior. */
  const ultimo = new Date(ano, mes + 1, 0).getDate()

  return {
    from: `${ano}-${dois(mes + 1)}-01`,
    to: `${ano}-${dois(mes + 1)}-${dois(ultimo)}`,
  }
}

/** As linhas do resumo, na ordem em que o relatorio se le. */
type LinhaDeResumo = {
  rotulo: string
  valorCents: number
  /** Total que fecha um bloco — recebe destaque. */
  destaque?: boolean
  /** Subtrai do que veio antes: mostrada com sinal negativo. */
  subtrai?: boolean
}

function resumoDe(dre: Dre): LinhaDeResumo[] {
  return [
    { rotulo: 'Receita bruta', valorCents: dre.grossRevenueCents },
    { rotulo: 'Deduções', valorCents: dre.deductionsCents, subtrai: true },
    { rotulo: 'Receita líquida', valorCents: dre.netRevenueCents, destaque: true },
    { rotulo: 'Custo', valorCents: dre.costCents, subtrai: true },
    { rotulo: 'Lucro bruto', valorCents: dre.grossProfitCents, destaque: true },
    { rotulo: 'Despesas', valorCents: dre.expensesCents, subtrai: true },
    { rotulo: 'Resultado', valorCents: dre.resultCents, destaque: true },
  ]
}

export default function DreView() {
  const inicial = mesDe(new Date())

  const [de, setDe] = useState(inicial.from)
  const [ate, setAte] = useState(inicial.to)
  const [dre, setDre] = useState<Dre | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [detalhando, setDetalhando] = useState<TipoDeConta | null>(null)

  const buscar = useCallback(async (from: string, to: string) => {
    const r = await carregarDre(from, to)
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setDre(r.dados)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` de `buscar` vem todos depois do await,
       nunca sincronos no corpo do efeito. */
    void (async () => {
      await buscar(inicial.from, inicial.to)
    })()
    /* So na montagem. Trocar o periodo e um clique em "Ver", e nao um efeito
       sobre `de`/`ate` — senao cada tecla digitada na data dispararia uma
       consulta, e datas pela metade ("2026-1") viram pedido invalido. */
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
        title="DRE simplificado"
        subtitle="Receita, custo, despesa e resultado do período"
        actions={<BotoesExportar lista="dre" filtros={{ from: de, to: ate }} />}
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
            title="Não deu para montar o DRE"
            description={erro}
            action={
              <Button variant="secondary" onClick={aplicarPeriodo}>
                Tentar de novo
              </Button>
            }
          />
        ) : dre === null ? null : (
          <>
            {/*
             * Zeros EXPLICITOS quando nao houve movimento (US-041), e nao um
             * estado vazio. "Receita bruta R$ 0,00" responde a pergunta; "sem
             * dados" deixa o lojista sem saber se o mes foi ruim ou se a tela
             * quebrou.
             */}
            <table className={styles.resumo}>
              <tbody>
                {resumoDe(dre).map((l) => (
                  <tr key={l.rotulo} className={l.destaque ? styles.linhaTotal : undefined}>
                    <th scope="row">{l.rotulo}</th>
                    <td
                      className={
                        l.rotulo === 'Resultado' && dre.resultCents < 0
                          ? styles.negativo
                          : undefined
                      }
                    >
                      {/* So a linha que subtrai ganha o "−" fixo; nos totais o
                          sinal vem do valor, e prejuizo aparece negativo. */}
                      {l.subtrai
                        ? `${l.valorCents !== 0 ? '− ' : ''}${formatMoney(emReais(Math.abs(l.valorCents)))}`
                        : formatMoney(emReais(l.valorCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className={styles.margem}>
              {/* Nula quando nao houve receita: dividir por zero daria "Infinity%"
                  ou "NaN%", e o servidor devolve `null` justamente para a tela
                  poder dizer que a conta nao existe neste periodo. */}
              Margem bruta:{' '}
              <strong>
                {dre.grossMarginPoints === null
                  ? 'sem receita no período'
                  : `${dre.grossMarginPoints}%`}
              </strong>
            </p>

            <Detalhe
              linhas={dre.lines}
              aberto={detalhando}
              onAlternar={(t) => setDetalhando((atual) => (atual === t ? null : t))}
            />
          </>
        )}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

const ORDEM: readonly TipoDeConta[] = ['revenue', 'deduction', 'cost', 'expense']

/**
 * As contas que compoem cada bloco — RF-086.
 *
 * O servidor manda a CONTAGEM de lancamentos por conta, e nao os lancamentos.
 * Um mes movimentado tem milhares, e traze-los junto com o resumo carregaria o
 * detalhe que ninguem pediu ainda.
 */
function Detalhe({
  linhas,
  aberto,
  onAlternar,
}: {
  linhas: LinhaDoDre[]
  aberto: TipoDeConta | null
  onAlternar: (t: TipoDeConta) => void
}) {
  const comMovimento = ORDEM.filter((t) => linhas.some((l) => l.type === t))

  if (comMovimento.length === 0) {
    return <p className={styles.aviso}>Nenhum lançamento neste período.</p>
  }

  return (
    <div className={styles.detalhe}>
      {comMovimento.map((tipo) => {
        const doTipo = linhas.filter((l) => l.type === tipo)
        const expandido = aberto === tipo

        return (
          <div key={tipo} className={styles.grupo}>
            <button
              type="button"
              className={styles.grupoBotao}
              onClick={() => onAlternar(tipo)}
              aria-expanded={expandido}
            >
              <span>{ROTULO_DO_TIPO[tipo]}</span>
              <span className={styles.grupoContagem}>
                {doTipo.length} {doTipo.length === 1 ? 'conta' : 'contas'}
              </span>
            </button>

            {expandido ? (
              <ul className={styles.contas}>
                {doTipo.map((l) => (
                  <li key={l.accountId ?? `sem-conta-${l.type}`} className={styles.conta}>
                    <span className={l.accountId === null ? styles.semConta : undefined}>
                      {l.accountName}
                    </span>
                    <span className={styles.contaContagem}>
                      {l.entryCount} {l.entryCount === 1 ? 'lancamento' : 'lancamentos'}
                    </span>
                    <span className={styles.contaValor}>{formatMoney(emReais(l.amountCents))}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
