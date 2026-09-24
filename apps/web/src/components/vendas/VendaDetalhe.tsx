'use client'

import { useState } from 'react'
import { estornarVenda, FORMAS, type VendaDoHistorico } from '@/lib/vendas-api'
import { formatDateTime, formatMoney } from '@/lib/format'
import { Badge, Card, PageHeader, Stat } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import styles from './vendas.module.css'

export default function VendaDetalhe({ venda }: { venda: VendaDoHistorico }) {
  const [status, setStatus] = useState(venda.status)
  const [estornando, setEstornando] = useState(false)
  const [processando, setProcessando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  /* Cancelada, devolvida ou devolvida em parte: nos tres o dinheiro nao ficou
     inteiro, e o destaque verde do liquido deixa de fazer sentido. */
  const estornada = status === 'cancelled' || status === 'returned'
  const totalItens = venda.itens.reduce((acc, i) => acc + i.quantidade, 0)

  /* O liquido vem do servidor ja sem imposto e sem tarifa de cartao. Tirar a
     tarifa de novo aqui a contava duas vezes. */
  const subtotal = venda.bruto
  const valorLiquido = venda.liquido

  async function confirmarEstorno() {
    /* O servidor exige o motivo (fica no historico da venda). Recusar aqui
       evita a ida e volta so para ouvir isso. */
    if (motivo.trim().length < 3) {
      setToast({ msg: 'Diga o motivo do estorno.', tone: 'error' })
      return
    }

    setProcessando(true)
    const r = await estornarVenda(venda.id, motivo)
    setProcessando(false)

    if (!r.ok) {
      setEstornando(false)
      setToast({ msg: r.error, tone: 'error' })
      return
    }

    setEstornando(false)
    setStatus('cancelled')
    setToast({
      msg: `Venda estornada. ${totalItens} item(ns) devolvido(s) ao estoque.`,
      tone: 'success',
    })
  }

  return (
    <>
      <PageHeader
        title={`Venda #${venda.numero}`}
        subtitle={`${venda.clienteNome ?? 'Venda de balcao'} · ${formatDateTime(venda.data)}`}
        actions={
          <>
            <ButtonLink href="/app/vendas" variant="secondary">
              Voltar
            </ButtonLink>
            {!estornada ? (
              <Button variant="danger" onClick={() => setEstornando(true)}>
                Estornar venda
              </Button>
            ) : null}
          </>
        }
      />

      {estornada ? (
        <div className={styles.estornadaAviso} role="status">
          <strong>Esta venda foi estornada.</strong>
          <span>Os itens voltaram ao estoque e o titulo em contas a receber foi revertido.</span>
        </div>
      ) : null}

      <div className="statRow">
        <Stat label="Total" value={formatMoney(venda.total)} hint={`${totalItens} item(ns)`} />
        <Stat
          label="Valor liquido"
          value={formatMoney(valorLiquido)}
          hint="sem imposto e taxa de cartão"
          tone={estornada ? 'warning' : 'positive'}
        />
        <Stat label="Imposto" value={formatMoney(venda.imposto)} />
      </div>

      <div className={styles.detalheGrid}>
        {/* --- Itens --- */}
        <Card title="Itens" className={styles.detalheLargo}>
          <ul className={styles.itensDetalhe}>
            {venda.itens.map((i, idx) => (
              <li key={idx} className={styles.itemDetalhe}>
                <span className={styles.itemDetalheQtd}>{i.quantidade}×</span>
                <span className={styles.itemDetalheNome}>{i.descricao}</span>
                <span className={styles.itemDetalheUnit}>{formatMoney(i.precoUnitario)}</span>
                <span className={styles.itemDetalheSub}>
                  {formatMoney(i.precoUnitario * i.quantidade)}
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.resumo}>
            <div className={styles.resumoLinha}>
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            {venda.desconto > 0 ? (
              <div className={styles.resumoLinha}>
                <span>Desconto</span>
                <span className={styles.resumoDesconto}>- {formatMoney(venda.desconto)}</span>
              </div>
            ) : null}
            <div className={`${styles.resumoLinha} ${styles.resumoTotal}`}>
              <span>Total</span>
              <strong>{formatMoney(venda.total)}</strong>
            </div>
          </div>
        </Card>

        {/* --- Pagamento --- */}
        <Card title="Pagamento">
          <ul className={styles.pagamentosDetalhe}>
            {venda.pagamentos.map((p, idx) => {
              const f = FORMAS.find((x) => x.valor === p.forma)
              return (
                <li key={idx} className={styles.pagamentoDetalhe}>
                  <span>
                    <strong>
                      {f?.rotulo ?? p.forma}
                      {p.parcelas !== null && p.parcelas > 1 ? ` · ${p.parcelas}x` : ''}
                    </strong>
                    {f && f.taxa > 0 ? (
                      <span>taxa {f.taxa.toFixed(2).replace('.', ',')}%</span>
                    ) : null}
                  </span>
                  <strong>{formatMoney(p.valor)}</strong>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* --- Documentos fiscais --- */}
        <Card title="Documentos fiscais">
          {venda.notaNumero !== null ? (
            <div className={styles.notaDetalhe}>
              {/* NFC-e e o unico modelo que o sistema emite hoje (NR-042). O
                  seletor NFS-e existia so nos dados de exemplo. */}
              <Badge tone="info">NFC-e</Badge>
              <strong>Numero {venda.notaNumero}</strong>
              {venda.notaChave !== null ? (
                <span className={styles.notaChave}>{venda.notaChave}</span>
              ) : null}
            </div>
          ) : (
            <p className={styles.semNota}>Nenhuma nota emitida para esta venda.</p>
          )}
        </Card>
      </div>

      {estornando ? (
        <ConfirmarDialog
          titulo="Estornar a venda"
          descricao="Os itens voltam ao estoque e o título em contas a receber é revertido. A venda continua no histórico, marcada como estornada, com o motivo."
          tom="perigo"
          rotuloConfirmar="Estornar"
          processando={processando}
          detalhe={
            <div className={styles.estornoDetalhe}>
              <strong>
                Venda #{venda.numero} · {formatMoney(venda.total)}
              </strong>
              <span>
                {venda.clienteNome ?? 'Venda de balcao'} · {totalItens} item(ns)
              </span>
              <label className={styles.estornoMotivo}>
                Motivo do estorno
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Cliente desistiu, item com defeito..."
                  maxLength={280}
                  autoFocus
                />
              </label>
            </div>
          }
          onConfirmar={confirmarEstorno}
          onCancelar={() => setEstornando(false)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
