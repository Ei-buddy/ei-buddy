/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — MODULO DE PRODUTOS
 * ============================================================================
 *
 *  | Funcao                | Endpoint esperado              | Disparo           |
 *  |-----------------------|--------------------------------|-------------------|
 *  | salvarProduto         | POST/PUT /produtos[/:id]       | submit do form    |
 *  | confirmarImportacao   | POST /produtos/importar        | importar planilha |
 *
 * CATEGORIA E FORNECEDOR SAIRAM DESTA LISTA — `carregarSugestoes` fala com
 * `GET /produtos/sugestoes`, real desde a NR-072.1: nao e mais a mesma lista
 * de exemplo para toda loja, e sim categoria/fornecedor que o proprio
 * lojista ja digitou.
 *
 * BUSCA POR EAN, BUSCA ASSISTIDA DE NCM E IMPORTACAO DE XML DE COMPRA SAIRAM
 * DAQUI TAMBEM — nenhuma das tres tem requisito por tras (nem RF nem US as
 * pede) em lugar nenhum de `docs/produto/`. RF-017/018/019 sao sobre ler um
 * codigo de barras para achar ou criar produto no PROPRIO catalogo, o que
 * `POST /produtos` ja faz (recusa codigo repetido — ver `salvarProduto`).
 * Simular uma base de dado nacional de EAN, uma tabela de NCM ou uma
 * importacao de nota fiscal de compra era prometer uma integracao que nunca
 * foi pedida — o mesmo defeito do campo "Banco" que saiu do formulario de
 * titulo (NR-074).
 */

import { pedir, type Resultado } from './http'

/* -------------------------------------------------------------------------- */
/* Categorias e fornecedores                                                  */
/* -------------------------------------------------------------------------- */

export type SugestoesDoFormulario = {
  categorias: string[]
  fornecedores: string[]
}

/**
 * Categoria e fornecedor ja usados por algum produto da empresa.
 *
 * Ate aqui a lista era fixa (`Mercearia`, `Torrefacao Aurora`...), a mesma
 * para toda loja: quem vendia roupa via sugestao de mercearia, e quem digitava
 * um fornecedor novo nunca o via de novo na proxima visita ao formulario.
 */
export const carregarSugestoes = (): Promise<Resultado<SugestoesDoFormulario>> =>
  pedir<{ categories: string[]; suppliers: string[] }>('/api/produtos/sugestoes').then((r) =>
    r.ok
      ? { ok: true, dados: { categorias: r.dados.categories, fornecedores: r.dados.suppliers } }
      : r,
  )

/* -------------------------------------------------------------------------- */
/* Gravacao                                                                   */
/* -------------------------------------------------------------------------- */

export type DadosProduto = {
  id?: string
  descricao: string
  ean: string
  ncm: string
  /* Natureza da operacao — 5102 revenda comum, 5405 com ST ja recolhida. */
  cfop: string
  /* CSOSN, 3 digitos — o produto atende Simples Nacional e MEI. */
  situacaoTributaria: string
  categoria: string
  fornecedor: string
  precoCusto: number
  precoVenda: number
  estoque: number
  estoqueMinimo: number
  imagem: string | null
}

/**
 * Cadastra o produto — RF-017, RF-019.
 *
 * **Imagem nao e enviada** — precisa de upload de arquivo, que esta fora do
 * escopo aqui. Categoria e fornecedor vao como texto (`category`/`supplier`):
 * nenhum dos dois normaliza numa tabela propria, e a coluna do fornecedor foi
 * adicionada ao lado da de categoria (migration 0007).
 *
 * O fornecedor era digitado nesta tela e DESCARTADO em silencio: a coluna ja
 * existia no banco, mas o contrato de cadastro nunca a expunha, e o lojista
 * achava ter informado.
 */
/** Campo do contrato -> campo da tela, para o erro aparecer onde se digitou. */
const CAMPO_DA_TELA: Record<string, keyof DadosProduto> = {
  description: 'descricao',
  barcode: 'ean',
  salePriceCents: 'precoVenda',
  costPriceCents: 'precoCusto',
  ncm: 'ncm',
  cfop: 'cfop',
  taxSituationCode: 'situacaoTributaria',
  category: 'categoria',
  supplier: 'fornecedor',
  stock: 'estoque',
  minStock: 'estoqueMinimo',
}

