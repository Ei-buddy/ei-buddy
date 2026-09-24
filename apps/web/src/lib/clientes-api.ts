/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — MODULO DE CLIENTES
 * ============================================================================
 *
 *  | Funcao             | Endpoint esperado             | Disparo             |
 *  |--------------------|-------------------------------|---------------------|
 *  | buscarCpf          | GET  /pessoas/cpf/:cpf        | botao "Buscar dados"|
 *  | salvarCliente      | POST/PUT /clientes[/:id]      | submit do form      |
 *  | confirmarImportacao| POST /clientes/importar       | confirmacao da previa|
 *
 * SOBRE A CONSULTA DE CPF: diferente do CNPJ, dado de CPF nao e publico.
 * A consulta so pode existir se houver base contratada e base legal (LGPD)
 * para isso, e deve ficar no backend com registro de quem consultou o que.
 * O front apenas oferece o botao — se o backend responder 403, a tela trata
 * como "consulta indisponivel" e o cadastro segue manual.
 */

import { pedir, type Resultado } from './http'
import type { LinhaRecusada, ResultadoDaImportacao } from './produtos-api'
import type { Cliente } from './types'

/* -------------------------------------------------------------------------- */
/* Consulta de CPF                                                            */
/* -------------------------------------------------------------------------- */

export type CpfResult =
  { ok: true; nome: string } | { ok: false; error: string; indisponivel?: boolean }

/**
 * Consulta de CPF — sempre indisponivel, de proposito.
 *
 * Diferente do CNPJ, dado de CPF nao e publico: so existe com base contratada
 * e base legal (LGPD), e nenhuma das duas existe hoje. A tela diz isso e o
 * cadastro segue manual. Antes esta funcao devolvia nomes ficticios ("Joana
 * Ribeiro") para dois CPFs de exemplo, como se a consulta existisse.
 */
export async function buscarCpf(cpf: string): Promise<CpfResult> {
  if (cpf.replace(/\D/g, '').length !== 11) {
    return { ok: false, error: 'Informe o CPF completo antes de buscar.' }
  }
  return {
    ok: false,
    error: 'Consulta de CPF indisponível. Preencha o nome manualmente.',
    indisponivel: true,
  }
}

/* -------------------------------------------------------------------------- */
/* Gravacao                                                                   */
/* -------------------------------------------------------------------------- */

