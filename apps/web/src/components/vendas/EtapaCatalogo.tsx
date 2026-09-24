'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  carregarCatalogo,
  type ProdutoDoCatalogo,
  paraItemCarrinho,
  buscarPorEan,
  subtotalCarrinho,
  subtotalItem,
  totalCarrinho,
  valorDesconto,
  type Desconto,
  type ItemCarrinho,
} from '@/lib/vendas-api'
import { formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState } from '@/components/ui/UI'
import { SkeletonCartoes } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import LeitorCodigoBarras from '@/components/app/LeitorCodigoBarras'
import { IconBarcode, IconBox, IconClose, IconSearch, IconTrash } from '@/components/Icons'
import styles from './vendas.module.css'
import { reaisDoTexto } from '@/lib/valor'

export default function EtapaCatalogo({
  itens,
  desconto,
  onItens,
  onDesconto,
  clienteNome,
  onVoltar,
  onAvancar,
  onCancelar,
}: {
  itens: ItemCarrinho[]
  desconto: Desconto | null
  onItens: (itens: ItemCarrinho[]) => void
  onDesconto: (desconto: Desconto | null) => void
  clienteNome: string
  onVoltar: () => void
  onAvancar: () => void
  onCancelar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [lendoCodigo, setLendoCodigo] = useState(false)
  const [carrinhoAberto, setCarrinhoAberto] = useState(false)
  const [dandoDesconto, setDandoDesconto] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  /*
   * O catalogo vem do SERVIDOR (RF-019), e nao de uma lista carregada inteira.
   *
   * Carregar tudo para filtrar aqui custa a primeira abertura da tela e piora
   * conforme a loja cresce — o contrario do que deveria. Uma mercearia tem
   * milhares de itens.
   *
   * Some com ele o filtro por CATEGORIA: a api guarda `category` texto e nao ha
   * cadastro de categoria com nome, entao o seletor so poderia mostrar uuid.
   * Filtro que o lojista nao consegue ler e pior que filtro nenhum — ele volta
   * quando as categorias existirem de verdade.
   */
  const [catalogo, setCatalogo] = useState<ProdutoDoCatalogo[]>([])
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(true)
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null)

  const buscarCatalogo = useCallback(async (termo: string) => {
    const r = await carregarCatalogo(termo)
    setCarregandoCatalogo(false)

    if (!r.ok) {
      setErroCatalogo(r.error)
      return
    }

    setErroCatalogo(null)
    setCatalogo(r.produtos)
  }, [])

  useEffect(() => {
    /*
     * Espera antes de perguntar: sem isto cada tecla vira um pedido, e o balcao
     * digita rapido. 300ms e curto o bastante para nao parecer travado e longo
     * o bastante para "cafe" ser uma consulta, e nao quatro.
     */
    const timer = setTimeout(() => {
      void (async () => {
        await buscarCatalogo(busca)
      })()
    }, 300)

    return () => clearTimeout(timer)
  }, [busca, buscarCatalogo])

  const subtotal = subtotalCarrinho(itens)
  const abatimento = valorDesconto(subtotal, desconto)
  const total = totalCarrinho(itens, desconto)
  const quantidadeTotal = itens.reduce((acc, i) => acc + i.quantidade, 0)

  /* ---------------------------------------------------------------- *
   * Carrinho
   * ---------------------------------------------------------------- */

  function adicionar(produtoId: string) {
    const produto = catalogo.find((p) => p.id === produtoId)
    if (!produto) return

    const existente = itens.find((i) => i.produtoId === produtoId)

    if (existente) {
      /* Nao trava a venda por estoque: o balcao pode ter mercadoria que o
         sistema ainda nao registrou. Avisa e deixa seguir. */
      if (existente.quantidade + 1 > existente.estoqueDisponivel) {
        setToast({
          msg: `Estoque de ${produto.descricao} é ${produto.estoque} un. Seguindo mesmo assim.`,
          tone: 'error',
        })
      }
      onItens(
        itens.map((i) => (i.produtoId === produtoId ? { ...i, quantidade: i.quantidade + 1 } : i)),
      )
      return
    }

    onItens([...itens, paraItemCarrinho(produto)])
  }

  function alterarQuantidade(produtoId: string, quantidade: number) {
    if (quantidade <= 0) {
      onItens(itens.filter((i) => i.produtoId !== produtoId))
      return
    }
    onItens(itens.map((i) => (i.produtoId === produtoId ? { ...i, quantidade } : i)))
  }

  async function lerCodigo(codigo: string) {
    const produto = await buscarPorEan(codigo)
    if (produto === null) {
      setToast({ msg: `Código ${codigo} não está no catálogo.`, tone: 'error' })
      return
    }

    /*
     * Entra no carrinho direto, sem depender de o produto estar na lista
     * visivel: o leitor acha um item que a busca atual nao mostra, e obrigar o
     * operador a limpar o filtro antes de bipar seria o oposto do que o leitor
     * existe para fazer.
     */
    const existente = itens.find((i) => i.produtoId === produto.id)
    onItens(
      existente
        ? itens.map((i) =>
            i.produtoId === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i,
          )
        : [...itens, paraItemCarrinho(produto)],
    )
    setToast({ msg: `${produto.descricao} adicionado.`, tone: 'success' })
  }

  /* ---------------------------------------------------------------- *
   * Orcamento em PDF
   * ---------------------------------------------------------------- */

  /**
   * Escapa texto para entrar em HTML.
   *
   * O orcamento e montado com `document.write` numa janela aberta por
   * `window.open('')`, e essa janela HERDA A ORIGEM do aplicativo. Descricao de
   * produto e nome de cliente vem do banco, digitados pelo lojista: um produto
   * chamado `<img src=x onerror=...>` executaria script com acesso a sessao de
   * quem esta usando o sistema.
   *
   * A CI encontrou isto — CodeQL `js/xss-through-dom`, severidade alta.
   *
   * Nao e um problema de dado "malicioso" apenas: descricao com `<` ou `&` no
   * nome — "Cabo HDMI 2m <novo>", "Pilha AA & AAA" — ja saia com a tabela
   * quebrada, e ninguem tinha notado porque o orcamento sai em janela separada.
   *
   * A troca de ordem importa: `&` primeiro, senao as entidades geradas pelas
   * outras substituicoes seriam escapadas de novo e apareceriam como `&amp;lt;`.
   */
  function escaparHtml(texto: string): string {
    return texto
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  /**
   * Gera o orcamento usando a impressao do navegador (imprimir para PDF).
   *
   * Sem dependencia nova e funciona hoje. Para envio por WhatsApp o PDF
   * precisa vir do servidor — SUBSTITUIR POR: GET /vendas/orcamento.pdf,
   * que devolve o arquivo pronto para compartilhar.
   */
  function gerarOrcamento() {
    const janela = window.open('', '_blank', 'width=800,height=900')
    if (!janela) {
      setToast({ msg: 'Libere as janelas pop-up para gerar o orçamento.', tone: 'error' })
      return
    }

    const linhas = itens
      .map(
        (i) =>
          `<tr><td>${escaparHtml(i.descricao)}</td>` +
          `<td style="text-align:center">${i.quantidade}</td>` +
          `<td style="text-align:right">${formatMoney(i.precoUnitario)}</td>` +
          `<td style="text-align:right">${formatMoney(subtotalItem(i))}</td></tr>`,
      )
      .join('')

    janela.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
        `<title>Orçamento</title><style>` +
        `body{font-family:system-ui,sans-serif;padding:32px;color:#131734}` +
        `h1{font-size:20px;margin:0 0 4px}` +
        `p{margin:0 0 18px;color:#4b5171;font-size:14px}` +
        `table{width:100%;border-collapse:collapse;font-size:14px}` +
        `th{text-align:left;border-bottom:2px solid #e6e8ef;padding:8px 6px;font-size:12px;text-transform:uppercase;color:#767c9b}` +
        `td{border-bottom:1px solid #e6e8ef;padding:8px 6px}` +
        `tfoot td{border:none;padding-top:10px;font-weight:600}` +
        `</style></head><body>` +
        `<h1>Orçamento</h1><p>${escaparHtml(clienteNome)} · ${new Date().toLocaleDateString('pt-BR')}</p>` +
        `<table><thead><tr><th>Produto</th><th style="text-align:center">Qtd</th>` +
        `<th style="text-align:right">Unitario</th><th style="text-align:right">Subtotal</th></tr></thead>` +
        `<tbody>${linhas}</tbody><tfoot>` +
        `<tr><td colspan="3" style="text-align:right">Subtotal</td><td style="text-align:right">${formatMoney(subtotal)}</td></tr>` +
        (abatimento > 0
          ? `<tr><td colspan="3" style="text-align:right">Desconto</td><td style="text-align:right">- ${formatMoney(abatimento)}</td></tr>`
          : '') +
        `<tr><td colspan="3" style="text-align:right;font-size:16px">Total</td><td style="text-align:right;font-size:16px">${formatMoney(total)}</td></tr>` +
        `</tfoot></table>` +
        `<p style="margin-top:24px;font-size:12px">Este orçamento não é documento fiscal.</p>` +
        `</body></html>`,
    )
    janela.document.close()
    janela.focus()
    janela.print()
  }

  return (
    <>
      <div className={styles.pdvGrid}>
        {/* ============ Catalogo ============ */}
        <Card className={styles.catalogoCard}>
          <div className={styles.catalogoBarra}>
            <label className={styles.busca}>
              <IconSearch size={17} />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto"
                aria-label="Buscar produto"
              />
            </label>

            {/* Botao grande: no balcao, ler o codigo e o caminho mais usado */}
            <Button onClick={() => setLendoCodigo(true)}>
              <IconBarcode size={18} />
              Ler codigo
            </Button>
          </div>

          {carregandoCatalogo ? (
            <SkeletonCartoes />
          ) : erroCatalogo !== null ? (
            <EmptyState
              title="Nao deu para carregar o catalogo"
              description={erroCatalogo}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCarregandoCatalogo(true)
                    setErroCatalogo(null)
                    void buscarCatalogo(busca)
                  }}
                >
                  Tentar de novo
                </Button>
              }
            />
          ) : catalogo.length === 0 ? (
            busca.trim() === '' ? (
              <EmptyState
                title="Nenhum produto encontrado"
                description="Cadastre produtos para vender pelo balcão."
                mascote
              />
            ) : (
              <EmptyState
                title="Nenhum produto encontrado"
                description="Tente outro termo, ou leia o código de barras."
              />
            )
          ) : (
            <ul className={styles.catalogo}>
              {catalogo.map((p) => {
                /* O catalogo da api nao traz `estoqueMinimo`; sem ele o nivel
                   e so "tem ou nao tem". Mostrar um alerta de minimo inventado
                   seria pior que nao mostrar. */
                const nivel = p.estoque <= 0 ? 'zerado' : 'ok'
                const noCarrinho = itens.find((i) => i.produtoId === p.id)

                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`${styles.produto} ${noCarrinho ? styles.produtoNoCarrinho : ''}`}
                      onClick={() => adicionar(p.id)}
                    >
                      <span className={styles.produtoImagem} aria-hidden="true">
                        <IconBox size={20} />
                      </span>

                      <span className={styles.produtoInfo}>
                        <strong>{p.descricao}</strong>
                        <span>{p.codigo}</span>
                      </span>

                      <span className={styles.produtoNumeros}>
                        <strong>{formatMoney(p.precoVenda)}</strong>
                        {nivel === 'zerado' ? (
                          <Badge tone="danger">Sem estoque</Badge>
                        ) : (
                          <span className={styles.produtoEstoque}>{p.estoque} un</span>
                        )}
                      </span>

                      {noCarrinho ? (
                        <span className={styles.produtoBadge}>{noCarrinho.quantidade}</span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* ============ Carrinho ============ */}
        <aside className={`${styles.carrinho} ${carrinhoAberto ? styles.carrinhoAberto : ''}`}>
          <header className={styles.carrinhoCabecalho}>
            <h2 className={styles.carrinhoTitulo}>
              Carrinho
              {quantidadeTotal > 0 ? (
                <span className={styles.carrinhoContador}>{quantidadeTotal}</span>
              ) : null}
            </h2>
            <button
              type="button"
              className={styles.carrinhoFechar}
              onClick={() => setCarrinhoAberto(false)}
              aria-label="Fechar carrinho"
            >
              <IconClose size={18} />
            </button>
          </header>

          {itens.length === 0 ? (
            <div className={styles.carrinhoVazio}>
              <IconBox size={28} />
              <p>Nada no carrinho ainda</p>
              <span>Toque em um produto ou leia o código de barras.</span>
            </div>
          ) : (
            <ul className={styles.carrinhoItens}>
              {itens.map((i) => (
                <li key={i.produtoId} className={styles.itemCarrinho}>
                  <span className={styles.itemNome}>
                    <strong>{i.descricao}</strong>
                    <span>{formatMoney(i.precoUnitario)} un</span>
                  </span>

                  <span className={styles.itemQuantidade}>
                    <button
                      type="button"
                      className={styles.qtdBotao}
                      onClick={() => alterarQuantidade(i.produtoId, i.quantidade - 1)}
                      aria-label={`Diminuir ${i.descricao}`}
                    >
                      −
                    </button>
                    <input
                      className={styles.qtdInput}
                      value={i.quantidade}
                      onChange={(e) =>
                        alterarQuantidade(
                          i.produtoId,
                          Number(e.target.value.replace(/\D/g, '')) || 0,
                        )
                      }
                      inputMode="numeric"
                      aria-label={`Quantidade de ${i.descricao}`}
                    />
                    <button
                      type="button"
                      className={styles.qtdBotao}
                      onClick={() => alterarQuantidade(i.produtoId, i.quantidade + 1)}
                      aria-label={`Aumentar ${i.descricao}`}
                    >
                      +
                    </button>
                  </span>

                  <span className={styles.itemSubtotal}>{formatMoney(subtotalItem(i))}</span>

                  <button
                    type="button"
                    className={styles.itemExcluir}
                    onClick={() => alterarQuantidade(i.produtoId, 0)}
                    aria-label={`Remover ${i.descricao}`}
                  >
                    <IconTrash size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* --- Resumo --- */}
          <div className={styles.resumo}>
            <div className={styles.resumoLinha}>
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            {abatimento > 0 ? (
              <div className={styles.resumoLinha}>
                <span>
                  Desconto
                  {desconto?.tipo === 'percentual' ? ` (${desconto.quantia}%)` : ''}
                </span>
                <span className={styles.resumoDesconto}>- {formatMoney(abatimento)}</span>
              </div>
            ) : null}
            <div className={`${styles.resumoLinha} ${styles.resumoTotal}`}>
              <span>Total</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          </div>

          {/* --- Acoes --- */}
          <div className={styles.carrinhoAcoes}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDandoDesconto(true)}
              disabled={itens.length === 0}
            >
              Dar desconto
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={gerarOrcamento}
              disabled={itens.length === 0}
            >
              Enviar orçamento
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setCancelando(true)}
              disabled={itens.length === 0}
            >
              Cancelar venda
            </Button>
          </div>

          <Button block onClick={onAvancar} disabled={itens.length === 0}>
            Finalizar · {formatMoney(total)}
          </Button>

          <Button variant="ghost" block onClick={onVoltar}>
            Trocar cliente
          </Button>
        </aside>
      </div>

      {/* Barra fixa no mobile para abrir o carrinho */}
      <button
        type="button"
        className={styles.carrinhoBarra}
        onClick={() => setCarrinhoAberto(true)}
      >
        <span className={styles.carrinhoBarraContador}>{quantidadeTotal}</span>
        <span>Ver carrinho</span>
        <strong>{formatMoney(total)}</strong>
      </button>

      {lendoCodigo ? (
        <LeitorCodigoBarras onDetectar={lerCodigo} onClose={() => setLendoCodigo(false)} />
      ) : null}

      {dandoDesconto ? (
        <DialogoDesconto
          subtotal={subtotal}
          atual={desconto}
          onAplicar={(d) => {
            onDesconto(d)
            setDandoDesconto(false)
            setToast({
              msg: d ? 'Desconto aplicado.' : 'Desconto removido.',
              tone: 'success',
            })
          }}
          onCancelar={() => setDandoDesconto(false)}
        />
      ) : null}

      {cancelando ? (
        <ConfirmarDialog
          titulo="Cancelar a venda"
          descricao="O carrinho sera esvaziado e o fluxo volta para a escolha do cliente. Nada e gravado."
          tom="perigo"
          rotuloConfirmar="Cancelar venda"
          detalhe={
            <div className={styles.cancelarDetalhe}>
              <strong>
                {quantidadeTotal} item(ns) · {formatMoney(total)}
              </strong>
              <span>{clienteNome}</span>
            </div>
          }
          onConfirmar={() => {
            setCancelando(false)
            onCancelar()
          }}
          onCancelar={() => setCancelando(false)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Desconto
 * ================================================================== */

function DialogoDesconto({
  subtotal,
  atual,
  onAplicar,
  onCancelar,
}: {
  subtotal: number
  atual: Desconto | null
  onAplicar: (desconto: Desconto | null) => void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState<'percentual' | 'valor'>(atual?.tipo ?? 'percentual')
  const [quantia, setQuantia] = useState(atual ? String(atual.quantia).replace('.', ',') : '')

  const numero = reaisDoTexto(quantia)
  const abatimento = valorDesconto(subtotal, { tipo, quantia: numero })
  const novoTotal = subtotal - abatimento

  const invalido =
    numero <= 0 ||
    (tipo === 'percentual' && numero > 100) ||
    (tipo === 'valor' && numero > subtotal)

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={onCancelar}
        aria-label="Fechar"
      />

      <div
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desconto"
      >
        <h2 id="desconto" className={styles.dialogTitulo}>
          Dar desconto
        </h2>

        <div className={styles.tipoToggle} role="group" aria-label="Tipo de desconto">
          <button
            type="button"
            className={`${styles.tipoBotao} ${tipo === 'percentual' ? styles.tipoAtivo : ''}`}
            onClick={() => setTipo('percentual')}
            aria-pressed={tipo === 'percentual'}
          >
            Percentual
          </button>
          <button
            type="button"
            className={`${styles.tipoBotao} ${tipo === 'valor' ? styles.tipoAtivo : ''}`}
            onClick={() => setTipo('valor')}
            aria-pressed={tipo === 'valor'}
          >
            Valor fixo
          </button>
        </div>

        <label className={styles.campo}>
          <span>{tipo === 'percentual' ? 'Percentual (%)' : 'Valor (R$)'}</span>
          <input
            className={`${styles.input} ${styles.inputGrande}`}
            value={quantia}
            onChange={(e) => setQuantia(e.target.value)}
            placeholder={tipo === 'percentual' ? '10' : '0,00'}
            inputMode="decimal"
            autoFocus
          />
        </label>

        <div className={styles.descontoPrevia}>
          <div>
            <span>Desconto</span>
            <strong>{formatMoney(abatimento)}</strong>
          </div>
          <div>
            <span>Novo total</span>
            <strong>{formatMoney(novoTotal)}</strong>
          </div>
        </div>

        {tipo === 'percentual' && numero > 100 ? (
          <p className={styles.erro} role="alert">
            O desconto nao pode passar de 100%.
          </p>
        ) : null}
        {tipo === 'valor' && numero > subtotal ? (
          <p className={styles.erro} role="alert">
            O desconto nao pode passar do subtotal.
          </p>
        ) : null}

        <div className={styles.dialogAcoes}>
          {atual ? (
            <Button variant="secondary" onClick={() => onAplicar(null)}>
              Remover desconto
            </Button>
          ) : (
            <Button variant="secondary" onClick={onCancelar}>
              Cancelar
            </Button>
          )}
          <Button onClick={() => onAplicar({ tipo, quantia: numero })} disabled={invalido}>
            Aplicar
          </Button>
        </div>
      </div>
    </div>
  )
}
