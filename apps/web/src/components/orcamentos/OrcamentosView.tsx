'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { carregarCatalogo, type ProdutoDoCatalogo } from '@/lib/catalogo-api'
import {
  carregarOrcamentos,
  criarOrcamento,
  ROTULO_SITUACAO,
  vencido,
  type Orcamento,
} from '@/lib/orcamentos-api'
import { diaLocal, formatCentavos, formatDate, hoje } from '@/lib/format'
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
  Textarea,
} from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './orcamentos.module.css'

type Linha = { produto: ProdutoDoCatalogo; quantidade: string; preco: string }

const emTexto = (reais: number) => reais.toFixed(2).replace('.', ',')

const daquiA = (dias: number) => diaLocal(new Date(Date.now() + dias * 86_400_000))

/**
 * Orcamentos — NR-159.
 *
 * A proposta ao cliente: nao baixa estoque nem lanca financeiro. Os precos
 * ficam gravados. Na ficha, o orcamento sai no papel (imprimir), vai pelo
 * WhatsApp ou vira venda no PDV com o carrinho ja montado.
 */
export default function OrcamentosView() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[] | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarOrcamentos()
    if (r.ok) {
      setOrcamentos(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  const dia = hoje()

  return (
    <>
      <PageHeader
        title="Orçamentos"
        subtitle="Proposta ao cliente: não baixa estoque e vira venda quando ele aceitar"
      />

      <NovoOrcamentoForm
        aoCriar={(o) => {
          setToast({ msg: `Orçamento nº ${o.number} criado.`, tone: 'success' })
          void carregar()
        }}
        aoErrar={(msg) => setToast({ msg, tone: 'error' })}
      />

      <Card title="Orçamentos">
        {erro !== null ? (
          <EmptyState title="Não deu para carregar os orçamentos" description={erro} />
        ) : orcamentos === undefined ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : orcamentos.length === 0 ? (
          <p className={styles.vazio}>Nenhum orçamento ainda.</p>
        ) : (
          <ul className={styles.lista}>
            {orcamentos.map((o) => (
              <li key={o.id} className={styles.orcamento}>
                <span className={styles.info}>
                  <strong>
                    Nº {o.number}
                    {o.customerName ? ` · ${o.customerName}` : ''}
                  </strong>
                  <small>
                    {o.items.length} {o.items.length === 1 ? 'item' : 'itens'} · válido até{' '}
                    {formatDate(o.validUntil)}
                  </small>
                </span>
                <Badge
                  tone={
                    o.status === 'converted'
                      ? 'success'
                      : o.status === 'cancelled'
                        ? 'neutral'
                        : vencido(o, dia)
                          ? 'warning'
                          : 'info'
                  }
                >
                  {vencido(o, dia) ? 'Vencido' : ROTULO_SITUACAO[o.status]}
                </Badge>
                <strong className={styles.valor}>{formatCentavos(o.totalCents)}</strong>
                <ButtonLink href={`/app/orcamentos/${o.id}`} variant="secondary" size="sm">
                  Abrir
                </ButtonLink>
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

function NovoOrcamentoForm({
  aoCriar,
  aoErrar,
}: {
  aoCriar: (o: Orcamento) => void
  aoErrar: (m: string) => void
}) {
  const [cliente, setCliente] = useState('')
  const [validade, setValidade] = useState(daquiA(7))
  const [desconto, setDesconto] = useState('')
  const [obs, setObs] = useState('')
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
        : [...atual, { produto: p, quantidade: '1', preco: emTexto(p.precoVenda) }],
    )
    setBusca('')
    setAchados([])
  }

  const mudar = (id: string, campo: 'quantidade' | 'preco', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produto.id === id ? { ...l, [campo]: valor } : l)))

  const subtotal = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.preco)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)
  const descontoCents = desconto.trim() === '' ? 0 : (centavosDoTexto(desconto) ?? 0)

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (linhas.length === 0) return aoErrar('Inclua pelo menos um produto.')
    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitPriceCents = centavosDoTexto(l.preco)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return aoErrar(`Quantidade inválida em "${l.produto.descricao}".`)
      }
      if (unitPriceCents === null || unitPriceCents < 0) {
        return aoErrar(`Preço inválido em "${l.produto.descricao}".`)
      }
      itens.push({ productId: l.produto.id, quantity, unitPriceCents })
    }
    if (desconto.trim() !== '' && centavosDoTexto(desconto) === null) {
      return aoErrar('Desconto inválido.')
    }
    if (descontoCents > subtotal) return aoErrar('O desconto não pode passar do total.')

    setSalvando(true)
    const r = await criarOrcamento({
      ...(cliente.trim() ? { customerName: cliente.trim() } : {}),
      items: itens,
      validUntil: validade,
      ...(descontoCents > 0 ? { discountCents: descontoCents } : {}),
      ...(obs.trim() ? { notes: obs.trim() } : {}),
    })
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)

    setCliente('')
    setDesconto('')
    setObs('')
    setLinhas([])
    setValidade(daquiA(7))
    aoCriar(r.dados)
  }

  return (
    <Card title="Novo orçamento">
      <form onSubmit={criar} noValidate>
        <LegendaObrigatorio />
        <FormGrid>
          <Field label="Cliente" hint="opcional" span={6}>
            <Input
              id="orcamento-cliente"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome de quem pediu"
              maxLength={120}
            />
          </Field>
          <Field label="Válido até" obrigatorio span={6}>
            <Input
              id="orcamento-validade"
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
          </Field>
          <Field label="Adicionar produto" span={12}>
            <Input
              id="orcamento-busca"
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
          <ul className={styles.achados} aria-label="Produtos encontrados">
            {achados.map((p) => (
              <li key={p.id}>
                <button type="button" className={styles.achado} onClick={() => incluir(p)}>
                  <span>{p.descricao}</span>
                  <small>
                    {formatCentavos(Math.round(p.precoVenda * 100))} · estoque {p.estoque}
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
                  <small>estoque {l.produto.estoque}</small>
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
                  Preço un. (R$)
                  <Input
                    aria-label={`Preço unitário de ${l.produto.descricao}`}
                    inputMode="decimal"
                    value={l.preco}
                    onChange={(e) => mudar(l.produto.id, 'preco', e.target.value)}
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
          <Field label="Desconto (R$)" hint="opcional" span={4}>
            <Input
              id="orcamento-desconto"
              inputMode="decimal"
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Observações" hint="opcional" span={8}>
            <Textarea
              id="orcamento-obs"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Prazo de entrega, condições de pagamento..."
            />
          </Field>
        </FormGrid>

        <div className={styles.rodape}>
          <span>
            Total <strong>{formatCentavos(Math.max(subtotal - descontoCents, 0))}</strong>
          </span>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Criar orçamento'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
