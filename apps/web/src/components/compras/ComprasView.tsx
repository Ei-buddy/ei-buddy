'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { carregarCatalogo, type ProdutoDoCatalogo } from '@/lib/catalogo-api'
import {
  carregarCompras,
  estornarCompra,
  parcelasIguais,
  registrarCompra,
  type Compra,
} from '@/lib/compras-api'
import { type FornecedorCadastrado, listarFornecedores } from '@/lib/fornecedores-cadastro-api'
import { formatCentavos, formatDate, formatDateTime, hoje } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import {
  Badge,
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
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
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
  /* Estorno — achado do QA ("poder estornar a compra"). */
  const [estornando, setEstornando] = useState<Compra | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)

  async function confirmarEstorno() {
    if (estornando === null) return
    if (motivo.trim().length < 3) {
      setToast({ msg: 'Diga por que está estornando.', tone: 'error' })
      return
    }
    setProcessando(true)
    const r = await estornarCompra(estornando.id, motivo.trim())
    setProcessando(false)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setEstornando(null)
    setMotivo('')
    setToast({
      msg: 'Compra estornada: o estoque voltou e as contas a pagar foram canceladas.',
      tone: 'success',
    })
    void carregar()
  }

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
                    <strong>
                      {c.supplier}{' '}
                      {c.status === 'cancelled' ? <Badge tone="danger">estornada</Badge> : null}
                    </strong>
                    <small>
                      {formatDateTime(c.createdAt)}
                      {c.invoiceNumber ? ` · NF ${c.invoiceNumber}` : ''}
                      {c.status === 'cancelled' && c.cancelReason
                        ? ` · estornada: ${c.cancelReason}`
                        : ''}
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
                {c.status === 'active' ? (
                  <div className={styles.compraAcoes}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMotivo('')
                        setEstornando(c)
                      }}
                    >
                      Estornar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {estornando !== null ? (
        <ConfirmarDialog
          titulo="Estornar a compra"
          descricao="O estoque dos produtos volta ao que era e as contas a pagar desta compra são canceladas. A compra continua na lista, marcada como estornada. Conta já paga precisa ter o pagamento estornado antes."
          tom="perigo"
          rotuloConfirmar="Estornar"
          processando={processando}
          detalhe={
            <label className={styles.motivo}>
              <span>
                {estornando.supplier} · {formatCentavos(estornando.totalCents)} — motivo
              </span>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: nota lançada em dobro"
                maxLength={280}
                aria-label="Motivo do estorno"
              />
            </label>
          }
          onConfirmar={() => void confirmarEstorno()}
          onCancelar={() => setEstornando(null)}
        />
      ) : null}

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
  /* O fornecedor do cadastro (NR-191) — achado do QA: "nao esta sendo
     possivel selecionar o fornecedor". O texto livre continua valendo. */
  const [fornecedorId, setFornecedorId] = useState<string | null>(null)
  const [fornecedores, setFornecedores] = useState<FornecedorCadastrado[] | null>(null)
  const [nota, setNota] = useState('')
  const [vencimento, setVencimento] = useState(hoje())
  const [quantasParcelas, setQuantasParcelas] = useState('1')
  /* As parcelas uma a uma — achado do QA: vencimento e valor de cada uma. */
  const [parcelas, setParcelas] = useState<{ dueDate: string; valor: string }[]>([])
  const [parcelasEditadas, setParcelasEditadas] = useState(false)
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

  /** Enter no produto — achado do QA: mostrar a lista, como no PDV. */
  async function aoTeclarNoProduto(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (achados.length === 1) {
      incluir(achados[0]!)
      return
    }
    const r = await carregarCatalogo({
      termo: busca.trim(),
      estoque: 'todos',
      pagina: 1,
      porPagina: 12,
    })
    setAchados(r.ok ? r.dados.produtos : [])
  }

  /** Enter (ou foco) no fornecedor mostra os cadastrados — o mesmo do produto. */
  async function mostrarFornecedores(termo: string) {
    const r = await listarFornecedores({ termo })
    setFornecedores(r.ok ? r.dados : [])
  }

  function escolherFornecedor(f: FornecedorCadastrado) {
    setFornecedor(f.tradeName ?? f.name)
    setFornecedorId(f.id)
    setFornecedores(null)
  }

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

  /*
   * As parcelas acompanham o total, o numero e o primeiro vencimento — ate a
   * pessoa mexer numa delas. A partir dai, sao dela; "Recalcular" volta a
   * dividir igual.
   */
  const recalcular = useCallback(() => {
    const n = Number(quantasParcelas)
    setParcelas(
      parcelasIguais(Math.max(total, n), n, vencimento).map((p) => ({
        dueDate: p.dueDate,
        valor: (p.amountCents / 100).toFixed(2).replace('.', ','),
      })),
    )
    setParcelasEditadas(false)
  }, [quantasParcelas, total, vencimento])

  useEffect(() => {
    if (parcelasEditadas) return
    const t = setTimeout(recalcular, 0)
    return () => clearTimeout(t)
  }, [recalcular, parcelasEditadas])

  const somaParcelas = parcelas.reduce((s, p) => s + (centavosDoTexto(p.valor) ?? 0), 0)
  const diferenca = total - somaParcelas

  function mudarParcela(i: number, campo: 'dueDate' | 'valor', valor: string) {
    setParcelasEditadas(true)
    setParcelas((ps) => ps.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)))
  }

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

    const parcels = parcelas.map((p) => ({
      dueDate: p.dueDate,
      amountCents: centavosDoTexto(p.valor) ?? 0,
    }))
    if (total > 0) {
      if (parcels.some((p) => !p.dueDate || p.amountCents <= 0)) {
        return aoErrar('Cada parcela precisa de vencimento e valor.')
      }
      if (diferenca !== 0) {
        return aoErrar(
          `As parcelas somam ${formatCentavos(somaParcelas)}; a compra é de ${formatCentavos(total)}.`,
        )
      }
    }

    setSalvando(true)
    const r = await registrarCompra({
      supplier: fornecedor.trim(),
      ...(fornecedorId !== null ? { supplierId: fornecedorId } : {}),
      ...(nota.trim() ? { invoiceNumber: nota.trim() } : {}),
      items: itens,
      /* Bonificacao (custo zero) nao gera conta: vai so a data. */
      ...(total > 0 ? { parcels } : { dueDate: vencimento }),
    })
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)

    setFornecedor('')
    setFornecedorId(null)
    setNota('')
    setQuantasParcelas('1')
    setParcelasEditadas(false)
    setLinhas([])
    aoRegistrar(r.dados)
  }

  return (
    <Card title="Nova entrada">
      <form onSubmit={registrar} noValidate>
        <LegendaObrigatorio />
        <FormGrid>
          <Field label="Fornecedor" obrigatorio span={6} hint="Enter mostra os cadastrados">
            <Input
              id="compra-fornecedor"
              value={fornecedor}
              onChange={(e) => {
                setFornecedor(e.target.value)
                setFornecedorId(null)
                if (e.target.value.trim().length >= 2) void mostrarFornecedores(e.target.value)
              }}
              onFocus={() => void mostrarFornecedores(fornecedor)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (fornecedores?.length === 1) escolherFornecedor(fornecedores[0]!)
                else void mostrarFornecedores(fornecedor)
              }}
              placeholder="Busque ou digite o nome"
              maxLength={120}
              autoComplete="off"
            />
            {fornecedorId !== null ? (
              <small className={styles.escolhido}>Fornecedor do cadastro</small>
            ) : null}
          </Field>
          <Field label="Número da nota" hint="opcional" span={6}>
            <Input
              id="compra-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={60}
            />
          </Field>
        </FormGrid>

        {fornecedores !== null && fornecedorId === null ? (
          <ul className={styles.achados} role="listbox" aria-label="Fornecedores cadastrados">
            {fornecedores.length === 0 ? (
              <li className={styles.semFornecedor}>
                Nenhum fornecedor cadastrado com esse nome. Pode seguir com o nome digitado ou{' '}
                <Link href="/app/cadastros/fornecedores">cadastrar o fornecedor</Link>.
              </li>
            ) : (
              fornecedores.slice(0, 8).map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={styles.achado}
                    onClick={() => escolherFornecedor(f)}
                  >
                    <span>{f.tradeName ?? f.name}</span>
                    <small>{f.tradeName ? f.name : (f.address.city ?? '')}</small>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        <FormGrid>
          <Field label="Adicionar produto" span={12} hint="Enter mostra a lista">
            <Input
              id="compra-busca"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                if (e.target.value.trim().length < 2) setAchados([])
              }}
              onKeyDown={(e) => void aoTeclarNoProduto(e)}
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
          <Field label="Parcelas" span={6}>
            <Select
              id="compra-parcelas"
              value={quantasParcelas}
              onChange={(e) => {
                setQuantasParcelas(e.target.value)
                setParcelasEditadas(false)
              }}
            >
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>
                  {n === '1' ? 'Parcela única' : `${n} parcelas`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Primeiro vencimento" obrigatorio span={6}>
            <Input
              id="compra-vencimento"
              type="date"
              value={vencimento}
              onChange={(e) => {
                setVencimento(e.target.value)
                setParcelasEditadas(false)
              }}
            />
          </Field>
        </FormGrid>

        {total > 0 ? (
          <div className={styles.parcelas} aria-label="Parcelas">
            {parcelas.map((p, i) => (
              <div key={i} className={styles.parcela}>
                <span>{i + 1}ª</span>
                <Input
                  type="date"
                  aria-label={`Vencimento da parcela ${i + 1}`}
                  value={p.dueDate}
                  onChange={(e) => mudarParcela(i, 'dueDate', e.target.value)}
                />
                <Input
                  inputMode="decimal"
                  aria-label={`Valor da parcela ${i + 1}`}
                  value={p.valor}
                  onChange={(e) => mudarParcela(i, 'valor', e.target.value)}
                />
              </div>
            ))}
            <div className={styles.parcelasRodape}>
              {diferenca === 0 ? (
                <small>As parcelas fecham com o total.</small>
              ) : (
                <small className={styles.diferenca}>
                  {diferenca > 0 ? 'Faltam' : 'Sobram'} {formatCentavos(Math.abs(diferenca))} para
                  fechar com o total.
                </small>
              )}
              {parcelasEditadas ? (
                <Button type="button" variant="ghost" size="sm" onClick={recalcular}>
                  Recalcular iguais
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={styles.rodape}>
          <span>
            Total <strong>{formatCentavos(total)}</strong>
            {parcelas.length > 1 && total > 0
              ? ` · ${parcelas.length}x, última em ${formatDate(parcelas.at(-1)!.dueDate)}`
              : ''}
          </span>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Registrando...' : 'Registrar entrada'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
