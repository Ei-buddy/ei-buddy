'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { carregarCatalogo, type ProdutoDoCatalogo } from '@/lib/catalogo-api'
import { carregarCompras, registrarCompra, type Compra } from '@/lib/compras-api'
import { formatCentavos, formatDateTime, hoje } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import {
  Card,
  EmptyState,
  Field,
  FormGrid,
  Input,
  LegendaObrigatorio,
  PageHeader,
  Select,
} from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './compras.module.css'

type Linha = {
  produto: ProdutoDoCatalogo
  quantidade: string
  custo: string
}

const custoInicial = (p: ProdutoDoCatalogo) =>
  p.precoCusto > 0 ? p.precoCusto.toFixed(2).replace('.', ',') : ''

/**
 * Entrada de mercadoria — NR-158.
 *
 * A compra do fornecedor: escolhe os produtos, digita quantidade e custo, e o
 * sistema soma ao estoque, atualiza o custo (medio ponderado) e lanca a conta
 * a pagar, a vista ou parcelada.
 */
export default function ComprasView() {
  const [compras, setCompras] = useState<Compra[] | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarCompras()
    if (r.ok) {
      setCompras(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  return (
    <>
      <PageHeader
        title="Entrada de mercadoria"
        subtitle="Compra de fornecedor: soma ao estoque, atualiza o custo e lança a conta a pagar"
      />

      <NovaCompra
        aoRegistrar={(c) => {
          setToast({
            msg: `Entrada registrada: ${formatCentavos(c.totalCents)}${
              c.totalCents > 0 ? ' lançado em contas a pagar' : ''
            }.`,
            tone: 'success',
          })
          void carregar()
        }}
        aoErrar={(msg) => setToast({ msg, tone: 'error' })}
      />

      <Card title="Entradas registradas">
        {erro !== null ? (
          <EmptyState title="Não deu para carregar as entradas" description={erro} />
        ) : compras === undefined ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : compras.length === 0 ? (
          <p className={styles.vazio}>Nenhuma entrada registrada ainda.</p>
        ) : (
          <ul className={styles.lista}>
            {compras.map((c) => (
              <li key={c.id} className={styles.compra}>
                <div className={styles.compraTopo}>
                  <span>
                    <strong>{c.supplier}</strong>
                    <small>
                      {formatDateTime(c.createdAt)}
                      {c.invoiceNumber ? ` · NF ${c.invoiceNumber}` : ''}
                    </small>
                  </span>
                  <span className={styles.total}>
                    <strong>{formatCentavos(c.totalCents)}</strong>
                    <small>
                      {c.installments > 1 ? `em ${c.installments} parcelas` : 'parcela única'}
                    </small>
                  </span>
                </div>
                <ul className={styles.itens}>
                  {c.items.map((i) => (
                    <li key={i.productId}>
                      {i.quantity} × {i.description} — {formatCentavos(i.unitCostCents)} cada
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

function NovaCompra({
  aoRegistrar,
  aoErrar,
}: {
  aoRegistrar: (c: Compra) => void
  aoErrar: (m: string) => void
}) {
  const [fornecedor, setFornecedor] = useState('')
  const [nota, setNota] = useState('')
  const [vencimento, setVencimento] = useState(hoje())
  const [parcelas, setParcelas] = useState('1')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoDoCatalogo[]>([])
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) return
    const t = setTimeout(() => {
      void carregarCatalogo({ termo, estoque: 'todos', pagina: 1, porPagina: 8 }).then((r) =>
        setAchados(r.ok ? r.dados.produtos : []),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  function incluir(p: ProdutoDoCatalogo) {
    setLinhas((atual) =>
      atual.some((l) => l.produto.id === p.id)
        ? atual
        : [...atual, { produto: p, quantidade: '1', custo: custoInicial(p) }],
    )
    setBusca('')
    setAchados([])
  }

  const mudar = (id: string, campo: 'quantidade' | 'custo', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produto.id === id ? { ...l, [campo]: valor } : l)))

  const total = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.custo)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)

  async function registrar(e: FormEvent) {
    e.preventDefault()
    if (fornecedor.trim().length < 2) return aoErrar('Informe o fornecedor.')
    if (linhas.length === 0) return aoErrar('Inclua pelo menos um produto.')

    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitCostCents = centavosDoTexto(l.custo)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return aoErrar(`Quantidade inválida em "${l.produto.descricao}".`)
      }
      if (unitCostCents === null || unitCostCents < 0) {
        return aoErrar(`Custo inválido em "${l.produto.descricao}".`)
      }
      itens.push({ productId: l.produto.id, quantity, unitCostCents })
    }

    setSalvando(true)
    const r = await registrarCompra({
      supplier: fornecedor.trim(),
      ...(nota.trim() ? { invoiceNumber: nota.trim() } : {}),
      items: itens,
      dueDate: vencimento,
      installments: Number(parcelas),
    })
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)

    setFornecedor('')
    setNota('')
    setParcelas('1')
    setLinhas([])
    aoRegistrar(r.dados)
  }

  return (
    <Card title="Nova entrada">
      <form onSubmit={registrar} noValidate>
        <LegendaObrigatorio />
        <FormGrid>
          <Field label="Fornecedor" obrigatorio span={6}>
            <Input
              id="compra-fornecedor"
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
              placeholder="Ex.: Distribuidora Boa Vista"
              maxLength={120}
            />
          </Field>
          <Field label="Número da nota" hint="opcional" span={6}>
            <Input
              id="compra-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={60}
            />
          </Field>
          <Field label="Adicionar produto" span={12}>
            <Input
              id="compra-busca"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                if (e.target.value.trim().length < 2) setAchados([])
              }}
              placeholder="Busque pelo nome, código ou código de barras"
              autoComplete="off"
            />
          </Field>
        </FormGrid>

        {achados.length > 0 ? (
          <ul className={styles.achados} role="listbox" aria-label="Produtos encontrados">
            {achados.map((p) => (
              <li key={p.id}>
                <button type="button" className={styles.achado} onClick={() => incluir(p)}>
                  <span>{p.descricao}</span>
                  <small>
                    estoque {p.estoque} · custo atual{' '}
                    {formatCentavos(Math.round(p.precoCusto * 100))}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {linhas.length === 0 ? (
          <p className={styles.vazio}>Nenhum produto incluído.</p>
        ) : (
          <ul className={styles.linhas}>
            {linhas.map((l) => (
              <li key={l.produto.id} className={styles.linha}>
                <span className={styles.linhaNome}>
                  <strong>{l.produto.descricao}</strong>
                  <small>estoque atual {l.produto.estoque}</small>
                </span>
                <label className={styles.mini}>
                  Qtd.
                  <Input
                    aria-label={`Quantidade de ${l.produto.descricao}`}
                    inputMode="numeric"
                    value={l.quantidade}
                    onChange={(e) => mudar(l.produto.id, 'quantidade', e.target.value)}
                  />
                </label>
                <label className={styles.mini}>
                  Custo un. (R$)
                  <Input
                    aria-label={`Custo unitário de ${l.produto.descricao}`}
                    inputMode="decimal"
                    value={l.custo}
                    onChange={(e) => mudar(l.produto.id, 'custo', e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLinhas((a) => a.filter((x) => x.produto.id !== l.produto.id))}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}

        <FormGrid>
          <Field label="Vencimento da 1ª parcela" obrigatorio span={6}>
            <Input
              id="compra-vencimento"
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </Field>
          <Field label="Parcelas" span={6}>
            <Select
              id="compra-parcelas"
              value={parcelas}
              onChange={(e) => setParcelas(e.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>
                  {n === '1' ? 'Parcela única' : `${n}x mensais`}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>

        <div className={styles.rodape}>
          <span>
            Total <strong>{formatCentavos(total)}</strong>
          </span>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Registrando...' : 'Registrar entrada'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
