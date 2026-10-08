'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarCatalogo,
  carregarResumoDoCatalogo,
  type NivelDeEstoque,
  type PaginaDoCatalogo,
  type ResumoDoCatalogo,
} from '@/lib/catalogo-api'
import { calcularMargem, confirmarImportacaoProdutos, nivelEstoque } from '@/lib/produtos-api'
import { formatMoney, formatPercent } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonCartoes } from '@/components/ui/Skeleton'
import { Button, ButtonLink } from '@/components/ui/Button'
import { IconBox, IconPlus, IconSearch, IconUpload } from '@/components/Icons'
import { COMANDOS_PRODUTOS } from '@/lib/comandos'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import ImportarPlanilha from '@/components/app/ImportarPlanilha'
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './produtos.module.css'

/**
 * O catalogo do lojista — NR-072, US-008.
 *
 * ## O catalogo e do SERVIDOR
 *
 * Esta tela mostrava `lib/mock-data`: o lojista cadastrava um produto e ele
 * nao aparecia aqui. Agora busca, filtro e paginacao acontecem no banco.
 *
 * Nao e so trocar a fonte. Filtrar no navegador exigiria trazer o catalogo
 * inteiro a cada abertura — e filtrar sobre a PAGINA daria respostas erradas
 * com cara de certas: "esgotados" mostraria os esgotados daqueles 24 itens, e
 * nao os da loja, que e exatamente o que esse filtro serve para achar.
 *
 * ## Os filtros de categoria e fornecedor sairam
 *
 * Nenhum dos dois existe do outro lado: `fornecedor` nao tem coluna em
 * `products`, e de `categoria` so existe o `category_id`, sem rota que devolva
 * o nome. Um `<select>` sobre dado que o servidor nao tem e um controle que
 * mente. Voltam quando houver o dado — ver `lib/catalogo-api.ts`.
 */

/** Campos que a planilha de produtos pode alimentar. */
const CAMPOS_PLANILHA = [
  {
    key: 'codigo',
    label: 'Código',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('codigo') || c === 'cod' || c.includes('sku'),
  },
  {
    key: 'descricao',
    label: 'Descrição',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('descri') || c.includes('produto') || c.includes('nome'),
  },
  {
    key: 'precoVenda',
    label: 'Preço de venda',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('venda') || c.includes('preco'),
  },
  {
    key: 'precoCusto',
    label: 'Preço de custo',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('custo'),
  },
  {
    key: 'ean',
    label: 'EAN',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('ean') || c.includes('barras') || c.includes('gtin'),
  },
  {
    key: 'ncm',
    label: 'NCM',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('ncm'),
  },
  {
    key: 'estoque',
    label: 'Estoque',
    obrigatorio: false,
    reconhece: (c: string) =>
      c.includes('estoque') || c.includes('quantidade') || c.includes('qtd'),
  },
]

/** Quantos produtos por pagina. */
const POR_PAGINA = 24

/** Espera antes de buscar o que esta sendo digitado. */
const ESPERA_DA_BUSCA_MS = 350