export async function salvarProduto(
  dados: DadosProduto,
): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string; campos: Partial<Record<keyof DadosProduto, string>> }
> {
  let resposta: Response
  try {
    resposta = await fetch('/api/produtos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        description: dados.descricao,
        ...(dados.ean ? { barcode: dados.ean } : {}),
        unitOfMeasure: 'un',
        /* A tela trabalha em reais; o contrato exige centavos inteiros
           (RNF-044). A conversao acontece AQUI, na borda, e nao no meio. */
        salePriceCents: Math.round(dados.precoVenda * 100),
        costPriceCents: Math.round(dados.precoCusto * 100),
        /* Saldo inicial — vira movimento de estoque no servidor (RF-124). Ate
           aqui a tela pedia a quantidade e nao a enviava: o produto nascia
           zerado. */
        stock: Math.round(dados.estoque),
        minStock: Math.round(dados.estoqueMinimo),
        ...(dados.categoria.trim() === '' ? {} : { category: dados.categoria.trim() }),
        ...(dados.fornecedor.trim() === '' ? {} : { supplier: dados.fornecedor.trim() }),

        /*
         * Fiscais — RF-046.
         *
         * O NCM ja era digitado nesta tela e NAO era enviado: o lojista
         * preenchia e o sistema descartava em silencio, e a nota nao sairia por
         * falta de um dado que ele achava ter informado. Os tres vao juntos
         * agora, e so quando preenchidos — o cadastro continua rapido, e quem
         * cobra a falta e a emissao, que sabe dizer qual produto travou.
         */
        ...(dados.ncm.trim() === '' ? {} : { ncm: dados.ncm.trim() }),
        ...(dados.cfop.trim() === '' ? {} : { cfop: dados.cfop.trim() }),
        ...(dados.situacaoTributaria.trim() === ''
          ? {}
          : { taxSituationCode: dados.situacaoTributaria.trim() }),
      }),
    })
  } catch {
    return { ok: false, error: 'Sem conexao. Verifique sua internet.', campos: {} }
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    id?: string
    error?: { message?: string; fields?: { path?: string; message?: string }[] }
  }

  if (!resposta.ok) {
    /*
     * O servidor diz QUAL campo recusou (`fields`), e a tela jogava isso fora:
     * mostrava so "Confira os campos indicados" sem indicar campo nenhum — e o
     * lojista ficava sem saber o que corrigir.
     */
    const campos: Partial<Record<keyof DadosProduto, string>> = {}
    for (const f of corpo.error?.fields ?? []) {
      const campo = f.path === undefined ? undefined : CAMPO_DA_TELA[f.path]
      if (campo !== undefined && f.message) campos[campo] ??= f.message
    }
    const primeiro = Object.values(campos)[0]
    return {
      ok: false,
      error: primeiro ?? corpo.error?.message ?? 'Nao foi possivel salvar. Tente de novo.',
      campos,
    }
  }

  return { ok: true, id: corpo.id! }
}

/** O que o servidor recusou, linha a linha. */
export type LinhaRecusada = {
  /** Posicao na lista enviada, base zero. */
  index: number
  description: string
  reason: string
}

export type ResultadoDaImportacao = {
  importados: number
  recusadas: LinhaRecusada[]
}

/**
 * Converte um valor digitado — na planilha ou no formulario — para centavos.
 *
 * Aceita "12,90", "12.90", "R$ 12,90" e "1.234,56" — sao todos formatos que
 * saem de planilha em pt-BR, e o lojista digita os mesmos na tela. Devolve `null` quando nao da para ler, e nao zero:
 * zero passaria como preco valido e o produto entraria custando nada.
 */
export function centavosDaPlanilha(texto: string | undefined): number | null {
  const bruto = (texto ?? '').replace(/[^\d,.-]/g, '').trim()
  if (bruto === '') return null

  /*
   * A ULTIMA virgula ou ponto e o separador decimal; o resto e milhar. E o que
   * distingue "1.234,56" de "1.234" — no primeiro o ponto separa milhar, no
   * segundo tambem, e ler o ponto como decimal transformaria mil reais em um.
   */
  const ultimoSeparador = Math.max(bruto.lastIndexOf(','), bruto.lastIndexOf('.'))
  const temDecimal = ultimoSeparador >= 0 && bruto.length - ultimoSeparador - 1 <= 2

  const inteiro = temDecimal ? bruto.slice(0, ultimoSeparador) : bruto
  const decimal = temDecimal ? bruto.slice(ultimoSeparador + 1) : ''

  const numero = Number(`${inteiro.replace(/[.,]/g, '')}.${decimal.padEnd(2, '0') || '00'}`)

  return Number.isFinite(numero) ? Math.round(numero * 100) : null
}

/** Quantidade inteira de planilha. `null` quando nao da para ler. */
export function inteiroDaPlanilha(texto: string | undefined): number | null {
  const bruto = (texto ?? '').replace(/[^\d-]/g, '').trim()
  if (bruto === '') return null
  const n = Number(bruto)
  return Number.isInteger(n) ? n : null
}

