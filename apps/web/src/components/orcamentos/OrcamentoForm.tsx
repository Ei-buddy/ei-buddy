'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { carregarCatalogo, type ProdutoDoCatalogo } from '@/lib/catalogo-api'
import { listarClientes, type ClienteDaLista } from '@/lib/clientes-api'
import {
  criarOrcamento,
  editarOrcamento,
  type NovoOrcamento,
  type Orcamento,
} from '@/lib/orcamentos-api'
import { diaLocal, formatCentavos } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { maskDocumento } from '@/lib/validation'
import { Card, Field, FormGrid, Input, LegendaObrigatorio, Textarea } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import styles from './orcamentos.module.css'

type Linha = {
  produtoId: string
  descricao: string
  estoque: number
  quantidade: string
  preco: string
}

type ClienteEscolhido = { id: string; nome: string }

const emTexto = (reais: number) => reais.toFixed(2).replace('.', ',')

const daquiA = (dias: number) => diaLocal(new Date(Date.now() + dias * 86_400_000))

const linhasDo = (o: Orcamento): Linha[] =>
  o.items.map((i) => ({
    produtoId: i.productId,
    descricao: i.description,
    estoque: i.stock,
    quantidade: String(i.quantity),
    preco: emTexto(i.unitPriceCents / 100),
  }))

/**
 * O formulario do orcamento — novo e edicao (achados do QA).
 *
 * O cliente e obrigatorio e vem do cadastro: Enter (ou foco) no campo mostra
 * a lista, como no PDV. O produto tambem: Enter mostra a lista, e com um so
 * achado ele ja entra. Com `orcamento`, o formulario edita aquele, aberto.
 */
