'use client'

import { useEffect, useState } from 'react'
import {
  carregarExtrato,
  type ContaBancaria,
  type ExtratoDaConta,
} from '@/lib/contas-bancarias-api'
import { formatDate, formatMoney, mesDeHoje } from '@/lib/format'
import { Card, EmptyState } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import styles from './financeiro.module.css'

/** `AAAA-MM` → primeiro e ultimo dia do mes. */
function periodoDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

function mesAoLado(mes: string, passo: number): string {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const reais = (cents: number) => formatMoney(cents / 100)

/**
 * O extrato de uma conta, mes a mes ou num intervalo de datas — achados do QA:
 * "Bancos: ter um extrato das movimentacoes"; "permitir visualizar o extrato
 * em um intervalo de datas".
 *
 * As linhas sao as baixas que citaram a conta (o mesmo calculo do saldo da
 * lista), com o saldo depois de cada uma. O saldo do comeco do mes ja traz o
 * inicial e tudo o que andou antes — e o numero que bate com o extrato do
 * banco no primeiro dia.
 */
export default function ExtratoContaBancaria({
  conta,
  onFechar,
}: {
  conta: ContaBancaria
  onFechar: () => void
}) {
  const [mes, setMes] = useState(mesDeHoje)
  /* Intervalo de datas — achado do QA: "visualizar o extrato em um intervalo
     de datas". O mes continua sendo o atalho; "Período" abre De e Ate ja com
     o mes que estava na tela. */
  const [modo, setModo] = useState<'mes' | 'periodo'>('mes')
  const [intervalo, setIntervalo] = useState(() => periodoDoMes(mesDeHoje()))
  const [extrato, setExtrato] = useState<ExtratoDaConta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const intervaloValido =
    intervalo.de !== '' && intervalo.ate !== '' && intervalo.de <= intervalo.ate
  const { de, ate } = modo === 'mes' ? periodoDoMes(mes) : intervalo

  useEffect(() => {
    if (modo === 'periodo' && !intervaloValido) return
    let cancelado = false
    void carregarExtrato(conta.id, de, ate).then((r) => {
      if (cancelado) return
      if (r.ok) {
        setExtrato(r.dados)
        setErro(null)
      } else setErro(r.erro)
    })
    return () => {
      cancelado = true
    }
  }, [conta.id, de, ate, modo, intervaloValido])

  const atual = extrato !== null && extrato.from === de && extrato.to === ate ? extrato : null

  return (
    <Card
      title={`Extrato · ${conta.name}`}
      action={
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <div className={styles.filtrosLinha} role="group" aria-label="Período do extrato">
        <button
          type="button"
          className={`${styles.filtro} ${modo === 'mes' ? styles.filtroAtivo : ''}`}
          onClick={() => setModo('mes')}
          aria-pressed={modo === 'mes'}
        >
          Mês
        </button>
        <button
          type="button"
          className={`${styles.filtro} ${modo === 'periodo' ? styles.filtroAtivo : ''}`}
          onClick={() => {
            setIntervalo(periodoDoMes(mes))
            setModo('periodo')
          }}
          aria-pressed={modo === 'periodo'}
        >
          Período
        </button>
      </div>

      {modo === 'periodo' ? (
        <div className={styles.extratoIntervalo}>
          <label>
            <span>De</span>
            <input
              type="date"
              className={styles.input}
              value={intervalo.de}
              max={intervalo.ate || undefined}
              onChange={(e) => setIntervalo((i) => ({ ...i, de: e.target.value }))}
              aria-label="Extrato de"
            />
          </label>
          <label>
            <span>Até</span>
            <input
              type="date"
              className={styles.input}
              value={intervalo.ate}
              min={intervalo.de || undefined}
              onChange={(e) => setIntervalo((i) => ({ ...i, ate: e.target.value }))}
              aria-label="Extrato até"
            />
          </label>
          {!intervaloValido && intervalo.de !== '' && intervalo.ate !== '' ? (
            <p className={styles.extratoAviso} role="alert">
              A data inicial precisa ser antes da final.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.extratoBarra}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMes((m) => mesAoLado(m, -1))}
            aria-label="Mês anterior"
          >
            ‹
          </Button>
          <input
            type="month"
            className={styles.input}
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            aria-label="Mês do extrato"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMes((m) => mesAoLado(m, 1))}
            aria-label="Próximo mês"
          >
            ›
          </Button>
        </div>
      )}

      {erro !== null ? (
        <EmptyState title="Não deu para carregar o extrato" description={erro} />
      ) : modo === 'periodo' && !intervaloValido ? null : atual === null ? (
        <EmptyState title="Carregando..." />
      ) : (
        <>
          <div className={styles.extratoResumo}>
            <span>
              Saldo em {formatDate(atual.from)}
              <strong>{reais(atual.openingCents)}</strong>
            </span>
            <span>
              Entradas
              <strong className={styles.extratoEntrada}>+{reais(atual.inflowCents)}</strong>
            </span>
            <span>
              Saídas
              <strong className={styles.extratoSaida}>−{reais(atual.outflowCents)}</strong>
            </span>
            <span>
              Saldo em {formatDate(atual.to)}
              <strong>{reais(atual.closingCents)}</strong>
            </span>
          </div>

          {atual.entries.length === 0 ? (
            <p className={styles.extratoVazio}>
              Nenhuma movimentação {modo === 'mes' ? 'neste mês' : 'neste período'}.
            </p>
          ) : (
            <ul className={styles.extratoLinhas} aria-label="Movimentações">
              {atual.entries.map((l) => (
                <li key={l.id} className={styles.extratoLinha}>
                  <span className={styles.extratoData}>{formatDate(l.date)}</span>
                  <span className={styles.extratoDescricao}>
                    <strong>
                      {l.counterparty ?? (l.kind === 'receivable' ? 'Recebimento' : 'Pagamento')}
                    </strong>
                    <small>
                      {l.isReversal ? 'Estorno · ' : ''}
                      {l.description}
                    </small>
                  </span>
                  <span
                    className={l.amountCents >= 0 ? styles.extratoEntrada : styles.extratoSaida}
                  >
                    {l.amountCents >= 0 ? '+' : '−'}
                    {reais(Math.abs(l.amountCents))}
                  </span>
                  <span className={styles.extratoSaldo}>{reais(l.balanceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}
