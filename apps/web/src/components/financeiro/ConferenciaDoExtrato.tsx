'use client'

import { useEffect, useState } from 'react'
import {
  carregarCasamentoAutomatico,
  confirmarConciliacoes,
  paresMarcados,
  resumoDaConfirmacao,
  semDuvida,
  type ParAutomatico,
} from '@/lib/conciliacao-api'
import { formatDate, formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import styles from './conciliacao.module.css'

const emReais = (centavos: number) => centavos / 100

/**
 * Conferencia lado a lado — DEC-026 (decisao de 15/11).
 *
 * O extrato a esquerda, NA ORDEM DO BANCO; a direita, a conta que o servidor
 * casou com cada linha. A pessoa confirma par a par (nada vem marcado: quem
 * confere e ela), e no fim o sistema da baixa em tudo o que foi confirmado, na
 * mesma ordem do extrato — para os dois baterem quando ela conferir depois.
 *
 * O botao "marcar os sem duvida" so marca o que o proprio servidor diz que nao
 * tem concorrente: mesmo dia e nenhum outro lancamento do mesmo valor.
 */
export default function ConferenciaDoExtrato({
  contaDoExtrato,
  onPronto,
  onErro,
}: {
  /** A conta das baixas. Sem ela, confere mas nao confirma. */
  contaDoExtrato: string | null
  onPronto: (msg: string) => void
  onErro: (msg: string) => void
}) {
  const [pares, setPares] = useState<ParAutomatico[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    void (async () => {
      const r = await carregarCasamentoAutomatico()
      if (r.ok) setPares(r.dados.pairs)
      else setErro(r.erro)
    })()
  }, [])

  const alternar = (id: string) =>
    setMarcados((m) => {
      const novo = new Set(m)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })

  const casados = (pares ?? []).filter((p) => p.suggestion !== null)
  const semDuvidas = casados.filter(semDuvida)
  const escolhidos = pares === null ? [] : paresMarcados(pares, marcados)

  async function confirmar() {
    if (contaDoExtrato === null || escolhidos.length === 0) return
    setConfirmando(true)
    const r = await confirmarConciliacoes(contaDoExtrato, escolhidos)
    setConfirmando(false)
    if (!r.ok) {
      onErro(r.erro)
      return
    }
    onPronto(resumoDaConfirmacao(r.dados))
  }

  if (erro !== null) {
    return (
      <Card title="Conferência lado a lado">
        <EmptyState title="Não deu para casar o extrato" description={erro} />
      </Card>
    )
  }
  if (pares === null) {
    return (
      <Card title="Conferência lado a lado">
        <SkeletonLinhas />
      </Card>
    )
  }

  return (
    <Card
      title="Conferência lado a lado"
      action={
        <span className={styles.conferenciaAcoes}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMarcados(new Set(semDuvidas.map((p) => p.transaction.id)))}
            disabled={semDuvidas.length === 0 || confirmando}
          >
            Marcar os sem dúvida ({semDuvidas.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMarcados(new Set())}
            disabled={marcados.size === 0 || confirmando}
          >
            Desmarcar
          </Button>
        </span>
      }
    >
      <p className={styles.aviso}>
        {casados.length} de {pares.length} linhas do extrato têm uma conta que bate. Confira cada
        par e marque os certos: ao confirmar, cada um é conciliado e recebe a baixa na data do
        banco, na ordem do extrato.
      </p>

      <div className={styles.ladoALadoCabecalho} aria-hidden="true">
        <span>Extrato do banco</span>
        <span>Conta a pagar ou a receber</span>
      </div>
      <ol className={styles.ladoALado} aria-label="Pares do extrato, na ordem do banco">
        {pares.map((p) => {
          const t = p.transaction
          const s = p.suggestion
          const marcado = marcados.has(t.id)
          return (
            <li key={t.id} className={`${styles.par} ${marcado ? styles.parMarcado : ''}`}>
              <div className={styles.parLado}>
                <span className={styles.data}>{formatDate(t.postedOn)}</span>
                <strong>{t.description}</strong>
                <span className={t.direction === 'debit' ? styles.saida : styles.entrada}>
                  {t.direction === 'debit' ? '−' : '+'} {formatMoney(emReais(t.amountCents))}
                </span>
              </div>
              <div className={styles.parLado}>
                {s === null ? (
                  <span className={styles.contraparte}>
                    Nada bate. Use “Conciliar” na lista para escolher ou criar o lançamento.
                  </span>
                ) : (
                  <>
                    <span className={styles.data}>vence {formatDate(s.entry.dueDate)}</span>
                    <strong>{s.entry.counterparty}</strong>
                    <span className={styles.contraparte}>
                      {s.entry.description}
                      {s.expectedAmountCents === s.entry.amountCents
                        ? ''
                        : ` · ${formatMoney(emReais(s.entry.amountCents))} bruto`}
                    </span>
                    <span className={styles.parSelos}>
                      <Badge
                        tone={s.daysApart === 0 && s.alternatives === 0 ? 'success' : 'warning'}
                      >
                        {s.daysApart === 0 ? 'mesmo dia' : `${s.daysApart} dia(s) de diferença`}
                      </Badge>
                      {s.alternatives > 0 ? (
                        <Badge tone="warning">
                          {s.alternatives} outra(s) do mesmo valor — confira
                        </Badge>
                      ) : null}
                    </span>
                  </>
                )}
              </div>
              <label className={styles.parConfirma}>
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={s === null || confirmando}
                  onChange={() => alternar(t.id)}
                  aria-label={`Confirmar ${t.description} de ${formatDate(t.postedOn)}`}
                />
                <span>Confere</span>
              </label>
            </li>
          )
        })}
      </ol>

      <div className={styles.conferenciaRodape}>
        {contaDoExtrato === null ? (
          <span className={styles.contraparte}>Escolha a conta do extrato para dar baixa.</span>
        ) : (
          <span className={styles.contraparte}>As baixas vão para {contaDoExtrato}.</span>
        )}
        <Button
          onClick={() => void confirmar()}
          disabled={escolhidos.length === 0 || contaDoExtrato === null || confirmando}
        >
          {confirmando
            ? 'Dando baixa...'
            : escolhidos.length === 1
              ? 'Dar baixa no confirmado'
              : `Dar baixa nos ${escolhidos.length} confirmados`}
        </Button>
      </div>
    </Card>
  )
}
