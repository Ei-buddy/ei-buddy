'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ajustarEstoque,
  buscarProduto,
  carregarMovimentos,
  type CausaDoMovimento,
  type MovimentoDeEstoque,
  type ProdutoDaFicha,
} from '@/lib/catalogo-api'
import { calcularMargem, nivelEstoque } from '@/lib/produtos-api'
import { formatDate, formatMoney, formatPercent } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import styles from './detalhe.module.css'

/**
 * O que cada causa quer dizer na tela.
 *
 * A trilha guarda a CAUSA (`sale`, `adjustment`), e nao entrada/saida: e o que
 * permite responder "quanto sumiu por divergencia este mes?" sem cruzar com
 * venda. A tela traduz para quem le, sem perder a distincao.
 */
const CAUSA: Record<CausaDoMovimento, string> = {
  adjustment: 'Ajuste de inventário',
  sale: 'Venda',
  sale_cancelled: 'Venda cancelada',
  sale_returned: 'Devolução',
}

export default function ProdutoDetalhe({ produtoId }: { produtoId: string }) {
  const [produto, setProduto] = useState<ProdutoDaFicha | null>(null)
  const [movimentos, setMovimentos] = useState<MovimentoDeEstoque[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [novaQuantidade, setNovaQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ajustando, setAjustando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    /*
     * As duas chamadas em paralelo, e nao em sequencia: sao independentes, e
     * encadea-las somaria as duas latencias antes de a tela desenhar.
     */
    const [ficha, trilha] = await Promise.all([
      buscarProduto(produtoId),
      carregarMovimentos(produtoId),
    ])

    setCarregando(false)

    if (!ficha.ok) {
      setErro(ficha.erro)
      return
    }

    setErro(null)
    setProduto(ficha.dados)
    setNovaQuantidade(String(ficha.dados.estoque))

    /*
     * A trilha falhar NAO derruba a ficha. O cadastro e o que se veio ver; o
     * historico e complemento, e uma tela em branco por causa dele esconderia
     * preco, custo e saldo, que chegaram bem.
     */
    setMovimentos(trilha.ok ? trilha.dados : [])
  }, [produtoId])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function confirmarAjuste() {
    if (produto === null) return

    const quantidade = Number(novaQuantidade)
    if (novaQuantidade === '' || !Number.isInteger(quantidade) || quantidade < 0) {
      setToast({ msg: 'Informe a quantidade contada, em unidades inteiras.', tone: 'error' })
      return
    }

    setAjustando(true)
    const r = await ajustarEstoque(produto.id, quantidade, motivo)
    setAjustando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    setMotivo('')
    /*
     * O saldo novo vem da RESPOSTA (`saldoDepois`), e nao do que foi digitado.
     * Se uma venda tiver baixado uma unidade entre a contagem e o envio, o
     * numero certo e o que o servidor calculou — mostrar o digitado deixaria a
     * tela discordando do banco sem ninguem perceber.
     */
    setProduto({ ...produto, estoque: r.dados.saldoDepois })
    setNovaQuantidade(String(r.dados.saldoDepois))
    setMovimentos((atuais) => [r.dados, ...atuais])
    setToast({ msg: 'Ajuste registrado na trilha do produto.', tone: 'success' })
  }

  if (carregando) {
    return <PageHeader title="Carregando…" subtitle="Buscando a ficha do produto" />
  }

  if (produto === null) {
    return (
      <>
        <PageHeader title="Produto" />
        <Card>
          <EmptyState
            title="Nao foi possivel abrir a ficha"
            description={erro ?? 'Este produto não existe ou não é da sua loja.'}
            action={
              <Link href="/app/produtos" className={styles.verMais}>
                Voltar ao catalogo
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const nivel = nivelEstoque(produto)
  const margem = calcularMargem(produto.precoCusto, produto.precoVenda)

  const entradas = movimentos.filter((m) => m.delta > 0).reduce((acc, m) => acc + m.delta, 0)
  const saidas = movimentos.filter((m) => m.delta < 0).reduce((acc, m) => acc - m.delta, 0)

  return (
    <>
      <PageHeader
        title={produto.descricao}
        subtitle={`${produto.codigo} · ${produto.unidade}`}
        actions={
          <ButtonLink href="/app/produtos" variant="secondary">
            Voltar ao catalogo
          </ButtonLink>
        }
      />

      <div className="statRow">
        <Stat
          label="Estoque atual"
          value={`${produto.estoque} ${produto.unidade}`}
          hint={`mínimo ${produto.estoqueMinimo} ${produto.unidade}`}
          tone={nivel === 'normal' ? 'positive' : 'warning'}
        />
        <Stat label="Preco de venda" value={formatMoney(produto.precoVenda)} />
        <Stat
          label="Margem"
          value={margem === null ? '—' : formatPercent(margem)}
          hint={`custo ${formatMoney(produto.precoCusto)}`}
        />
        <Stat
          label="Valor em estoque"
          value={formatMoney(produto.estoque * produto.precoCusto)}
          hint="pelo preco de custo"
        />
      </div>

      <div className={styles.grid}>
        {/* --- Ficha --- */}
        <Card title="Ficha do produto">
          <dl className={styles.ficha}>
            <div>
              <dt>Codigo interno</dt>
              <dd>{produto.codigo}</dd>
            </div>
            <div>
              <dt>Codigo de barras</dt>
              {/*
                Sem EAN e o caso NORMAL, e nao uma pendencia: granel, produto
                sem embalagem e etiqueta amassada usam o codigo interno. Por
                isso "—" e nao um aviso.
              */}
              <dd>{produto.ean ?? '—'}</dd>
            </div>
            <div>
              <dt>Unidade</dt>
              <dd>{produto.unidade}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{produto.categoria ?? '—'}</dd>
            </div>
            <div>
              <dt>Fornecedor</dt>
              <dd>{produto.fornecedor ?? '—'}</dd>
            </div>
            <div>
              <dt>NCM</dt>
              <dd>{produto.ncm ?? '—'}</dd>
            </div>
            <div>
              <dt>CFOP</dt>
              <dd>{produto.cfop ?? '—'}</dd>
            </div>
            <div>
              <dt>CSOSN</dt>
              <dd>{produto.cst ?? '—'}</dd>
            </div>
            <div>
              <dt>Situacao</dt>
              <dd>
                {nivel === 'esgotado' ? (
                  <Badge tone="danger">Esgotado</Badge>
                ) : nivel === 'baixo' ? (
                  <Badge tone="warning">Estoque baixo</Badge>
                ) : (
                  <Badge tone="success">Normal</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* --- Ajuste manual --- */}
        <Card title="Ajustar estoque">
          <p className={styles.ajusteNota}>
            Use para corrigir a quantidade após contagem, avaria ou perda. Informe o que existe de
            fato na prateleira — a diferença quem calcula é o sistema. O motivo fica registrado na
            trilha, e e o que permite entender depois por que o saldo mudou sem venda nem compra.
          </p>

          <div className={styles.ajusteCampos}>
            <label className={styles.ajusteCampo}>
              <span>Quantidade contada</span>
              <input
                className={styles.ajusteInput}
                value={novaQuantidade}
                onChange={(e) => setNovaQuantidade(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </label>

            <label className={styles.ajusteCampo}>
              <span>Motivo</span>
              <input
                className={styles.ajusteInput}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Contagem de inventario"
              />
            </label>
          </div>

          <Button onClick={confirmarAjuste} disabled={ajustando}>
            {ajustando ? (
              <>
                <Spinner size={15} />
                Registrando...
              </>
            ) : (
              'Registrar ajuste'
            )}
          </Button>
        </Card>

        {/* --- Historico --- */}
        <Card title="Historico de estoque" className={styles.largo}>
          {movimentos.length === 0 ? (
            <EmptyState
              title="Nenhuma movimentacao ainda"
              description="Baixas por venda, devoluções e ajustes manuais aparecem aqui."
              mascote
            />
          ) : (
            <>
              <div className={styles.resumoMov}>
                <span>
                  Entradas <strong className={styles.entrada}>+{entradas}</strong>
                </span>
                <span>
                  Saidas <strong className={styles.saida}>-{saidas}</strong>
                </span>
                <span>
                  Saldo atual <strong>{produto.estoque}</strong>
                </span>
              </div>

              <ul className={styles.movimentos}>
                {movimentos.map((m) => (
                  <li key={m.id} className={styles.movimento}>
                    <span className={styles.movData}>{formatDate(m.quando)}</span>

                    <span className={styles.movPrincipal}>
                      <strong>{CAUSA[m.causa]}</strong>
                      {m.motivo ? <span>{m.motivo}</span> : null}
                    </span>

                    <span
                      className={`${styles.movQuantidade} ${
                        m.causa === 'adjustment'
                          ? styles.ajuste
                          : m.delta > 0
                            ? styles.entrada
                            : styles.saida
                      }`}
                    >
                      {m.delta > 0 ? '+' : ''}
                      {m.delta}
                    </span>

                    <span className={styles.movSaldo}>saldo {m.saldoDepois}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
