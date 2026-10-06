import { chamarApi } from './api'
import { centavosDoTexto } from './valor'

/**
 * Clientes no app — RF-011, US-036, as mesmas rotas do web.
 *
 * Lista com busca e filtro no SERVIDOR, ficha, cadastro e edicao, contatos,
 * pendencias, consentimento do WhatsApp e os direitos do titular (LGPD).
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

const id = (v: string) => encodeURIComponent(v)

export type ClienteDaLista = {
  id: string
  nome: string
  documento: string | null
  celular: string | null
  /** Saldo devedor do fiado, em reais. */
  saldoFiado: number
  /** Nulo = NUNCA comprou. */
  ultimaCompra: string | null
}

type ClienteDaApi = {
  id: string
  name: string
  tradeName: string | null
  document: string | null
  phone: string | null
  walletBalanceCents: number
  lastSaleOn: string | null
}

export type ListaDeClientes = { clientes: ClienteDaLista[]; total: number }

export type FiltroDeCliente = 'todos' | 'fiado' | 'inativos'

export async function listarClientes(opcoes: {
  termo?: string
  filtro?: FiltroDeCliente
}): Promise<{ ok: true; dados: ListaDeClientes } | { ok: false; erro: string }> {
  const query = new URLSearchParams()
  /* So vai o que veio: `q=` vazio faria a api recusar o pedido inteiro. */
  if (opcoes.termo) query.set('q', opcoes.termo)
  if (opcoes.filtro && opcoes.filtro !== 'todos') query.set('filter', opcoes.filtro)

  const r = await chamarApi<{ customers: ClienteDaApi[]; total: number }>(
    `/clientes?${query.toString()}`,
  )
  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    dados: {
      total: r.dados.total,
      clientes: r.dados.customers.map((c) => ({
        id: c.id,
        /* PJ aparece pelo fantasia: e por ele que o balcao procura. */
        nome: c.tradeName ?? c.name,
        documento: c.document,
        celular: c.phone,
        saldoFiado: c.walletBalanceCents / 100,
        ultimaCompra: c.lastSaleOn,
      })),
    },
  }
}

/**
 * O link do WhatsApp, ou nulo sem telefone.
 *
 * O telefone chega so com digitos, com ou sem o 55: sem o pais, o `wa.me`
 * abre uma conversa com um numero que nao existe.
 */
