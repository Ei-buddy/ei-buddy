import { ErroDeIntegracao } from '@na-regua/contracts'

/**
 * Cadastro da empresa da loja na Focus NFe, como revenda — NR-183.
 *
 * A EiBuddy tem UMA conta de revenda na Focus, com um token principal. Com ele,
 * a API de empresas cria (ou atualiza) a empresa emitente de cada loja,
 * levando certificado A1, CSC e dados cadastrais, e devolve os dois tokens com
 * que essa empresa emite: um de producao e um de homologacao.
 *
 * ## Tres coisas do provedor que moldam o codigo
 *
 * 1. **A API de empresas so existe em producao.** Mesmo para emitir em
 *    homologacao, a empresa e cadastrada em `api.focusnfe.com.br`; quem muda
 *    por ambiente e o token de EMISSAO que volta, nao o endereco do cadastro.
 * 2. **Autenticacao e a mesma do emissor:** Basic com o token da revenda como
 *    usuario e senha vazia.
 * 3. **CNPJ repetido na mesma revenda e recusado.** Por isso o id devolvido na
 *    criacao e guardado, e a segunda vez e `PUT /v2/empresas/{id}`.
 *
 * Os nomes dos campos sao os da API de empresas da Focus. Se algum divergir no
 * primeiro uso com a conta de revenda, o ajuste e so aqui: o resto do sistema
 * fala com `DadosDaEmpresaFocus`, que e nosso.
 */

const URL_DE_EMPRESAS = 'https://api.focusnfe.com.br/v2/empresas'

const TIMEOUT_PADRAO_MS = 30_000

/** Regime como a NFC-e numera: 1 = Simples Nacional, 3 = regime normal. */
export type RegimeTributarioFocus = 1 | 3

export type DadosDaEmpresaFocus = {
  /** Presente quando a empresa ja foi cadastrada: vira atualizacao. */
  readonly focusId?: string
  readonly razaoSocial: string
  readonly nomeFantasia?: string
  readonly cnpj: string
  readonly inscricaoEstadual?: string
  readonly inscricaoMunicipal?: string
  readonly regimeTributario: RegimeTributarioFocus
  readonly email?: string
  readonly telefone?: string
  readonly endereco: {
    readonly cep: string
    readonly logradouro: string
    readonly numero: string
    readonly complemento?: string
    readonly bairro: string
    readonly municipio: string
    readonly uf: string
  }
  /** Ausente numa atualizacao que nao troca o certificado. */
  readonly certificado?: { readonly base64: string; readonly senha: string }
  readonly cscProducao?: { readonly id: string; readonly codigo: string }
  readonly cscHomologacao?: { readonly id: string; readonly codigo: string }
}

export type EmpresaNaFocus = {
  readonly focusId: string
  readonly tokenProducao: string
  readonly tokenHomologacao: string
}

/**
 * Recusa da Focus ao cadastro — dado incompleto, certificado que nao abre,
 * CNPJ invalido. NAO e infraestrutura: e o que a tela precisa mostrar ao
 * lojista, e por isso e resultado, e nao excecao.
 */
export type ResultadoDoCadastro =
  | { readonly ok: true; readonly empresa: EmpresaNaFocus }
  | { readonly ok: false; readonly mensagem: string }

export type CadastroDeEmpresasFocus = {
  salvar(dados: DadosDaEmpresaFocus): Promise<ResultadoDoCadastro>
}

export type CadastroDeEmpresasFocusOptions = {
  readonly tokenDaRevenda: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

/** `00.000.000/0000-00` → `00000000000000`. A Focus quer so digitos. */
const digitos = (v: string): string => v.replace(/\D/g, '')

/** O corpo como a Focus nomeia os campos. Ausente nao vai — nao apaga do outro lado. */
export function corpoDaEmpresa(dados: DadosDaEmpresaFocus): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    nome: dados.razaoSocial,
    cnpj: digitos(dados.cnpj),
    regime_tributario: dados.regimeTributario,
    logradouro: dados.endereco.logradouro,
    numero: dados.endereco.numero,
    bairro: dados.endereco.bairro,
    municipio: dados.endereco.municipio,
    uf: dados.endereco.uf.toUpperCase(),
    cep: digitos(dados.endereco.cep),
    /* So NFC-e: e o documento do balcao. NF-e e NFS-e entram quando houver
       fluxo para elas, e habilitar antes faria a Focus cobrar por documento
       que o sistema nao emite. */
    habilita_nfce: true,
    habilita_nfe: false,
    habilita_nfse: false,
  }
  const opcional = (chave: string, valor: string | undefined) => {
    if (valor !== undefined && valor.trim() !== '') corpo[chave] = valor.trim()
  }
  opcional('nome_fantasia', dados.nomeFantasia)
  opcional(
    'inscricao_estadual',
    dados.inscricaoEstadual === undefined
      ? undefined
      : digitos(dados.inscricaoEstadual) || dados.inscricaoEstadual,
  )
  opcional('inscricao_municipal', dados.inscricaoMunicipal)
  opcional('email', dados.email)
  opcional('telefone', dados.telefone === undefined ? undefined : digitos(dados.telefone))
  opcional('complemento', dados.endereco.complemento)

  if (dados.certificado !== undefined) {
    corpo.arquivo_certificado_base64 = dados.certificado.base64
    corpo.senha_certificado = dados.certificado.senha
  }
  if (dados.cscProducao !== undefined) {
    corpo.id_token_nfce_producao = dados.cscProducao.id
    corpo.csc_nfce_producao = dados.cscProducao.codigo
  }
  if (dados.cscHomologacao !== undefined) {
    corpo.id_token_nfce_homologacao = dados.cscHomologacao.id
    corpo.csc_nfce_homologacao = dados.cscHomologacao.codigo
  }
  return corpo
}