/**
 * Importa o catalogo de verdade — NR-072, US-008.
 *
 * Ate agora esta funcao era `await delay(1200)`: a tela dizia "150 importados"
 * e nao gravava nada. Agora ela manda o lote para `POST /produtos/importacao` e
 * devolve o que o SERVIDOR aceitou — que e diferente do que o navegador achou
 * que era valido, e a diferenca e justamente o que o lojista precisa ver.
 *
 * Preco ilegivel vira recusa AQUI, com a linha identificada, em vez de virar
 * zero e passar. Um produto que entra custando nada e pior que um que nao
 * entra: o primeiro so aparece no dia em que alguem vende no prejuizo.
 */
export async function confirmarImportacaoProdutos(
  registros: Record<string, string>[],
): Promise<ResultadoDaImportacao> {
  const recusadas: LinhaRecusada[] = []
  const enviar: Record<string, unknown>[] = []
  /* Mapeia a posicao no lote enviado de volta para a posicao original, para o
     indice que o servidor devolver apontar para a linha certa da planilha. */
  const origem: number[] = []

  registros.forEach((r, index) => {
    const venda = centavosDaPlanilha(r.precoVenda)
    const custo = centavosDaPlanilha(r.precoCusto) ?? 0
    const descricao = (r.descricao ?? '').trim()

    if (descricao === '') {
      recusadas.push({ index, description: descricao, reason: 'Descricao vazia.' })
      return
    }
    if (venda === null) {
      recusadas.push({ index, description: descricao, reason: 'Preco de venda ilegivel.' })
      return
    }

    origem.push(index)
    enviar.push({
      description: descricao,
      unitOfMeasure: 'un',
      salePriceCents: venda,
      costPriceCents: custo,
      ...(r.ean?.trim() ? { barcode: r.ean.trim() } : {}),
      ...(r.ncm?.trim() ? { ncm: r.ncm.trim() } : {}),
      ...(inteiroDaPlanilha(r.estoque) !== null ? { stock: inteiroDaPlanilha(r.estoque) } : {}),
    })
  })

  if (enviar.length === 0) return { importados: 0, recusadas }

  const r = await pedir<{ imported: number; rejected: LinhaRecusada[] }>(
    '/api/produtos/importacao',
    { method: 'POST', body: JSON.stringify({ products: enviar }) },
  )

  if (!r.ok) {
    /* O lote inteiro caiu. Dizer "0 importados" com o motivo e melhor que
       lancar: a tela ja tem onde mostrar o relatorio, e a pessoa precisa saber
       que nada entrou. */
    return {
      importados: 0,
      recusadas: [
        ...recusadas,
        ...enviar.map((_, i) => ({
          index: origem[i]!,
          description: String(enviar[i]!.description),
          reason: r.erro,
        })),
      ],
    }
  }

  return {
    importados: r.dados.imported,
    recusadas: [
      ...recusadas,
      ...r.dados.rejected.map((rec) => ({ ...rec, index: origem[rec.index] ?? rec.index })),
    ],
  }
}

/* --------------------------------------------------------------------------
 * Estoque
 * --------------------------------------------------------------------------
 *
 * SAIU DAQUI. O saldo, a trilha e o ajuste vivem em `catalogo-api.ts`, contra
 * as rotas de verdade (`GET/POST /produtos/:id/estoque` e
 * `GET /produtos/:id/movimentos`).
 *
 * O que estava aqui era pior do que um mock parado: `ajustarEstoque` era um
 * `delay(700)` seguido de `return { ok: true }`, e a tela respondia "Ajuste
 * registrado no historico". O lojista corrigia a contagem, via a confirmacao,
 * e o saldo continuava errado — ele acreditava por causa da mensagem.
 * --------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* Utilitarios de tela                                                        */
/* -------------------------------------------------------------------------- */

export type NivelEstoque = 'normal' | 'baixo' | 'esgotado'

/**
 * Aceita QUALQUER coisa com saldo e minimo, e nao so `Produto`.
 *
 * O produto que vem da api nao tem `categoria` nem `fornecedor`, entao nao e
 * um `Produto` — e a regra "zerado e esgotado, abaixo do minimo e baixo" e a
 * mesma para os dois. Duplica-la faria a lista e o detalhe do produto
 * discordarem sobre a mesma etiqueta.
 */
export function nivelEstoque(produto: {
  readonly estoque: number
  readonly estoqueMinimo: number
}): NivelEstoque {
  if (produto.estoque <= 0) return 'esgotado'
  if (produto.estoque < produto.estoqueMinimo) return 'baixo'
  return 'normal'
}

/** Margem sobre o preco de venda, em porcentagem. */
export function calcularMargem(custo: number, venda: number): number | null {
  if (!venda || venda <= 0) return null
  return ((venda - custo) / venda) * 100
}