export function linkDoWhatsApp(celular: string | null): string | null {
  const digitos = (celular ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  return `https://wa.me/${digitos.startsWith('55') && digitos.length > 11 ? digitos : `55${digitos}`}`
}

/**
 * Quanto o cliente tem VENCIDO, em reais — o aviso do PDV antes de vender fiado.
 *
 * Mesma fonte do web (`GET /contas-a-receber?cliente=`): a faixa `overdue`,
 * descontado o que ja foi baixado em parte. Nulo quando nao deu para saber —
 * o aviso some, e a venda segue; quem decide vender e o lojista.
 */
export async function vencidoDoCliente(clienteId: string): Promise<number | null> {
  const r = await chamarApi<{
    grupos: {
      faixa: string
      receivables: { amountCents: number; settledAmountCents: number }[]
    }[]
  }>(`/contas-a-receber?cliente=${encodeURIComponent(clienteId)}`)
  if (!r.ok) return null

  const centavos = r.dados.grupos
    .filter((g) => g.faixa === 'overdue')
    .flatMap((g) => g.receivables)
    .reduce((soma, t) => soma + t.amountCents - t.settledAmountCents, 0)

  return centavos / 100
}

/* -------------------------------------------------------------------------- */
/* Inadimplentes — RF-071                                                     */
/* -------------------------------------------------------------------------- */

export type ClienteInadimplente = {
  id: string
  nome: string
  celular: string | null
  vencido: number
  venceuEm: string
  diasDeAtraso: number
  titulos: number
}

/** Quem tem titulo vencido, do maior atraso para o menor — a lista de cobranca. */
export async function listarInadimplentes(): Promise<Resultado<ClienteInadimplente[]>> {
  const r = await chamarApi<{
    customers: {
      customerId: string
      name: string
      phone: string | null
      overdueCents: number
      oldestDueOn: string
      daysOverdue: number
      receivablesCount: number
    }[]
  }>('/clientes/inadimplentes')
  if (!r.ok) return { ok: false, erro: r.message }
  return {
    ok: true,
    dados: r.dados.customers.map((c) => ({
      id: c.customerId,
      nome: c.name,
      celular: c.phone,
      vencido: c.overdueCents / 100,
      venceuEm: c.oldestDueOn,
      diasDeAtraso: c.daysOverdue,
      titulos: c.receivablesCount,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* A ficha — RF-011                                                           */
/* -------------------------------------------------------------------------- */

export type EnderecoDoCliente = {
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

export type ClienteDaFicha = {
  id: string
  nome: string
  nomeFantasia: string | null
  documento: string | null
  /** O telefone inteiro, so digitos, como a api guarda. */
  telefone: string | null
  email: string | null
  limiteFiado: number
  saldoFiado: number
  endereco: EnderecoDoCliente
  anonimizadoEm: string | null
  excluidoEm: string | null
}

export async function buscarCliente(clienteId: string): Promise<Resultado<ClienteDaFicha>> {
  const r = await chamarApi<{
    id: string
    name: string
    tradeName: string | null
    document: string | null
    phone: string | null
    email: string | null
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
  }>(`/clientes/${id(clienteId)}`)
  if (!r.ok) return { ok: false, erro: r.message }

  const c = r.dados
  return {
    ok: true,
    dados: {
      id: c.id,
      nome: c.name,
      nomeFantasia: c.tradeName,
      documento: c.document,
      telefone: c.phone,
      email: c.email,
      limiteFiado: c.walletLimitCents / 100,
      saldoFiado: c.walletBalanceCents / 100,
      endereco: {
        cep: c.address.zipCode ?? '',
        logradouro: c.address.street ?? '',
        numero: c.address.number ?? '',
        complemento: c.address.complement ?? '',
        bairro: c.address.district ?? '',
        cidade: c.address.city ?? '',
        uf: c.address.state ?? '',
      },
      anonimizadoEm: c.anonymizedAt,
      excluidoEm: c.deletedAt,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Cadastro e edicao — RF-008, RF-010                                         */
/* -------------------------------------------------------------------------- */

export type DadosCliente = {
  documento: string
  nome: string
  nomeFantasia: string
  telefone: string
  email: string
  /** Teto do fiado em reais, como digitado; vazio = sem fiado. */
  limiteFiado: string
  endereco: EnderecoDoCliente
}

export type CandidatoCliente = {
  id: string
  name: string
  phone: string | null
  document: string | null
}

export type ResultadoSalvarCliente =
  | { ok: true; id: string }
  | { ok: false; erro: string }
  | { ok: false; duplicados: CandidatoCliente[] }

/** Endereco so vai se algum campo veio — a api recusa um objeto todo vazio. */
function enderecoParaApi(e: EnderecoDoCliente): Record<string, string> | undefined {
  const campos = {
    zipCode: e.cep.replace(/\D/g, ''),
    street: e.logradouro.trim(),
    number: e.numero.trim(),
    complement: e.complemento.trim(),
    district: e.bairro.trim(),
    city: e.cidade.trim(),
    state: e.uf.trim().toUpperCase(),
  }
  const preenchidos = Object.entries(campos).filter(([, v]) => v !== '')
  return preenchidos.length === 0 ? undefined : Object.fromEntries(preenchidos)
}

/**
 * O limite do fiado como a api o quer. Sem limite, o servidor recusa vender na
 * carteira para o cliente. No cadastro, vazio nao vai; na edicao, vazio vai
 * como zero — e assim que se tira o fiado de alguem.
 */
function limiteParaApi(texto: string, editando: boolean): { walletLimitCents?: number } {
  const centavos = centavosDoTexto(texto)
  if (centavos !== null) return { walletLimitCents: centavos }
  return editando && texto.trim() === '' ? { walletLimitCents: 0 } : {}
}

function corpoDoCliente(dados: DadosCliente, editando = false): Record<string, unknown> {
  const address = enderecoParaApi(dados.endereco)
  const documento = dados.documento.replace(/\D/g, '')
  const telefone = dados.telefone.replace(/\D/g, '')
  return {
    name: dados.nome.trim(),
    ...(dados.nomeFantasia.trim() ? { tradeName: dados.nomeFantasia.trim() } : {}),
    ...(documento ? { document: documento } : {}),
    ...(telefone ? { phone: telefone } : {}),
    ...(dados.email.trim() ? { email: dados.email.trim() } : {}),
    ...limiteParaApi(dados.limiteFiado, editando),
    ...(address === undefined ? {} : { address }),
  }
}

/**
 * Cadastra o cliente. Um 409 com candidatos e o servidor dizendo "parece que
 * ja existe" — a tela mostra quem, e a pessoa decide cadastrar mesmo assim.
 */
export async function salvarCliente(
  dados: DadosCliente,
  opcoes: { permitirDuplicado?: boolean } = {},
): Promise<ResultadoSalvarCliente> {
  const r = await chamarApi<{ id: string }>(
    `/clientes${opcoes.permitirDuplicado === true ? '?duplicado=permitir' : ''}`,
    { method: 'POST', body: corpoDoCliente(dados) },
  )
  if (r.ok) return { ok: true, id: r.dados.id }

  const candidatos = (r.corpo as { candidates?: CandidatoCliente[] } | null)?.candidates
  if (r.status === 409 && candidatos !== undefined) return { ok: false, duplicados: candidatos }
  return { ok: false, erro: r.message }
}

export async function atualizarCliente(
  clienteId: string,
  dados: DadosCliente,
): Promise<ResultadoSalvarCliente> {
  const r = await chamarApi<{ id: string }>(`/clientes/${id(clienteId)}`, {
    method: 'PATCH',
    body: corpoDoCliente(dados, true),
  })
  return r.ok ? { ok: true, id: r.dados.id } : { ok: false, erro: r.message }
}

/** Exclui (inativa) o cliente — o historico fica; a ficha sai da lista. */
export async function excluirCliente(clienteId: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/clientes/${id(clienteId)}`, { method: 'DELETE' })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}

export async function reativarCliente(clienteId: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/clientes/${id(clienteId)}/reativar`, { method: 'POST' })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}

/**
 * Anonimiza o cliente — direito do titular, RF-127.
 *
 * Irreversivel: nome, documento e contatos somem; vendas e titulos ficam, sem
 * dono identificavel, porque a lei fiscal exige guardar.
 */
export async function anonimizarCliente(
  clienteId: string,
  motivo: string,
): Promise<Resultado<{ anonymizedAt: string }>> {
  const r = await chamarApi<{ anonymizedAt: string }>(`/clientes/${id(clienteId)}/anonimizacao`, {
    method: 'POST',
    body: { reason: motivo.trim() },
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/* -------------------------------------------------------------------------- */
/* O que esta ligado ao cliente                                               */
/* -------------------------------------------------------------------------- */

export type CompraCliente = {
  id: string
  numero: string
  data: string
  valor: number
  itens: number
}

/** As ultimas compras, sem as estornadas — o que o cliente levou de fato. */
export async function comprasDoCliente(clienteId: string): Promise<Resultado<CompraCliente[]>> {
  const r = await chamarApi<{
    sales: {
      id: string
      number: number
      soldAt: string
      status: string
      grossAmountCents: number
      discountCents: number
      items: { quantity: number }[]
    }[]
  }>(`/sales?customerId=${id(clienteId)}&pageSize=20`)
  if (!r.ok) return { ok: false, erro: r.message }
  return {
    ok: true,
    dados: r.dados.sales
      .filter((v) => v.status !== 'cancelled' && v.status !== 'returned')
      .map((v) => ({
        id: v.id,
        numero: String(v.number),
        data: v.soldAt,
        valor: (v.grossAmountCents - v.discountCents) / 100,
        itens: v.items.reduce((acc, i) => acc + i.quantity, 0),
      })),
  }
}

export type PendenciaCliente = {
  id: string
  referente: string
  vencimento: string
  /** O que falta receber, em reais. */
  valor: number
  status: 'aberto' | 'vencido' | 'parcial'
}

export async function pendenciasDoCliente(
  clienteId: string,
): Promise<Resultado<PendenciaCliente[]>> {
  const r = await chamarApi<{
    grupos: {
      faixa: string
      receivables: {
        id: string
        description: string
        dueDate: string
        amountCents: number
        settledAmountCents: number
      }[]
    }[]
  }>(`/contas-a-receber?cliente=${id(clienteId)}`)
  if (!r.ok) return { ok: false, erro: r.message }
  return {
    ok: true,
    dados: r.dados.grupos.flatMap((g) =>
      g.receivables.map((t) => ({
        id: t.id,
        referente: t.description,
        vencimento: t.dueDate,
        valor: (t.amountCents - t.settledAmountCents) / 100,
        status: g.faixa === 'overdue' ? 'vencido' : t.settledAmountCents > 0 ? 'parcial' : 'aberto',
      })),
    ),
  }
}

/** Lanca uma pendencia (conta a receber) para o cliente — US-016. */
export async function lancarPendencia(
  clienteId: string,
  entrada: { descricao: string; valorCentavos: number; vencimento: string },
): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>('/contas-a-receber', {
    method: 'POST',
    body: {
      description: entrada.descricao.trim(),
      amountCents: entrada.valorCentavos,
      dueDate: entrada.vencimento,
      customerId: clienteId,
    },
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}

export type TipoDeContato = 'ligacao' | 'whatsapp' | 'visita' | 'observacao'

export const TIPOS_DE_CONTATO: { valor: TipoDeContato; rotulo: string }[] = [
  { valor: 'ligacao', rotulo: 'Ligação' },
  { valor: 'whatsapp', rotulo: 'WhatsApp' },
  { valor: 'visita', rotulo: 'Visita' },
  { valor: 'observacao', rotulo: 'Observação' },
]

export type ContatoCliente = {
  id: string
  data: string
  tipo: TipoDeContato
  descricao: string
}

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

type ContatoDaApi = { id: string; kind: string; description: string; happenedOn: string }

const paraContato = (c: ContatoDaApi): ContatoCliente => ({
  id: c.id,
  data: c.happenedOn,
  /* Tipo novo da api vira "observacao" em vez de quebrar a ficha. */
  tipo: TIPO_DA_API[c.kind] ?? 'observacao',
  descricao: c.description,
})

export async function contatosDoCliente(clienteId: string): Promise<Resultado<ContatoCliente[]>> {
  const r = await chamarApi<{ contacts: ContatoDaApi[] }>(`/clientes/${id(clienteId)}/contatos`)
  return r.ok
    ? { ok: true, dados: r.dados.contacts.map(paraContato) }
    : { ok: false, erro: r.message }
}

export async function lancarContato(
  clienteId: string,
  contato: { tipo: TipoDeContato; descricao: string },
): Promise<Resultado<ContatoCliente>> {
  const r = await chamarApi<ContatoDaApi>(`/clientes/${id(clienteId)}/contatos`, {
    method: 'POST',
    body: { kind: TIPO_PARA_API[contato.tipo], description: contato.descricao.trim() },
  })
  return r.ok ? { ok: true, dados: paraContato(r.dados) } : { ok: false, erro: r.message }
}

/* -------------------------------------------------------------------------- */
/* Consentimento do WhatsApp — RF-126                                         */
/* -------------------------------------------------------------------------- */

export type ConsentimentoWhatsapp = { autorizouEm: string | null; recusouEm: string | null }

type ConsentimentoDaApi = { optedInAt: string | null; optedOutAt: string | null }

export async function consentimentoDoCliente(
  clienteId: string,
): Promise<Resultado<ConsentimentoWhatsapp>> {
  const r = await chamarApi<ConsentimentoDaApi>(`/clientes/${id(clienteId)}/consentimento-whatsapp`)
  return r.ok
    ? { ok: true, dados: { autorizouEm: r.dados.optedInAt, recusouEm: r.dados.optedOutAt } }
    : { ok: false, erro: r.message }
}

export async function registrarConsentimento(
  clienteId: string,
  decisao: 'autorizou' | 'recusou',
): Promise<Resultado<ConsentimentoWhatsapp>> {
  const r = await chamarApi<ConsentimentoDaApi>(
    `/clientes/${id(clienteId)}/consentimento-whatsapp`,
    { method: 'PUT', body: { decision: decisao === 'autorizou' ? 'opt_in' : 'opt_out' } },
  )
  return r.ok
    ? { ok: true, dados: { autorizouEm: r.dados.optedInAt, recusouEm: r.dados.optedOutAt } }
    : { ok: false, erro: r.message }
}

/* -------------------------------------------------------------------------- */
/* Importacao — NR-072, US-008                                                */
/* -------------------------------------------------------------------------- */

export type LinhaRecusada = { index: number; description: string; reason: string }
export type ResultadoDaImportacao = { importados: number; recusadas: LinhaRecusada[] }

/**
 * Manda o lote para `POST /clientes/importacao`, como o web. O servidor
 * devolve o indice do que recusou sobre o lote ENVIADO; `origem` traduz de
 * volta para a linha da planilha.
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
      phone: celular,
      ...(email !== '' ? { email } : {}),
      address: {
        zipCode: digitos(r.cep),
        street: (r.rua ?? '').trim(),
        number: (r.numero ?? '').trim(),
        ...((r.complemento ?? '').trim() !== ''
          ? { complement: (r.complemento ?? '').trim() }
          : {}),
        district: (r.bairro ?? '').trim(),
        city: (r.cidade ?? '').trim(),
        state: (r.uf ?? '').trim().toUpperCase(),
      },
    })
  })

  if (enviar.length === 0) return { importados: 0, recusadas }

  const r = await chamarApi<{ imported: number; rejected: LinhaRecusada[] }>(
    '/clientes/importacao',
    { method: 'POST', body: { customers: enviar } },
  )
  if (!r.ok) {
    return {
      importados: 0,
      recusadas: [
        ...recusadas,
        ...enviar.map((e, i) => ({
          index: origem[i] ?? i,
          description: String(e.name),
          reason: r.message,
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