/** A mensagem que a Focus deu, no formato que ela usar. */
function mensagemDaRecusa(status: number, corpo: Record<string, unknown>): string {
  const erros = corpo.erros
  if (Array.isArray(erros) && erros.length > 0) {
    return erros
      .map((e: { mensagem?: unknown; campo?: unknown }) =>
        typeof e.campo === 'string' && e.campo !== ''
          ? `${e.campo}: ${String(e.mensagem ?? '')}`
          : String(e.mensagem ?? ''),
      )
      .filter((m) => m !== '')
      .join('; ')
      .slice(0, 500)
  }
  if (typeof corpo.mensagem === 'string' && corpo.mensagem !== '')
    return corpo.mensagem.slice(0, 500)
  return `A Focus NFe recusou o cadastro (HTTP ${status}) e nao explicou o motivo.`
}

export function criarCadastroDeEmpresasFocus(
  opcoes: CadastroDeEmpresasFocusOptions,
): CadastroDeEmpresasFocus {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
  const autorizacao = `Basic ${Buffer.from(`${opcoes.tokenDaRevenda}:`, 'utf8').toString('base64')}`

  return {
    async salvar(dados) {
      const atualizando = dados.focusId !== undefined
      const url = atualizando
        ? `${URL_DE_EMPRESAS}/${encodeURIComponent(dados.focusId!)}`
        : URL_DE_EMPRESAS
      const metodo = atualizando ? 'PUT' : 'POST'

      const controle = new AbortController()
      const relogio = setTimeout(() => controle.abort(), timeoutMs)
      let status: number
      let texto: string
      try {
        const resposta = await buscar(url, {
          method: metodo,
          headers: { authorization: autorizacao, 'content-type': 'application/json' },
          body: JSON.stringify(corpoDaEmpresa(dados)),
          signal: controle.signal,
        })
        status = resposta.status
        texto = await resposta.text()
      } finally {
        clearTimeout(relogio)
      }

      let corpo: Record<string, unknown>
      try {
        corpo = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)
      } catch {
        throw new ErroDeIntegracao(
          `Focus NFe respondeu ${status} com corpo ilegivel no cadastro.`,
          {
            provedor: 'focusnfe',
            operacao: `${metodo} /v2/empresas`,
            status,
            resposta: texto.slice(0, 500),
          },
        )
      }

      /* 401/403 e o token da REVENDA errado ou sem permissao: configuracao da
         plataforma, nao do lojista. Lanca, para nao aparecer na tela da loja
         como se o certificado dela fosse o problema. */
      if (status === 401 || status === 403) {
        throw new ErroDeIntegracao('Token da revenda Focus NFe recusado.', {
          provedor: 'focusnfe',
          operacao: `${metodo} /v2/empresas`,
          status,
          resposta: texto.slice(0, 500),
        })
      }
      if (status >= 500) {
        throw new ErroDeIntegracao(`Focus NFe fora do ar no cadastro (HTTP ${status}).`, {
          provedor: 'focusnfe',
          operacao: `${metodo} /v2/empresas`,
          status,
          resposta: texto.slice(0, 500),
        })
      }
      if (status >= 400) return { ok: false, mensagem: mensagemDaRecusa(status, corpo) }

      const id = corpo.id ?? dados.focusId
      const tokenProducao = corpo.token_producao
      const tokenHomologacao = corpo.token_homologacao
      if (
        id === undefined ||
        typeof tokenProducao !== 'string' ||
        typeof tokenHomologacao !== 'string'
      ) {
        throw new ErroDeIntegracao('Focus NFe aceitou o cadastro mas nao devolveu id e tokens.', {
          provedor: 'focusnfe',
          operacao: `${metodo} /v2/empresas`,
          status,
          resposta: '(corpo omitido: pode conter token)',
        })
      }
      return {
        ok: true,
        empresa: { focusId: String(id), tokenProducao, tokenHomologacao },
      }
    },
  }
}

/** Falso para teste e desenvolvimento: aceita tudo e devolve tokens fixos. */
export function criarCadastroDeEmpresasFocusFalso(): CadastroDeEmpresasFocus & {
  readonly chamadas: DadosDaEmpresaFocus[]
} {
  const chamadas: DadosDaEmpresaFocus[] = []
  return {
    chamadas,
    async salvar(dados) {
      chamadas.push(dados)
      const id = dados.focusId ?? `focus-${digitos(dados.cnpj)}`
      return {
        ok: true,
        empresa: { focusId: id, tokenProducao: `prod-${id}`, tokenHomologacao: `homo-${id}` },
      }
    },
  }
}