export default function ProdutosLista() {
  const [busca, setBusca] = useState('')
  const [filtroEstoque, setFiltroEstoque] = useState<NivelDeEstoque>('todos')
  /* Inativos sao um filtro a parte (NR-151): por padrao a lista so mostra o
     que esta a venda. */
  const [inativos, setInativos] = useState(false)
  const [pagina, setPagina] = useState(1)

  const [dados, setDados] = useState<PaginaDoCatalogo | null>(null)
  const [resumo, setResumo] = useState<ResumoDoCatalogo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [importandoPlanilha, setImportandoPlanilha] = useState(false)

  /**
   * A resposta que chegou fora de ordem e descartada.
   *
   * Digitar "cafe" dispara buscas encadeadas, e a de "caf" pode voltar depois
   * da de "cafe" numa rede lenta — a tela mostraria o resultado do termo
   * anterior sobre o campo com o termo atual. O contador diz qual pedido e o
   * mais recente.
   */
  const pedido = useRef(0)

  const buscar = useCallback(
    async (termo: string, estoque: NivelDeEstoque, soInativos: boolean, qualPagina: number) => {
      const meu = ++pedido.current

      const r = await carregarCatalogo({
        termo,
        estoque,
        ...(soInativos ? { situacao: 'inativos' as const } : {}),
        pagina: qualPagina,
        porPagina: POR_PAGINA,
      })

      if (meu !== pedido.current) return

      setCarregando(false)

      if (!r.ok) {
        setErro(r.erro)
        return
      }

      setErro(null)
      setDados(r.dados)
    },
    [],
  )

  /* O resumo fala do catalogo INTEIRO: nao depende de busca nem de pagina, e
     por isso e buscado uma vez e nao a cada tecla. */
  useEffect(() => {
    void (async () => {
      const r = await carregarResumoDoCatalogo()
      if (r.ok) setResumo(r.dados)
    })()
  }, [])

  /*
   * O efeito so AGENDA a busca. O `carregando` e ligado por quem mexeu no
   * filtro, e nao aqui: `setState` sincrono dentro de efeito encadeia renders,
   * e o estado inicial ja nasce `true` para a primeira carga.
   *
   * A espera existe porque, sem ela, "detergente" dispara dez consultas ao
   * banco para uma pergunta so — e as nove primeiras chegam para ser
   * descartadas.
   */
  useEffect(() => {
    const t = setTimeout(() => {
      void buscar(busca, filtroEstoque, inativos, pagina)
    }, ESPERA_DA_BUSCA_MS)

    return () => clearTimeout(t)
  }, [busca, filtroEstoque, inativos, pagina, buscar])

  /* Trocar busca ou filtro volta para a primeira pagina: continuar na pagina 4
     de um resultado que agora tem uma pagina mostraria vazio, e o lojista
     concluiria que a busca nao achou nada. */
  const mudarBusca = (valor: string) => {
    setCarregando(true)
    setBusca(valor)
    setPagina(1)
  }

  const mudarFiltro = (valor: NivelDeEstoque | 'inativos') => {
    setCarregando(true)
    setInativos(valor === 'inativos')
    setFiltroEstoque(valor === 'inativos' ? 'todos' : valor)
    setPagina(1)
  }

  const irParaPagina = (p: number) => {
    setCarregando(true)
    setPagina(p)
  }

  const limparFiltros = () => {
    setCarregando(true)
    setBusca('')
    setFiltroEstoque('todos')
    setInativos(false)
    setPagina(1)
  }

  const total = dados?.total ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA))
  const filtrando = busca.trim() !== '' || filtroEstoque !== 'todos' || inativos
  const filtroAtual = inativos ? 'inativos' : filtroEstoque

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle="Catálogo, preços e estoque"
        actions={
          <>
            {/* O arquivo leva os filtros aplicados — NR-155. */}
            <BotoesExportar
              lista="produtos"
              filtros={{
                q: busca.trim(),
                stock: filtroEstoque,
                ...(inativos ? { situacao: 'inativos' } : {}),
              }}
            />
            <Button variant="secondary" onClick={() => setImportandoPlanilha(true)}>
              <IconUpload size={17} />
              Importar planilha
            </Button>
            <ButtonLink href="/app/produtos/novo">
              <IconPlus size={17} />
              Novo produto
            </ButtonLink>
          </>
        }
      />

      <Resumo resumo={resumo} />

      <Card>
        {/* --- Busca e filtros --- */}
        <div className={styles.toolbar}>
          <label className={styles.busca}>
            <IconSearch size={17} />
            <input
              type="search"
              value={busca}
              onChange={(e) => mudarBusca(e.target.value)}
              placeholder="Buscar por código, descrição ou código de barras"
              aria-label="Buscar produto"
            />
          </label>
        </div>

        <div className={styles.filtros} role="group" aria-label="Filtro de estoque">
          {(
            [
              ['todos', 'Todos'],
              ['baixo', 'Estoque baixo'],
              ['esgotado', 'Esgotados'],
              ['inativos', 'Inativos'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={`${styles.filtro} ${filtroAtual === valor ? styles.filtroAtivo : ''}`}
              onClick={() => mudarFiltro(valor)}
              aria-pressed={filtroAtual === valor}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {erro !== null ? (
          <EmptyState
            title="Não deu para carregar o catálogo"
            description={erro}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  setErro(null)
                  void buscar(busca, filtroEstoque, inativos, pagina)
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : carregando && dados === null ? (
          <SkeletonCartoes />
        ) : total === 0 ? (
          filtrando ? (
            <EmptyState
              title="Nenhum produto encontrado"
              description="Nenhum resultado para esta busca ou filtro."
              action={
                <Button variant="secondary" onClick={limparFiltros}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nenhum produto cadastrado"
              description="Cadastre o primeiro produto ou traga o catálogo de uma planilha."
              mascote
              action={
                <div className={styles.emptyAcoes}>
                  <ButtonLink href="/app/produtos/novo">
                    <IconPlus size={17} />
                    Cadastrar o primeiro
                  </ButtonLink>
                  <Button variant="secondary" onClick={() => setImportandoPlanilha(true)}>
                    Importar planilha
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <>
            <ul className={styles.grid} aria-busy={carregando}>
              {(dados?.produtos ?? []).map((produto) => {
                const nivel = nivelEstoque(produto)
                const margem = calcularMargem(produto.precoCusto, produto.precoVenda)

                return (
                  <li key={produto.id}>
                    <Link href={`/app/produtos/${produto.id}`} className={styles.card}>
                      {/* Sem imagem cadastrada, mostra o icone em vez de um
                          quadrado vazio */}
                      <span className={styles.imagem} aria-hidden="true">
                        <IconBox size={22} />
                      </span>

                      <span className={styles.info}>
                        <span className={styles.codigo}>{produto.codigo}</span>
                        <strong className={styles.descricao}>{produto.descricao}</strong>
                        {produto.ean !== null ? (
                          <span className={styles.categoria}>{produto.ean}</span>
                        ) : null}
                      </span>

                      <span className={styles.numeros}>
                        <strong className={styles.preco}>{formatMoney(produto.precoVenda)}</strong>
                        {margem !== null ? (
                          <span className={styles.margem}>margem {formatPercent(margem)}</span>
                        ) : null}
                      </span>

                      <span className={styles.estoque}>
                        {!produto.ativo ? (
                          <Badge tone="neutral">Inativo</Badge>
                        ) : nivel === 'esgotado' ? (
                          <Badge tone="danger">Esgotado</Badge>
                        ) : nivel === 'baixo' ? (
                          <Badge tone="warning">{produto.estoque} un · baixo</Badge>
                        ) : (
                          <Badge tone="success">{produto.estoque} un</Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>

            <Paginacao
              pagina={pagina}
              ultimaPagina={ultimaPagina}
              total={total}
              nesta={dados?.produtos.length ?? 0}
              carregando={carregando}
              onIr={irParaPagina}
            />
          </>
        )}
      </Card>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={COMANDOS_PRODUTOS} />
      </div>

      {importandoPlanilha ? (
        <ImportarPlanilha
          titulo="Importar produtos"
          campos={CAMPOS_PLANILHA}
          /*
           * Vazio, e nao os codigos da pagina.
           *
           * A checagem marca como repetido o que ja existe na base. Com o
           * catalogo paginado, passar os 24 codigos carregados diria "novo"
           * para um produto que existe na pagina 3 — pior que nao checar,
           * porque parece checado. Repetido DENTRO da planilha continua sendo
           * detectado, e o codigo interno e unico por empresa no banco.
           */
          chavesExistentes={[]}
          chaveDuplicidade={(v) => (v.codigo ?? '').trim().toUpperCase()}
          validar={(v) => {
            if (!v.codigo?.trim()) return 'Codigo vazio'
            if (!v.descricao?.trim()) return 'Descricao vazia'
            const preco = Number(String(v.precoVenda ?? '').replace(',', '.'))
            if (!Number.isFinite(preco) || preco <= 0) return 'Preco de venda invalido'
            return null
          }}
          onConfirmar={confirmarImportacaoProdutos}
          onClose={() => setImportandoPlanilha(false)}
        />
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Os numeros do topo, sobre o catalogo INTEIRO.
 *
 * Nunca somados da pagina: "valor em estoque" calculado sobre 24 de 300
 * produtos erra por um fator de doze, e o lojista decide compra com ele.
 *
 * "Precisam de reposição" usa `belowMinimum`, que JA inclui os zerados —
 * somar as duas contagens contaria o produto zerado duas vezes.
 */
function Resumo({ resumo }: { resumo: ResumoDoCatalogo | null }) {
  if (resumo === null) {
    return (
      <div className="statRow">
        <Stat label="Produtos no catálogo" value="—" />
        <Stat label="Precisam de reposição" value="—" />
        <Stat label="Valor em estoque" value="—" hint="a preço de custo" />
      </div>
    )
  }

  return (
    <div className="statRow">
      <Stat label="Produtos no catálogo" value={String(resumo.total)} />
      <Stat
        label="Precisam de reposição"
        value={String(resumo.belowMinimum)}
        hint={
          resumo.belowMinimum
            ? `${resumo.outOfStock} ${resumo.outOfStock === 1 ? 'esgotado' : 'esgotados'}`
            : 'tudo em ordem'
        }
        tone={resumo.belowMinimum ? 'warning' : 'positive'}
      />
      <Stat
        label="Valor em estoque"
        value={formatMoney(resumo.stockValueCents / 100)}
        hint="a preço de custo"
      />
    </div>
  )
}

/**
 * O rodape da lista — "24 de 300" e os dois botoes.
 *
 * O total e o que impede o lojista de parar de procurar: uma pagina cheia, sem
 * ele, e indistinguivel do fim do catalogo.
 *
 * Some quando ha uma pagina so. Um paginador com os dois botoes desligados nao
 * informa nada e ocupa espaco.
 */
function Paginacao({
  pagina,
  ultimaPagina,
  total,
  nesta,
  carregando,
  onIr,
}: {
  pagina: number
  ultimaPagina: number
  total: number
  nesta: number
  carregando: boolean
  onIr: (p: number) => void
}) {
  if (ultimaPagina <= 1) {
    return (
      <p className={styles.paginacaoResumo}>
        {total} {total === 1 ? 'produto' : 'produtos'}
      </p>
    )
  }

  const primeiro = (pagina - 1) * POR_PAGINA + 1

  return (
    <div className={styles.paginacao}>
      <p className={styles.paginacaoResumo}>
        {primeiro}–{primeiro + nesta - 1} de {total}
      </p>

      <div className={styles.paginacaoBotoes}>
        <Button
          variant="secondary"
          onClick={() => onIr(pagina - 1)}
          disabled={pagina <= 1 || carregando}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          onClick={() => onIr(pagina + 1)}
          disabled={pagina >= ultimaPagina || carregando}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}