export default function OrcamentoForm({
  orcamento,
  aoSalvar,
  aoErrar,
  aoCancelar,
}: {
  orcamento?: Orcamento
  aoSalvar: (o: Orcamento) => void
  aoErrar: (m: string) => void
  aoCancelar?: () => void
}) {
  const editando = orcamento !== undefined
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(
    orcamento?.customerId ? { id: orcamento.customerId, nome: orcamento.customerName ?? '' } : null,
  )
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clientes, setClientes] = useState<ClienteDaLista[] | null>(null)
  const [listaAberta, setListaAberta] = useState(false)
  const [validade, setValidade] = useState(orcamento?.validUntil ?? daquiA(7))
  const [desconto, setDesconto] = useState(
    orcamento && orcamento.discountCents > 0 ? emTexto(orcamento.discountCents / 100) : '',
  )
  const [obs, setObs] = useState(orcamento?.notes ?? '')
  const [linhas, setLinhas] = useState<Linha[]>(orcamento ? linhasDo(orcamento) : [])
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoDoCatalogo[]>([])
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) return
    const t = setTimeout(() => {
      void carregarCatalogo({ termo, estoque: 'todos', pagina: 1, porPagina: 8 }).then((r) =>
        setAchados(r.ok ? r.dados.produtos.filter((p) => p.ativo) : []),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  /* A lista de clientes abre com foco ou Enter, e segue a digitacao depois
     de ela parar, como no PDV: a resposta de "Mar" nao pode chegar depois da
     de "Maria" e pintar a lista errada. */
  useEffect(() => {
    if (!listaAberta) return
    const t = setTimeout(() => {
      void listarClientes({ termo: buscaCliente.trim() }).then((r) =>
        setClientes(r.ok ? r.dados.clientes.slice(0, 8) : []),
      )
    }, 200)
    return () => clearTimeout(t)
  }, [buscaCliente, listaAberta])

  function aoTeclarNoCliente(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') return setListaAberta(false)
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (listaAberta && clientes?.length === 1) escolherCliente(clientes[0]!)
    else setListaAberta(true)
  }

  function escolherCliente(c: ClienteDaLista) {
    setCliente({ id: c.id, nome: c.nome })
    setBuscaCliente('')
    setListaAberta(false)
    setClientes(null)
  }

  /** Enter no produto mostra a lista; com um achado so, ele ja entra. */
  async function aoTeclarNoProduto(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') return setAchados([])
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
    setAchados(r.ok ? r.dados.produtos.filter((p) => p.ativo) : [])
  }

  function incluir(p: ProdutoDoCatalogo) {
    setLinhas((atual) =>
      atual.some((l) => l.produtoId === p.id)
        ? atual
        : [
            ...atual,
            {
              produtoId: p.id,
              descricao: p.descricao,
              estoque: p.estoque,
              quantidade: '1',
              preco: emTexto(p.precoVenda),
            },
          ],
    )
    setBusca('')
    setAchados([])
  }

  const mudar = (id: string, campo: 'quantidade' | 'preco', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produtoId === id ? { ...l, [campo]: valor } : l)))

  const subtotal = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.preco)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)
  const descontoCents = desconto.trim() === '' ? 0 : (centavosDoTexto(desconto) ?? 0)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (cliente === null) {
      document.getElementById('orcamento-cliente')?.focus()
      return aoErrar('Escolha o cliente do orçamento.')
    }
    if (linhas.length === 0) return aoErrar('Inclua pelo menos um produto.')
    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitPriceCents = centavosDoTexto(l.preco)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return aoErrar(`Quantidade inválida em "${l.descricao}".`)
      }
      if (unitPriceCents === null || unitPriceCents < 0) {
        return aoErrar(`Preço inválido em "${l.descricao}".`)
      }
      itens.push({ productId: l.produtoId, quantity, unitPriceCents })
    }
    if (desconto.trim() !== '' && centavosDoTexto(desconto) === null) {
      return aoErrar('Desconto inválido.')
    }
    if (descontoCents > subtotal) return aoErrar('O desconto não pode passar do total.')

    const dados: NovoOrcamento = {
      customerId: cliente.id,
      items: itens,
      validUntil: validade,
      ...(descontoCents > 0 ? { discountCents: descontoCents } : {}),
      ...(obs.trim() ? { notes: obs.trim() } : {}),
    }
    setSalvando(true)
    const r = editando ? await editarOrcamento(orcamento.id, dados) : await criarOrcamento(dados)
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)

    if (!editando) {
      setCliente(null)
      setDesconto('')
      setObs('')
      setLinhas([])
      setValidade(daquiA(7))
    }
    aoSalvar(r.dados)
  }

  return (
    <Card title={editando ? `Editar orçamento nº ${orcamento.number}` : 'Novo orçamento'}>
      <form onSubmit={salvar} noValidate>
        <LegendaObrigatorio />
        <FormGrid>
          <Field
            label="Cliente"
            obrigatorio
            span={6}
            hint={cliente ? undefined : 'Enter mostra os cadastrados'}
          >
            {cliente ? (
              <div className={styles.clienteEscolhido}>
                <strong>{cliente.nome}</strong>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCliente(null)
                    setListaAberta(true)
                  }}
                >
                  Trocar
                </Button>
              </div>
            ) : (
              <Input
                id="orcamento-cliente"
                value={buscaCliente}
                onChange={(e) => {
                  setBuscaCliente(e.target.value)
                  setListaAberta(true)
                }}
                onFocus={() => setListaAberta(true)}
                onKeyDown={aoTeclarNoCliente}
                placeholder="Busque por nome ou CPF/CNPJ"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Válido até" obrigatorio span={6}>
            <Input
              id="orcamento-validade"
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
          </Field>
        </FormGrid>

        {cliente === null && listaAberta && clientes !== null ? (
          <ul className={styles.achados} role="listbox" aria-label="Clientes cadastrados">
            {clientes.length === 0 ? (
              <li className={styles.semCliente}>
                Nenhum cliente com esse nome.{' '}
                <Link href="/app/clientes/novo" target="_blank">
                  Cadastrar cliente
                </Link>{' '}
                e depois buscar de novo.
              </li>
            ) : (
              clientes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={styles.achado}
                    onClick={() => escolherCliente(c)}
                  >
                    <span>{c.nome}</span>
                    <small>
                      {c.documento
                        ? maskDocumento(
                            c.documento,
                            c.documento.length > 11 ? 'juridica' : 'fisica',
                          )
                        : (c.celular ?? 'sem documento')}
                    </small>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        <FormGrid>
          <Field label="Adicionar produto" span={12} hint="Enter mostra a lista">
            <Input
              id="orcamento-busca"
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
              <li key={l.produtoId} className={styles.linha}>
                <span className={styles.linhaNome}>
                  <strong>{l.descricao}</strong>
                  <small>estoque {l.estoque}</small>
                </span>
                <label className={styles.mini}>
                  Qtd.
                  <Input
                    aria-label={`Quantidade de ${l.descricao}`}
                    inputMode="numeric"
                    value={l.quantidade}
                    onChange={(e) => mudar(l.produtoId, 'quantidade', e.target.value)}
                  />
                </label>
                <label className={styles.mini}>
                  Preço un. (R$)
                  <Input
                    aria-label={`Preço unitário de ${l.descricao}`}
                    inputMode="decimal"
                    value={l.preco}
                    onChange={(e) => mudar(l.produtoId, 'preco', e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLinhas((a) => a.filter((x) => x.produtoId !== l.produtoId))}
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
          <span className={styles.botoes}>
            {aoCancelar ? (
              <Button type="button" variant="secondary" onClick={aoCancelar} disabled={salvando}>
                Descartar alterações
              </Button>
            ) : null}
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar orçamento'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  )
}
