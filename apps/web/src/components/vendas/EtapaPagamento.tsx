'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  criarCobrancaVenda,
  FORMAS,
  PARCELAS_MAXIMAS,
  statusCobrancaVenda,
  taxaDoCredito,
  taxaDoPagamento,
  valorLiquido,
  type Pagamento,
} from '@/lib/vendas-api'
import type { FormaPagamento } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { Badge, Card } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import CobrancaPix from '@/components/app/CobrancaPix'
import { IconCheck, IconClose, IconTrash } from '@/components/Icons'
import styles from './vendas.module.css'
import { reaisDoTexto } from '@/lib/valor'

export default function EtapaPagamento({
  total,
  pagamentos,
  onPagamentos,
  onVoltar,
  onConcluir,
  fechando,
}: {
  total: number
  pagamentos: Pagamento[]
  onPagamentos: (pagamentos: Pagamento[]) => void
  onVoltar: () => void
  onConcluir: () => void
  fechando: boolean
}) {
  const [forma, setForma] = useState<FormaPagamento>('dinheiro')
  const [valorParcial, setValorParcial] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [cobrando, setCobrando] = useState<Pagamento | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const confirmado = pagamentos
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + p.valor, 0)

  const restante = Math.max(0, total - confirmado)
  const quitado = restante <= 0.01
  const liquido = valorLiquido(pagamentos)
  const taxaTotal = pagamentos
    .filter((p) => p.status === 'confirmado')
    .reduce((acc, p) => acc + taxaDoPagamento(p), 0)

  const formaAtual = useMemo(() => FORMAS.find((f) => f.valor === forma)!, [forma])

  /* Estavel: o CobrancaPix usa como dependencia de efeito. */
  const criarCobranca = useCallback((valor: number) => criarCobrancaVenda(valor), [])

  /* ---------------------------------------------------------------- *
   * Lancar pagamento
   * ---------------------------------------------------------------- */

  function lancar() {
    const valor = valorParcial.trim() ? reaisDoTexto(valorParcial) : restante

    if (valor <= 0) {
      setToast({ msg: 'Informe um valor maior que zero.', tone: 'error' })
      return
    }
    if (valor > restante + 0.01) {
      setToast({ msg: 'O valor é maior que o restante a pagar.', tone: 'error' })
      return
    }

    const novo: Pagamento = {
      id: `pg-${Date.now()}`,
      forma,
      valor,
      status: formaAtual.online ? 'pendente' : 'confirmado',
      ...(forma === 'credito' && parcelas > 1 ? { parcelas } : {}),
    }

    onPagamentos([...pagamentos, novo])
    setValorParcial('')
    setParcelas(1)

    /* Dinheiro, cartao (na maquininha) e carteira sao confirmados na hora.
       So o Pix abre a cobranca para o cliente pagar. */
    if (formaAtual.online) {
      setCobrando(novo)
    } else {
      setToast({
        msg: `${formaAtual.rotulo}${novo.parcelas ? ` em ${novo.parcelas}x` : ''}: ${formatMoney(valor)} recebido.`,
        tone: 'success',
      })
    }
  }

  function confirmarCobranca(id: string) {
    onPagamentos(pagamentos.map((p) => (p.id === id ? { ...p, status: 'confirmado' } : p)))
    setCobrando(null)
    setToast({ msg: 'Pagamento confirmado.', tone: 'success' })
  }

  function remover(id: string) {
    onPagamentos(pagamentos.filter((p) => p.id !== id))
  }

  return (
    <>
      <div className={styles.pagamentoGrid}>
        {/* ============ Formas ============ */}
        <Card title="Como o cliente vai pagar">
          <div className={styles.formas} role="group" aria-label="Forma de pagamento">
            {FORMAS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={`${styles.formaBotao} ${forma === f.valor ? styles.formaAtiva : ''}`}
                onClick={() => setForma(f.valor)}
                aria-pressed={forma === f.valor}
                disabled={quitado}
              >
                <strong>{f.rotulo}</strong>
                {f.taxa > 0 ? (
                  <span>taxa {f.taxa.toFixed(2).replace('.', ',')}%</span>
                ) : (
                  <span>sem taxa</span>
                )}
              </button>
            ))}
          </div>

          {!quitado ? (
            <>
              <label className={styles.campo}>
                <span>Valor — deixe em branco para pagar tudo ({formatMoney(restante)})</span>
                <input
                  className={`${styles.input} ${styles.inputGrande}`}
                  value={valorParcial}
                  onChange={(e) => setValorParcial(e.target.value)}
                  placeholder={formatMoney(restante)}
                  inputMode="decimal"
                />
              </label>

              {forma === 'credito' ? (
                <label className={styles.campo}>
                  <span>Parcelas</span>
                  <select
                    className={styles.input}
                    value={parcelas}
                    onChange={(e) => setParcelas(Number(e.target.value))}
                  >
                    {Array.from({ length: PARCELAS_MAXIMAS }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'À vista (1x)' : `${n}x`} — taxa{' '}
                        {taxaDoCredito(n).toFixed(2).replace('.', ',')}%
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <Button block onClick={lancar}>
                {formaAtual.online
                  ? `Gerar cobranca em ${formaAtual.rotulo}`
                  : `Confirmar recebimento em ${formaAtual.rotulo}`}
              </Button>

              {forma === 'carteira' ? (
                <p className={styles.aviso}>
                  A carteira do cliente ainda não tem saldo controlado no sistema — por enquanto
                  isto registra apenas a forma de pagamento.
                </p>
              ) : null}
            </>
          ) : (
            <div className={styles.quitado}>
              <IconCheck size={22} />
              <strong>Pagamento completo</strong>
              <span>Siga para a nota fiscal.</span>
            </div>
          )}
        </Card>

        {/* ============ Resumo ============ */}
        <Card title="Resumo do pagamento">
          <div className={styles.pagamentoResumo}>
            <div className={styles.resumoLinha}>
              <span>Total da venda</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <div className={styles.resumoLinha}>
              <span>Recebido</span>
              <span>{formatMoney(confirmado)}</span>
            </div>
            <div className={`${styles.resumoLinha} ${styles.resumoTotal}`}>
              <span>Falta</span>
              <strong className={quitado ? styles.faltaZero : undefined}>
                {formatMoney(restante)}
              </strong>
            </div>
          </div>

          {pagamentos.length > 0 ? (
            <ul className={styles.pagamentos}>
              {pagamentos.map((p) => {
                const f = FORMAS.find((x) => x.valor === p.forma)!
                return (
                  <li key={p.id} className={styles.pagamento}>
                    <span className={styles.pagamentoPrincipal}>
                      <strong>
                        {f.rotulo}
                        {p.parcelas ? ` · ${p.parcelas}x` : ''}
                      </strong>
                      {taxaDoPagamento(p) > 0 ? (
                        <span>taxa {formatMoney(taxaDoPagamento(p))}</span>
                      ) : null}
                    </span>

                    {p.status === 'confirmado' ? (
                      <Badge tone="success">Confirmado</Badge>
                    ) : p.status === 'falhou' ? (
                      <Badge tone="danger">Falhou</Badge>
                    ) : (
                      <Badge tone="warning">Aguardando</Badge>
                    )}

                    <span className={styles.pagamentoValor}>{formatMoney(p.valor)}</span>

                    {p.status !== 'confirmado' ? (
                      <span className={styles.pagamentoAcoes}>
                        <button
                          type="button"
                          className={styles.pagamentoBotao}
                          onClick={() => setCobrando(p)}
                        >
                          Abrir
                        </button>
                        <button
                          type="button"
                          className={styles.pagamentoExcluir}
                          onClick={() => remover(p.id)}
                          aria-label="Remover pagamento"
                        >
                          <IconTrash size={14} />
                        </button>
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={styles.pagamentoVazio}>Nenhum pagamento lancado ainda.</p>
          )}

          {taxaTotal > 0 ? (
            <div className={styles.liquidoBox}>
              <span>
                Entra em contas a receber
                <small>ja descontada a taxa de {formatMoney(taxaTotal)}</small>
              </span>
              <strong>{formatMoney(liquido)}</strong>
            </div>
          ) : null}

          <div className={styles.pagamentoNavegacao}>
            <Button variant="secondary" onClick={onVoltar} disabled={fechando}>
              Voltar ao carrinho
            </Button>
            <Button onClick={onConcluir} disabled={!quitado || fechando}>
              {fechando ? (
                <>
                  <Spinner size={15} />
                  Fechando...
                </>
              ) : (
                'Fechar venda'
              )}
            </Button>
          </div>
        </Card>
      </div>

      {/* ============ Cobranca online ============ */}
      {cobrando ? (
        <div className={styles.dialogRoot}>
          <button
            type="button"
            className={styles.dialogBackdrop}
            onClick={() => setCobrando(null)}
            aria-label="Fechar"
          />

          <div className={styles.dialogPainel} role="dialog" aria-modal="true">
            <header className={styles.dialogCabecalho}>
              <h2 className={styles.dialogTitulo}>
                Cobranca em {FORMAS.find((f) => f.valor === cobrando.forma)?.rotulo}
              </h2>
              <button
                type="button"
                className={styles.dialogFechar}
                onClick={() => setCobrando(null)}
                aria-label="Fechar"
              >
                <IconClose size={18} />
              </button>
            </header>

            <CobrancaPix
              titulo={`Venda · ${formatMoney(cobrando.valor)}`}
              subtitulo="Mostre ao cliente"
              amount={cobrando.valor}
              criarCobranca={criarCobranca}
              consultarStatus={statusCobrancaVenda}
              onPago={() => confirmarCobranca(cobrando.id)}
              textoSucesso="Pagamento recebido. Voltando para a venda..."
            />

            {/* ----------------------------------------------------------
                APOIO A DEMONSTRACAO — so fora de producao.
                Sem provedor real o polling nunca confirma. Em producao este
                botao deixava qualquer operador marcar um Pix como pago sem
                dinheiro nenhum ter entrado.
               ---------------------------------------------------------- */}
            {process.env.NODE_ENV !== 'production' ? (
              <button
                type="button"
                className={styles.demoBotao}
                onClick={() => confirmarCobranca(cobrando.id)}
              >
                Simular pagamento confirmado (demonstracao)
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
