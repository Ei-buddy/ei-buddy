'use client'

import { useState } from 'react'
import { devolverItens, estornarVenda, FORMAS, type VendaDoHistorico } from '@/lib/vendas-api'
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
  const [itens, setItens] = useState(venda.itens)
  const [devolvidoValor, setDevolvidoValor] = useState(venda.devolvidoValor)
  const [devolvendo, setDevolvendo] = useState(false)
  /* Quantidade a devolver por linha, pelo indice da linha. */
  const [aDevolver, setADevolver] = useState<Record<number, number>>({})
  const [motivoDevolucao, setMotivoDevolucao] = useState('')

  /* Cancelada, devolvida ou devolvida em parte: nos tres o dinheiro nao ficou
     inteiro, e o destaque verde do liquido deixa de fazer sentido. */
  const estornada = status === 'cancelled' || status === 'returned'
  const totalItens = itens.reduce((acc, i) => acc + i.quantidade - i.devolvido, 0)

  /* Devolvivel: tem produto e ainda sobra unidade. Item avulso nao volta ao
     estoque por produto, entao fica de fora. */
  const devolviveis = itens
    .map((i, idx) => ({ ...i, idx, resta: i.quantidade - i.devolvido }))
    .filter((i) => i.produtoId !== null && i.resta > 0)

  /*
   * Subtotal e liquido saem do que o servidor ja mandou, e nao de campos
   * proprios: sao `bruto` e `total - taxaCartao`. Guardar os quatro no contrato
   * abriria caminho para eles discordarem, e o unico jeito de descobrir seria o
   * lojista somando na mao.
   */
  const subtotal = venda.bruto
  const valorLiquido = venda.total - venda.taxaCartao

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

  async function confirmarDevolucao() {
    if (motivoDevolucao.trim().length < 3) {
      setToast({ msg: 'Diga o motivo da devolução.', tone: 'error' })
      return
    }
    const escolhidos = devolviveis
      .filter((i) => (aDevolver[i.idx] ?? 0) > 0)
      .map((i) => ({ produtoId: i.produtoId!, quantidade: aDevolver[i.idx]!, idx: i.idx }))
    if (escolhidos.length === 0) {
      setToast({ msg: 'Escolha a quantidade de ao menos um item.', tone: 'error' })
      return
    }

    setProcessando(true)
    const r = await devolverItens(venda.id, motivoDevolucao, escolhidos)
    setProcessando(false)

    if (!r.ok) {
      setToast({ msg: r.error, tone: 'error' })
      return
    }

    setItens((atual) =>
      atual.map((i, idx) => {
        const q = escolhidos.find((e) => e.idx === idx)?.quantidade ?? 0
        return q > 0 ? { ...i, devolvido: i.devolvido + q } : i
      }),
    )
    setDevolvidoValor((v) => v + r.dados.devolvido)
    if (r.dados.venda === 'returned') setStatus('returned')
    setDevolvendo(false)
    setADevolver({})
    setMotivoDevolucao('')
    setToast({
      /* O que o operador precisa saber AGORA: quanto entregar na mao. */
      msg:
        r.dados.entregarAoCliente > 0
          ? `Devolução registrada. Entregue ${formatMoney(r.dados.entregarAoCliente)} ao cliente.`
          : `Devolução registrada. ${formatMoney(r.dados.deixaDeReceber)} deixam de ser cobrados.`,
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
            {!estornada && devolviveis.length > 0 ? (
              <Button variant="secondary" onClick={() => setDevolvendo(true)}>
                Devolver itens
              </Button>
            ) : null}
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
      ) : devolvidoValor > 0 ? (
        <div className={styles.estornadaAviso} role="status">
          <strong>Devolução parcial: {formatMoney(devolvidoValor)} devolvidos ao cliente.</strong>
          <span>Os itens devolvidos voltaram ao estoque.</span>
        </div>
      ) : null}

      <div className="statRow">
        <Stat label="Total" value={formatMoney(venda.total)} hint={`${totalItens} item(ns)`} />
        <Stat
          label="Valor liquido"
          value={formatMoney(valorLiquido)}
          hint="sem taxa de cartao"
          tone={estornada ? 'warning' : 'positive'}
        />
        <Stat label="Imposto" value={formatMoney(venda.imposto)} />
      </div>

      <div className={styles.detalheGrid}>
        {/* --- Itens --- */}
        <Card title="Itens" className={styles.detalheLargo}>
          <ul className={styles.itensDetalhe}>
            {itens.map((i, idx) => (
              <li key={idx} className={styles.itemDetalhe}>
                <span className={styles.itemDetalheQtd}>{i.quantidade}×</span>
                <span className={styles.itemDetalheNome}>
                  {i.descricao}
                  {i.devolvido > 0 ? (
                    <>
                      {' '}
                      <Badge tone="warning">{i.devolvido} devolvido(s)</Badge>
                    </>
                  ) : null}
                </span>
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

      {devolvendo ? (
        <ConfirmarDialog
          titulo="Devolver itens"
          descricao="Escolha o que o cliente trouxe de volta. Os itens voltam ao estoque, e o valor proporcional sai primeiro do que ainda estava em aberto; o resto é entregue ao cliente."
          rotuloConfirmar="Devolver"
          processando={processando}
          detalhe={
            <div className={styles.estornoDetalhe}>
              {devolviveis.map((i) => (
                <label key={i.idx} className={styles.estornoMotivo}>
                  {i.descricao} — até {i.resta}
                  <input
                    type="number"
                    min={0}
                    max={i.resta}
                    value={aDevolver[i.idx] ?? 0}
                    onChange={(e) => {
                      const n = Math.max(
                        0,
                        Math.min(i.resta, Math.floor(Number(e.target.value) || 0)),
                      )
                      setADevolver((a) => ({ ...a, [i.idx]: n }))
                    }}
                  />
                </label>
              ))}
              <label className={styles.estornoMotivo}>
                Motivo da devolução
                <input
                  value={motivoDevolucao}
                  onChange={(e) => setMotivoDevolucao(e.target.value)}
                  placeholder="Item com defeito, tamanho errado..."
                  maxLength={280}
                />
              </label>
            </div>
          }
          onConfirmar={confirmarDevolucao}
          onCancelar={() => setDevolvendo(false)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