export type DadosCliente = {
  id?: string
  tipoPessoa: 'fisica' | 'juridica'
  documento: string
  nome: string
  /** Obrigatorio quando `tipoPessoa` e `juridica` — o contrato recusa sem. */
  nomeFantasia: string
  ddd: string
  celular: string
  email: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

/** Cliente parecido, quando a api encontra telefone ou documento repetido. */
export type CandidatoCliente = {
  id: string
  name: string
  phone: string | null
  document: string | null
}

export type ResultadoSalvarCliente =
  | { ok: true; id: string }
  | { ok: false; error: string }
  /**
   * Duplicado NAO e erro — RF-010.
   *
   * A api devolve os candidatos em vez de recusar, porque a decisao de reusar o
   * existente e de quem esta no balcao, com o cliente na frente. Um terceiro
   * desfecho no tipo obriga a tela a tratar isso, em vez de mostrar "erro ao
   * salvar" para uma situacao que nao e erro.
   */
  | { ok: false; duplicados: CandidatoCliente[] }

/**
 * Monta o endereco para a api — ou nada, quando o formulario veio em branco.
 *
 * Campo vazio vira AUSENTE e nao `''`: o contrato valida CEP e UF por formato,
 * e uma string vazia seria recusada como "CEP invalido" por quem simplesmente
 * nao quis preencher. E `address` inteiro ausente e o que diz "nao informou",
 * em vez de sete campos vazios que parecem um endereco apagado.
 */
function enderecoParaApi(dados: DadosCliente): Record<string, string> | undefined {
  const campos = {
    zipCode: dados.cep.replace(/\D/g, ''),
    street: dados.logradouro.trim(),
    number: dados.numero.trim(),
    complement: dados.complemento.trim(),
    district: dados.bairro.trim(),
    city: dados.cidade.trim(),
    state: dados.uf.trim().toUpperCase(),
  }

  const preenchidos = Object.entries(campos).filter(([, v]) => v !== '')

  return preenchidos.length === 0 ? undefined : Object.fromEntries(preenchidos)
}

/**
 * Cadastra o cliente — RF-009, RF-010.
 *
 * O endereco vai junto desde a migration 0019. Antes dela nao havia coluna
 * para guardar: o formulario coletava CEP, logradouro, numero, bairro, cidade
 * e UF, e os sete campos eram descartados no caminho — o lojista digitava o
 * endereco e ele sumia sem nenhum aviso.
 */
export async function salvarCliente(
  dados: DadosCliente,
  /**
   * Segunda passada, depois de a pessoa ter visto os parecidos e decidido que
   * e outra pessoa — RF-010.
   *
   * Parametro proprio, e nao um `id` sintetico. As duas telas que chamam isto
   * mandavam `id: 'permitir-duplicado'` e `id: 'confirmado'` para ligar a
   * mesma coisa, e `id` significa "edite este cliente": quem lesse a chamada
   * entenderia o contrario do que ela faz. E o dia em que a edicao existir de
   * verdade, os dois usos colidem.
   */
  opcoes: { permitirDuplicado?: boolean } = {},
): Promise<ResultadoSalvarCliente> {
  const permitirDuplicado = opcoes.permitirDuplicado === true ? '?duplicado=permitir' : ''
  const address = enderecoParaApi(dados)

  let resposta: Response
  try {
    resposta = await fetch(`/api/clientes${permitirDuplicado}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        name: dados.nome,
        ...(dados.nomeFantasia ? { tradeName: dados.nomeFantasia } : {}),
        ...(dados.documento ? { document: dados.documento } : {}),
        ...(dados.celular ? { phone: `${dados.ddd}${dados.celular}`.replace(/\D/g, '') } : {}),
        ...(dados.email ? { email: dados.email } : {}),
        ...(address === undefined ? {} : { address }),
      }),
    })
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    id?: string
    candidates?: CandidatoCliente[]
    error?: { message?: string }
  }

  if (resposta.status === 409 && corpo.candidates !== undefined) {
    return { ok: false, duplicados: corpo.candidates }
  }

  if (!resposta.ok) {
    return { ok: false, error: corpo.error?.message ?? 'Nao foi possivel salvar. Tente de novo.' }
  }

  return { ok: true, id: corpo.id! }
}

/* -------------------------------------------------------------------------- */
/* Dados vinculados ao cliente (detalhe)                                      */
/* -------------------------------------------------------------------------- */

export type CompraCliente = {
  id: string
  numero: string
  data: string
  valor: number
  itens: number
  formaPagamento: string
}

export type PendenciaCliente = {
  id: string
  referente: string
  vencimento: string
  valor: number
  status: 'aberto' | 'vencido' | 'parcial'
}

export type TipoDeContato = 'ligacao' | 'whatsapp' | 'visita' | 'observacao'

export type ContatoCliente = {
  id: string
  /** O dia do FATO, em AAAA-MM-DD. Nao e o dia do registro. */
  data: string
  tipo: TipoDeContato
  descricao: string
}

/**
 * O vocabulario da api e ingles; o da tela, portugues — NR-072.
 *
 * A traducao mora aqui e nao no componente porque ela e ida E volta: a lista
 * chega em ingles e o lancamento sai em ingles, e duas tabelas em lugares
 * diferentes divergiriam na primeira chave nova.
 */
const TIPO_DA_API: Record<string, TipoDeContato> = {
  call: 'ligacao',
  whatsapp: 'whatsapp',
  visit: 'visita',
  note: 'observacao',
}

const TIPO_PARA_API: Record<TipoDeContato, string> = {
  ligacao: 'call',
  whatsapp: 'whatsapp',
  visita: 'visit',
  observacao: 'note',
}

type ContatoDaApi = {
  id: string
  kind: string
  description: string
  happenedOn: string
}

const paraContato = (c: ContatoDaApi): ContatoCliente => ({
  id: c.id,
  data: c.happenedOn,
  /* Chave desconhecida vira "observacao" em vez de quebrar a ficha: a api pode
     ganhar um tipo novo (e-mail, balcao) antes de a tela aprender a desenha-lo,
     e uma lista que nao abre e pior que um rotulo generico. */
  tipo: TIPO_DA_API[c.kind] ?? 'observacao',
  descricao: c.description,
})

/** O historico da ficha — RF-011. */
export async function contatosDoCliente(clienteId: string): Promise<Resultado<ContatoCliente[]>> {
  const r = await pedir<{ contacts: ContatoDaApi[] }>(
    `/api/clientes/${encodeURIComponent(clienteId)}/contatos`,
  )

  return r.ok ? { ok: true, dados: r.dados.contacts.map(paraContato) } : r
}

/**
 * Lanca um contato — RF-011.
 *
 * `data` opcional: ausente, a api usa o dia de hoje pelo relogio DELA. A tela
 * poderia mandar o do navegador, mas o relogio do navegador e do usuario — e
 * um cliente com a data errada gravaria o contato no ano que vem.
 */
export async function lancarContato(
  clienteId: string,
  contato: { tipo: TipoDeContato; descricao: string; data?: string },
): Promise<Resultado<ContatoCliente>> {
  const r = await pedir<ContatoDaApi>(`/api/clientes/${encodeURIComponent(clienteId)}/contatos`, {
    method: 'POST',
    body: JSON.stringify({
      kind: TIPO_PARA_API[contato.tipo],
      description: contato.descricao,
      ...(contato.data === undefined ? {} : { happenedOn: contato.data }),
    }),
  })

  return r.ok ? { ok: true, dados: paraContato(r.dados) } : r
}

/* -------------------------------------------------------------------------- */
/* A ficha — RF-011                                                           */
/* -------------------------------------------------------------------------- */

export type EnderecoDoCliente = {
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

/**
 * O cliente da ficha.
 *
 * Tudo anulavel menos nome e id, ao contrario do `Cliente` do mock: a RF-009
 * deixa cadastrar so com o nome, e um tipo que exige documento e endereco
 * obrigaria a tela a inventar `''` para quem nao tem — e `''` desenha como se
 * o campo estivesse la e vazio, quando na verdade nunca foi preenchido.
 */
export type ClienteDaFicha = {
  id: string
  nome: string
  documento: string | null
  /** Derivado do documento — 11 digitos e fisica, 14 e juridica. */
  tipoPessoa: 'fisica' | 'juridica' | null
  /** Derivado do telefone: os dois primeiros digitos. */
  ddd: string | null
  celular: string | null
  telefone: string | null
  email: string | null
  observacao: string | null
  limiteFiado: number
  saldoFiado: number
  endereco: EnderecoDoCliente
  /**
   * Quando o pedido de exclusao do titular foi atendido — RF-127.
   *
   * Nulo na esmagadora maioria. A ficha precisa disto para nao oferecer
   * "atender pedido de exclusao" a quem ja foi anonimizado: o clique voltaria
   * 409, e o lojista poderia achar que o pedido anterior nao valeu.
   */
  anonimizadoEm: string | null
  /**
   * Quando o lojista tirou este cliente da lista — RF-009.
   *
   * Nulo = ativo. A ficha CONTINUA abrindo depois de excluido, e e por isso
   * que este campo existe: e ela que mostra o aviso e o botao de reativar.
   *
   * Nao confundir com o filtro "inativos" da lista, que quer dizer outra
   * coisa — cliente que nao compra ha sessenta dias.
   */
  excluidoEm: string | null
}

type FichaDaApi = {
  id: string
  name: string
  document: string | null
  phone: string | null
  email: string | null
  notes: string | null
  walletLimitCents: number
  walletBalanceCents: number
  address: {
    zipCode: string | null
    street: string | null
    number: string | null
    complement: string | null
    district: string | null
    city: string | null
    state: string | null
  }
  anonymizedAt: string | null
  deletedAt: string | null
}

/**
 * Tipo de pessoa e DDD sao DERIVADOS aqui, e nao colunas no banco.
 *
 * Guardar os dois criaria uma segunda fonte de verdade: bastaria alguem trocar
 * o CPF por um CNPJ sem mexer no `tipo_pessoa` para a ficha passar a mentir. A
 * regra e a mesma do backend (`tipoDePessoa` e `dddDe` em contracts), e vale
 * repeti-la aqui porque o front precisa dela para desenhar antes de salvar.
 */
function tipoDePessoa(documento: string | null): 'fisica' | 'juridica' | null {
  if (documento === null) return null
  const d = documento.replace(/\D/g, '')
  if (d.length === 11) return 'fisica'
  if (d.length === 14) return 'juridica'
  return null
}

export async function buscarCliente(id: string): Promise<Resultado<ClienteDaFicha>> {
  const r = await pedir<FichaDaApi>(`/api/clientes/${encodeURIComponent(id)}`)

  if (!r.ok) return r

  const c = r.dados
  const digitos = c.phone?.replace(/\D/g, '') ?? null

  return {
    ok: true,
    dados: {
      id: c.id,
      nome: c.name,
      documento: c.document,
      tipoPessoa: tipoDePessoa(c.document),
      /* Menos de dez digitos nao tem DDD: e um telefone antigo ou incompleto,
         e cortar os dois primeiros ali inventaria um codigo de area. */
      ddd: digitos !== null && digitos.length >= 10 ? digitos.slice(0, 2) : null,
      celular: digitos !== null && digitos.length >= 10 ? digitos.slice(2) : digitos,
      telefone: c.phone,
      email: c.email,
      observacao: c.notes,
      limiteFiado: c.walletLimitCents / 100,
      saldoFiado: c.walletBalanceCents / 100,
      endereco: {
        cep: c.address.zipCode,
        logradouro: c.address.street,
        numero: c.address.number,
        complemento: c.address.complement,
        bairro: c.address.district,
        cidade: c.address.city,
        uf: c.address.state,
      },
      anonimizadoEm: c.anonymizedAt,
      excluidoEm: c.deletedAt,
    },
  }
}

/**
 * Tira o cliente da lista — RF-009.
 *
 * Nada e apagado: a linha fica, e o historico de vendas continua apontando
 * para ela. Por isso ha volta, logo abaixo.
 *
 * Recusa com fiado em aberto, e a api e quem diz isso — a mensagem dela chega
 * pronta para a tela ("baixe o saldo antes de excluir").
 */
export async function excluirCliente(
  id: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await pedir<unknown>(`/api/clientes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  return r.ok ? { ok: true } : { ok: false, erro: r.erro }
}

/** Traz o cliente de volta para a lista — RF-009. */
export async function reativarCliente(
  id: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await pedir<unknown>(`/api/clientes/${encodeURIComponent(id)}/reativacao`, {
    method: 'POST',
  })

  return r.ok ? { ok: true } : { ok: false, erro: r.erro }
}

/** SUBSTITUIR POR: GET /clientes/:id/compras */
export function comprasDoCliente(clienteId: string): CompraCliente[] {
  const base: Record<string, CompraCliente[]> = {
    'cli-1': [
      {
        id: 'v1',
        numero: '1842',
        data: '2026-08-24',
        valor: 86.9,
        itens: 6,
        formaPagamento: 'Pix',
      },
      {
        id: 'v2',
        numero: '1798',
        data: '2026-08-11',
        valor: 214.4,
        itens: 12,
        formaPagamento: 'Credito',
      },
      {
        id: 'v3',
        numero: '1755',
        data: '2026-07-29',
        valor: 132.0,
        itens: 8,
        formaPagamento: 'Dinheiro',
      },
    ],
    'cli-2': [
      {
        id: 'v4',
        numero: '1839',
        data: '2026-08-23',
        valor: 156.2,
        itens: 4,
        formaPagamento: 'Debito',
      },
      {
        id: 'v5',
        numero: '1801',
        data: '2026-08-12',
        valor: 4820.0,
        itens: 96,
        formaPagamento: 'Credito',
      },
    ],
    'cli-3': [
      {
        id: 'v6',
        numero: '1840',
        data: '2026-08-24',
        valor: 412.5,
        itens: 18,
        formaPagamento: 'Dinheiro',
      },
    ],
    'cli-4': [
      {
        id: 'v7',
        numero: '1702',
        data: '2026-06-02',
        valor: 2310.5,
        itens: 44,
        formaPagamento: 'Credito',
      },
    ],
  }
  return base[clienteId] ?? []
}

/** SUBSTITUIR POR: GET /clientes/:id/titulos (Contas a Receber) */
export function pendenciasDoCliente(clienteId: string): PendenciaCliente[] {
  const base: Record<string, PendenciaCliente[]> = {
    'cli-2': [
      {
        id: 'p1',
        referente: 'Pedido 8891',
        vencimento: '2026-08-25',
        valor: 4820.0,
        status: 'aberto',
      },
      {
        id: 'p2',
        referente: 'Pedido 8880',
        vencimento: '2026-09-05',
        valor: 3740.0,
        status: 'parcial',
      },
    ],
    'cli-4': [
      {
        id: 'p3',
        referente: 'Pedido 8874',
        vencimento: '2026-08-16',
        valor: 2310.5,
        status: 'vencido',
      },
    ],
    'cli-3': [
      {
        id: 'p4',
        referente: 'Venda 1840',
        vencimento: '2026-09-19',
        valor: 412.5,
        status: 'aberto',
      },
    ],
  }
  return base[clienteId] ?? []
}

/** Total em aberto do cliente — usado como indicador na listagem. */
export function pendenciaTotal(clienteId: string): number {
  return pendenciasDoCliente(clienteId).reduce((acc, p) => acc + p.valor, 0)
}

/** True quando ha titulo vencido — pinta o indicador em tom de alerta. */
export function temVencido(clienteId: string): boolean {
  return pendenciasDoCliente(clienteId).some((p) => p.status === 'vencido')
}

export type { Cliente }

/* -------------------------------------------------------------------------- */
/* Importacao                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Importa clientes de verdade — NR-072, US-008.
 *
 * Ate agora era `await delay(1200)`: a tela dizia "80 importados" e nao gravava
 * nada. Agora manda o lote para `POST /clientes/importacao` e devolve o que o
 * SERVIDOR aceitou.
 *
 * Documento e celular vao so com DIGITOS. Planilha vem com ponto, traco,
 * parenteses e espaco, e o contrato valida o formato limpo — mandar como veio
 * faria toda linha ser recusada por um motivo que nao e culpa de quem digitou.
 *
 * Linha sem nome e recusada aqui, com o numero da linha. O contrato tambem
 * recusaria, mas a recusa dele derruba o LOTE INTEIRO por forma invalida — e
 * uma planilha com uma linha em branco no fim e o caso mais comum que existe.
 */
export async function confirmarImportacaoClientes(
  registros: Record<string, string>[],
): Promise<ResultadoDaImportacao> {
  const recusadas: LinhaRecusada[] = []
  const enviar: Record<string, unknown>[] = []
  const origem: number[] = []

  const digitos = (v: string | undefined) => (v ?? '').replace(/\D/g, '')

  registros.forEach((r, index) => {
    const nome = (r.nome ?? '').trim()

    if (nome.length < 2) {
      recusadas.push({ index, description: nome, reason: 'Nome vazio ou curto demais.' })
      return
    }

    const documento = digitos(r.documento)
    const celular = digitos(r.celular)
    const email = (r.email ?? '').trim()

    origem.push(index)
    enviar.push({
      name: nome,
      ...(documento !== '' ? { document: documento } : {}),
      ...(celular !== '' ? { phone: celular } : {}),
      ...(email !== '' ? { email } : {}),
    })
  })

  if (enviar.length === 0) return { importados: 0, recusadas }

  const r = await pedir<{ imported: number; rejected: LinhaRecusada[] }>(
    '/api/clientes/importacao',
    { method: 'POST', body: JSON.stringify({ customers: enviar }) },
  )

  if (!r.ok) {
    return {
      importados: 0,
      recusadas: [
        ...recusadas,
        ...enviar.map((_, i) => ({
          index: origem[i]!,
          description: String(enviar[i]!.name),
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

/* -------------------------------------------------------------------------- */
/* A lista — RF-011, US-036                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Um cliente na lista, com o historico que a tela mostra.
 *
 * O historico vem JUNTO da api, numa consulta so: a tela mostra "ultima compra"
 * em toda linha, e busca-lo por cliente daria vinte e cinco idas ao servidor
 * para uma pagina.
 */
export type ClienteDaLista = {
  id: string
  nome: string
  documento: string | null
  celular: string | null
  email: string | null
  /** Saldo devedor do fiado, em reais. */
  saldoFiado: number
  /** Nulo = NUNCA comprou. Nao e o mesmo que "comprou ha muito tempo". */
  ultimaCompra: string | null
  totalCompras: number
  valorTotal: number
}

export type FiltroDeCliente = 'todos' | 'inativos' | 'fiado'

export type ListaDeClientes = {
  clientes: ClienteDaLista[]
  total: number
  pagina: number
  porPagina: number
}

type ClienteDaApi = {
  id: string
  name: string
  document: string | null
  phone: string | null
  email: string | null
  walletBalanceCents: number
  lastSaleOn: string | null
  salesCount: number
  totalSpentCents: number
}

export async function listarClientes(opcoes: {
  termo?: string
  filtro?: FiltroDeCliente
  pagina?: number
}): Promise<Resultado<ListaDeClientes>> {
  const query = new URLSearchParams()
  if (opcoes.termo) query.set('q', opcoes.termo)
  if (opcoes.filtro && opcoes.filtro !== 'todos') query.set('filter', opcoes.filtro)
  if (opcoes.pagina && opcoes.pagina > 1) query.set('page', String(opcoes.pagina))

  const r = await pedir<{
    customers: ClienteDaApi[]
    total: number
    page: number
    pageSize: number
  }>(`/api/clientes?${query.toString()}`)

  if (!r.ok) return r

  return {
    ok: true,
    dados: {
      clientes: r.dados.customers.map((c) => ({
        id: c.id,
        nome: c.name,
        documento: c.document,
        celular: c.phone,
        email: c.email,
        saldoFiado: c.walletBalanceCents / 100,
        ultimaCompra: c.lastSaleOn,
        totalCompras: c.salesCount,
        valorTotal: c.totalSpentCents / 100,
      })),
      total: r.dados.total,
      pagina: r.dados.page,
      porPagina: r.dados.pageSize,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Direitos do titular — NR-086, RF-127, RF-128                               */
/* -------------------------------------------------------------------------- */

/**
 * O comprovante da anonimizacao.
 *
 * Nao e um `ok`. O titular pediu EXCLUSAO e recebeu ANONIMIZACAO, e a diferenca
 * precisa estar escrita: o comprovante lista o que foi substituido, o que ficou
 * e por que — e e com ele que o lojista responde ao titular, e se preciso a
 * ANPD.
 */
export type ComprovanteDeAnonimizacao = {
  customerId: string
  anonymizedAt: string
  anonymizedBy: string
  scrubbedFields: string[]
  preserved: { what: string; rows: number; because: string }[]
  deleted: { what: string; rows: number }[]
}

/** Anonimiza — irreversivel. O motivo e obrigatorio no servidor. */
export const anonimizarCliente = (
  clienteId: string,
  motivo: string,
): Promise<Resultado<ComprovanteDeAnonimizacao>> =>
  pedir<ComprovanteDeAnonimizacao>(`/api/clientes/${encodeURIComponent(clienteId)}/anonimizacao`, {
    method: 'POST',
    body: JSON.stringify({ reason: motivo }),
  })
