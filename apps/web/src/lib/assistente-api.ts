/**
 * ============================================================================
 * ASSISTENTE — perguntas prontas respondidas com os dados da loja
 * ============================================================================
 *
 * O agente com modelo de linguagem (DEC-007) ainda nao esta ligado. Ate la, a
 * frase e reconhecida aqui por palavra-chave — mas TODA resposta sai das
 * mesmas consultas que as telas usam (historico de vendas, relatorios,
 * catalogo, contas, DRE). Antes, metade das respostas lia `lib/mock-data`: o
 * QA perguntou "ranking dos clientes" e recebeu "Padaria Sol LTDA, 112
 * compras", que nao existia na loja. Numero inventado num assistente
 * financeiro e pior que "nao sei".
 *
 * Por isso a regra deste arquivo: se a resposta nao sai de uma consulta real,
 * ela diz que nao sabe e aponta a tela — nunca preenche com exemplo.
 *
 * MESMA CONVERSA EM VARIOS CANAIS. `Mensagem` com `canal` e `Contexto`
 * separado do historico existem para que a conversa do app e a do WhatsApp
 * sejam a MESMA thread quando o backend do assistente entrar
 * (POST /assistente/mensagens). Manter a assinatura de `enviarMensagem` faz o
 * backend entrar sem mexer na tela.
 *
 * ACAO SEMPRE CONFIRMA. Consulta responde direto; o que grava (cadastrar,
 * baixar titulo, mandar mensagem ao cliente) nao e feito por aqui: a resposta
 * leva para a tela que faz.
 */

import {
  carregarFaturamento,
  carregarRankingDeClientes,
  carregarRankingDeProdutos,
} from './relatorios-api'
import { carregarCatalogo, type NivelDeEstoque, type ProdutoDoCatalogo } from './catalogo-api'
import {
  carregarContasAPagar,
  carregarContasAReceber,
  type ContaAPagar,
  type ContaAReceber,
} from './financeiro-api'
import { carregarDre, carregarPlano, type ContaContabil, type Dre } from './contabilidade-api'
import {
  comprasDoCliente,
  listarClientes,
  pendenciasDoCliente,
  type ClienteDaLista,
  type CompraCliente,
  type PendenciaCliente,
} from './clientes-api'
import { carregarHistorico, type PaginaDoHistorico } from './vendas-api'
import { daysUntil, diaLocal, formatMoney } from './format'
import type { Resultado } from './http'

/* -------------------------------------------------------------------------- */
/* Modelo de conversa                                                         */
/* -------------------------------------------------------------------------- */

export type Canal = 'app' | 'whatsapp'

/** Bloco rico dentro de uma resposta — a tela decide como desenhar. */
export type BlocoResposta =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'tabela'
      titulo: string
      colunas: string[]
      linhas: string[][]
    }
  | {
      tipo: 'lista'
      titulo: string
      itens: { rotulo: string; valor: string; destaque?: boolean }[]
    }
  | {
      tipo: 'indicador'
      rotulo: string
      valor: string
      apoio?: string
    }
  | {
      tipo: 'confirmacao'
      pergunta: string
      /** `abrir_cadastro_cliente`, `cancelar` ou uma rota `/app/...` para abrir. */
      acao: string
    }

export type Mensagem = {
  id: string
  autor: 'usuario' | 'assistente'
  canal: Canal
  texto: string
  blocos?: BlocoResposta[]
  data: string
}

/**
 * Memoria de curto prazo da conversa.
 *
 * Guarda a ultima entidade citada para resolver pronome: perguntar
 * "o que ele comprou" logo depois de falar de um cliente precisa
 * funcionar, senao a conversa vira uma sequencia de comandos soltos.
 */
export type Contexto = {
  clienteId: string | null
  clienteNome: string | null
  produtoId: string | null
  produtoNome: string | null
}

export const CONTEXTO_VAZIO: Contexto = {
  clienteId: null,
  clienteNome: null,
  produtoId: null,
  produtoNome: null,
}

export type Resposta = {
  texto: string
  blocos: BlocoResposta[]
  contexto: Contexto
  intencao: string
}

/* -------------------------------------------------------------------------- */
/* Aprendizado                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Registro de uso, base para personalizar sugestoes depois.
 *
 * SUBSTITUIR POR: POST /assistente/uso — o servidor agrega por usuario e
 * devolve os comandos mais usados para ordenar os chips. Guardar isto no
 * navegador nao serve: a mesma pessoa usa o WhatsApp e outro aparelho.
 */
export type RegistroUso = {
  intencao: string
  texto: string
  data: string
}

const usoDaSessao: RegistroUso[] = []

export function registrarUso(intencao: string, texto: string): void {
  usoDaSessao.push({ intencao, texto, data: new Date().toISOString() })
}

/** Comandos mais repetidos nesta sessao — prototipo do ranking real. */
export function comandosMaisUsados(limite = 3): string[] {
  const contagem = new Map<string, number>()
  for (const r of usoDaSessao) {
    contagem.set(r.texto, (contagem.get(r.texto) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([texto]) => texto)
}

/* -------------------------------------------------------------------------- */
/* Fontes de dados                                                            */
/* -------------------------------------------------------------------------- */

/**
 * As consultas de que o assistente precisa — as MESMAS das telas.
 *
 * Injetadas, e nao importadas direto no corpo das respostas, para o teste
 * poder dizer "a loja tem estes dados" e conferir que a resposta repete
 * exatamente eles.
 */
export type FontesDoAssistente = {
  historico: (de: string, ate: string, porPagina: number) => Promise<Resultado<PaginaDoHistorico>>
  faturamento: typeof carregarFaturamento
  rankingDeClientes: typeof carregarRankingDeClientes
  rankingDeProdutos: typeof carregarRankingDeProdutos
  catalogo: (estoque: NivelDeEstoque) => Promise<Resultado<ProdutoDoCatalogo[]>>
  contasAPagar: () => Promise<Resultado<ContaAPagar[]>>
  contasAReceber: () => Promise<Resultado<ContaAReceber[]>>
  dre: (from: string, to: string) => Promise<Resultado<Dre>>
  plano: () => Promise<Resultado<ContaContabil[]>>
  clientes: (opcoes: {
    termo?: string
    filtro?: 'todos' | 'inativos' | 'fiado'
  }) => Promise<Resultado<ClienteDaLista[]>>
  comprasDoCliente: (id: string) => Promise<Resultado<CompraCliente[]>>
  pendenciasDoCliente: (id: string) => Promise<Resultado<PendenciaCliente[]>>
}

/** As consultas de verdade, pelo BFF. */
export const FONTES_REAIS: FontesDoAssistente = {
  historico: async (de, ate, porPagina) => {
    const r = await carregarHistorico({ termo: '', de, ate, pagina: 1, porPagina })
    return r.ok ? r : { ok: false, erro: r.error }
  },
  faturamento: carregarFaturamento,
  rankingDeClientes: carregarRankingDeClientes,
  rankingDeProdutos: carregarRankingDeProdutos,
  catalogo: async (estoque) => {
    const r = await carregarCatalogo({ termo: '', estoque, pagina: 1, porPagina: 100 })
    return r.ok ? { ok: true, dados: r.dados.produtos } : r
  },
  contasAPagar: async () => {
    const r = await carregarContasAPagar()
    return r.ok ? { ok: true, dados: r.dados.grupos.flatMap((g) => g.payables) } : r
  },
  contasAReceber: async () => {
    const r = await carregarContasAReceber()
    return r.ok ? { ok: true, dados: r.dados.grupos.flatMap((g) => g.receivables) } : r
  },
  dre: carregarDre,
  plano: async () => {
    const r = await carregarPlano()
    return r.ok ? { ok: true, dados: r.dados.accounts } : r
  },
  clientes: async (opcoes) => {
    const r = await listarClientes(opcoes)
    return r.ok ? { ok: true, dados: r.dados.clientes } : r
  },
  comprasDoCliente,
  pendenciasDoCliente,
}

/* -------------------------------------------------------------------------- */
/* Reconhecimento da pergunta                                                 */
/* -------------------------------------------------------------------------- */

/** Remove acento e caixa para comparar sem depender de digitacao exata. */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * O nome que vem depois de "cliente" — "o que o cliente Joao esta devendo".
 *
 * O "X" literal dos chips ("O cliente X esta cadastrado") nao e nome: sem um
 * nome de verdade, a resposta pergunta qual cliente.
 */
function nomeCitado(texto: string): string | null {
  /* Fim de palavra por espaco/pontuacao, e nao `\b`: o `\b` do JavaScript nao
     reconhece letra acentuada como letra, e "está" nunca fechava o nome —
     "Ana Souza está" ia para a busca (achado na rodada de uso). O nome fica
     com o acento original: a busca do banco (ILIKE) nao ignora acento. */
  const m =
    /cliente\s+(.+?)(?:\s+(?:esta|está|deve|devendo|comprou|foi)(?=\s|[?!.,]|$)|\?|$)/i.exec(texto)
  const nome = m?.[1]?.trim() ?? ''
  if (nome.length < 2 || /^x$/i.test(nome) || /^(dizendo|para|que)\b/i.test(nome)) return null
  return nome
}

/* -------------------------------------------------------------------------- */
/* Formatacao                                                                 */
/* -------------------------------------------------------------------------- */

/** A api devolve CENTAVOS; `formatMoney` recebe reais. */
const centavos = (valor: number): string => formatMoney(valor / 100)

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** `2026-10` → `out/2026`. */
const rotuloDoMes = (aaaamm: string): string => {
  const [ano, mes] = aaaamm.split('-')
  return `${MESES[Number(mes) - 1] ?? mes}/${ano}`
}

const somarDias = (dia: string, n: number): string => {
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + n)
  return diaLocal(d)
}

/** `2026-10-02` → `02/10/2026`; o que ja vier formatado passa intacto. */
const diaBr = (dia: string): string =>
  /^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : dia

const inicioDoMes = (dia: string): string => `${dia.slice(0, 8)}01`

const fimDoMes = (dia: string): string => {
  const d = new Date(`${inicioDoMes(dia)}T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return diaLocal(d)
}

/** Primeiro dia do mes, `n` meses antes do mes de `dia`. */
const mesesAntes = (dia: string, n: number): string => {
  const d = new Date(`${inicioDoMes(dia)}T12:00:00`)
  d.setMonth(d.getMonth() - n)
  return diaLocal(d)
}

/** Proxima sexta-feira, ou hoje se hoje ja e sexta. */
const proximaSexta = (dia: string): string => {
  const d = new Date(`${dia}T12:00:00`)
  return somarDias(dia, (5 - d.getDay() + 7) % 7)
}

const emAberto = <T extends { amountCents: number; settledAmountCents: number; status: string }>(
  t: T,
): boolean => t.status !== 'settled' && t.status !== 'cancelled'

const saldoDe = (t: { amountCents: number; settledAmountCents: number }): number =>
  t.amountCents - t.settledAmountCents

const NAO_CONSEGUI = 'Nao consegui consultar os dados agora. Tente de novo em instantes.'

const abrir = (pergunta: string, rota: string): BlocoResposta => ({
  tipo: 'confirmacao',
  pergunta,
  acao: rota,
})

/* -------------------------------------------------------------------------- */
/* Respostas                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Responde a pergunta com as fontes dadas.
 *
 * `hoje` entra como parametro (AAAA-MM-DD, no fuso de quem pergunta) pelo
 * mesmo motivo de `ctx.now` no backend: o teste precisa fixar o dia.
 */
export async function responder(
  texto: string,
  contexto: Contexto,
  fontes: FontesDoAssistente,
  hoje: string,
): Promise<Resposta> {
  const t = normalizar(texto)
  const ctx: Contexto = { ...contexto }
  const r = (intencao: string, textoResposta: string, blocos: BlocoResposta[] = []): Resposta => ({
    intencao,
    texto: textoResposta,
    contexto: ctx,
    blocos,
  })

  /* ---------------- acoes que o assistente ainda nao executa ---------------- */

  if (t.includes('whatsapp') || t.includes('envie aviso') || t.includes('gerar link')) {
    return r(
      'acao_mensagem',
      'Mandar mensagem ao cliente pelo assistente ainda nao esta ligado. Por enquanto, o contato sai da ficha do cliente.',
      [abrir('Abrir a lista de clientes?', '/app/clientes')],
    )
  }
  if (t.startsWith('baixe') || t.includes('baixar')) {
    const receber = t.includes('receber') || !t.includes('pagar')
    return r(
      'acao_baixa',
      'A baixa de titulos ainda e feita pela tela de contas — la voce confere valor e data antes de confirmar.',
      [
        abrir(
          receber ? 'Abrir contas a receber?' : 'Abrir contas a pagar?',
          receber ? '/app/financeiro/contas-a-receber' : '/app/financeiro/contas-a-pagar',
        ),
      ],
    )
  }
  if (t.includes('pendencia') || t.includes('lancar um contato') || t.includes('lancar contato')) {
    return r('acao_crm', 'Pendencias e contatos ficam no quadro do CRM.', [
      abrir('Abrir o CRM?', '/app/crm'),
    ])
  }
  if (t.includes('gerar contas a pagar')) {
    return r(
      'acao_custos_fixos',
      'As contas do mes saem dos custos fixos, em Plano de contas — o botao "Gerar contas do mes".',
      [abrir('Abrir o plano de contas?', '/app/financeiro/plano-de-contas')],
    )
  }
  if (t.includes('cadastr') && !t.includes('esta cadastrad')) {
    return r(
      'cadastrar_cliente',
      'O cadastro abre no formulario completo, com busca de CPF e CEP.',
      [
        {
          tipo: 'confirmacao',
          pergunta: 'Abrir o cadastro de cliente?',
          acao: 'abrir_cadastro_cliente',
        },
      ],
    )
  }

  /* ---------------- vendas ---------------- */

  if (t.includes('estornad') || t.includes('cancelad') || t.includes('devolvid')) {
    const h = await fontes.historico(somarDias(hoje, -30), hoje, 100)
    if (!h.ok) return r('vendas_estornadas', NAO_CONSEGUI)
    const desfeitas = h.dados.vendas.filter(
      (v) => v.status === 'cancelled' || v.status === 'returned' || v.devolvidoValor > 0,
    )
    return r(
      'vendas_estornadas',
      desfeitas.length === 0
        ? 'Nenhuma venda cancelada ou devolvida nos ultimos 30 dias.'
        : `${desfeitas.length} venda(s) cancelada(s) ou com devolucao nos ultimos 30 dias:`,
      desfeitas.length === 0
        ? []
        : [
            {
              tipo: 'tabela',
              titulo: 'Canceladas e devolvidas',
              colunas: ['Venda', 'Cliente', 'Situacao', 'Valor'],
              linhas: desfeitas.map((v) => [
                `#${v.numero}`,
                v.clienteNome ?? 'Balcao',
                v.status === 'cancelled'
                  ? 'Cancelada'
                  : `Devolvido ${formatMoney(v.devolvidoValor)}`,
                formatMoney(v.total),
              ]),
            },
          ],
    )
  }

  if (t.includes('ticket')) {
    const de = somarDias(hoje, -6)
    const h = await fontes.historico(de, hoje, 1)
    if (!h.ok) return r('ticket_medio', NAO_CONSEGUI)
    const { ticketMedio, quantidade, faturamento } = h.dados.resumo
    return r(
      'ticket_medio',
      ticketMedio === null
        ? 'Nenhuma venda nos ultimos 7 dias, entao nao ha ticket medio.'
        : `Ticket medio dos ultimos 7 dias: ${formatMoney(ticketMedio)} (bruto, antes do desconto).`,
      ticketMedio === null
        ? []
        : [
            {
              tipo: 'indicador',
              rotulo: 'Ticket medio bruto (7 dias)',
              valor: formatMoney(ticketMedio),
              apoio: `${quantidade} vendas · ${formatMoney(faturamento)}`,
            },
          ],
    )
  }

  if (t.includes('mes a mes') && t.includes('faturamento')) {
    const f = await fontes.faturamento(mesesAntes(hoje, 5), fimDoMes(hoje))
    if (!f.ok) return r('faturamento_mensal', NAO_CONSEGUI)
    return r('faturamento_mensal', 'Faturamento dos ultimos 6 meses:', [
      {
        tipo: 'tabela',
        titulo: 'Faturamento mes a mes',
        colunas: ['Mes', 'Bruto', 'Liquido', 'Vendas'],
        linhas: f.dados.months.map((m) => [
          rotuloDoMes(m.month),
          centavos(m.grossCents),
          centavos(m.netCents),
          String(m.salesCount),
        ]),
      },
    ])
  }

  if (t.includes('quanto vendi') || t.includes('faturamento')) {
    const [h, f] = await Promise.all([
      fontes.historico(hoje, hoje, 1),
      fontes.faturamento(mesesAntes(hoje, 2), fimDoMes(hoje)),
    ])
    if (!h.ok) return r('faturamento', NAO_CONSEGUI)
    const { faturamento, liquido, quantidade } = h.dados.resumo
    return r(
      'faturamento',
      `Hoje voce vendeu ${formatMoney(faturamento)} brutos em ${quantidade} vendas. Liquido: ${formatMoney(liquido)}, ja sem desconto, imposto e taxa de cartao.`,
      [
        {
          tipo: 'indicador',
          rotulo: 'Faturamento bruto hoje',
          valor: formatMoney(faturamento),
          apoio: `${quantidade} vendas`,
        },
        {
          tipo: 'indicador',
          rotulo: 'Faturamento liquido hoje',
          valor: formatMoney(liquido),
          apoio: 'sem desconto, imposto e taxa de cartao',
        },
        ...(f.ok
          ? [
              {
                tipo: 'tabela' as const,
                titulo: 'Ultimos meses',
                colunas: ['Mes', 'Bruto', 'Liquido', 'Vendas'],
                linhas: [...f.dados.months]
                  .reverse()
                  .map((m) => [
                    rotuloDoMes(m.month),
                    centavos(m.grossCents),
                    centavos(m.netCents),
                    String(m.salesCount),
                  ]),
              },
            ]
          : []),
      ],
    )
  }

  /* ---------------- plano de contas e DRE ---------------- */

  if (t.includes('dre')) {
    const d = await fontes.dre(inicioDoMes(hoje), fimDoMes(hoje))
    if (!d.ok) return r('dre', NAO_CONSEGUI)
    const x = d.dados
    return r(
      'dre',
      `DRE de ${rotuloDoMes(hoje.slice(0, 7))}: resultado de ${centavos(x.resultCents)}.`,
      [
        {
          tipo: 'lista',
          titulo: `DRE ${rotuloDoMes(hoje.slice(0, 7))}`,
          itens: [
            { rotulo: 'Receita bruta', valor: centavos(x.grossRevenueCents) },
            { rotulo: 'Deducoes', valor: centavos(-x.deductionsCents) },
            { rotulo: 'Custo', valor: centavos(-x.costCents) },
            { rotulo: 'Despesas', valor: centavos(-x.expensesCents) },
            { rotulo: 'Resultado', valor: centavos(x.resultCents), destaque: true },
          ],
        },
        abrir('Abrir o DRE completo?', '/app/financeiro/dre'),
      ],
    )
  }

  if (t.includes('gastos') && t.includes('mes a mes')) {
    const meses = [2, 1, 0].map((n) => mesesAntes(hoje, n))
    const dres = await Promise.all(meses.map((m) => fontes.dre(m, fimDoMes(m))))
    if (dres.some((d) => !d.ok)) return r('gastos_mensais', NAO_CONSEGUI)
    return r('gastos_mensais', 'Despesas e custos dos ultimos 3 meses:', [
      {
        tipo: 'tabela',
        titulo: 'Gastos mes a mes',
        colunas: ['Mes', 'Custos', 'Despesas', 'Total'],
        linhas: dres.map((d, i) => {
          const x = (d as { ok: true; dados: Dre }).dados
          return [
            rotuloDoMes(meses[i]!.slice(0, 7)),
            centavos(x.costCents),
            centavos(x.expensesCents),
            centavos(x.costCents + x.expensesCents),
          ]
        }),
      },
    ])
  }

  if (t.includes('plano de conta') || t.includes('planos de conta')) {
    /* "Resuma o total a pagar por plano de conta": o que esta EM ABERTO. */
    if (t.includes('pagar')) {
      const [p, plano] = await Promise.all([fontes.contasAPagar(), fontes.plano()])
      if (!p.ok || !plano.ok) return r('pagar_por_plano', NAO_CONSEGUI)
      const nomes = new Map(plano.dados.map((c) => [c.id, c.name]))
      const porConta = new Map<string, number>()
      for (const c of p.dados.filter(emAberto)) {
        const nome =
          c.accountId === null
            ? 'Sem classificacao'
            : (nomes.get(c.accountId) ?? 'Sem classificacao')
        porConta.set(nome, (porConta.get(nome) ?? 0) + saldoDe(c))
      }
      const linhas = [...porConta.entries()].sort((a, b) => b[1] - a[1])
      return r(
        'pagar_por_plano',
        linhas.length === 0
          ? 'Nao ha contas a pagar em aberto.'
          : 'Total a pagar em aberto, por plano de conta:',
        linhas.length === 0
          ? []
          : [
              {
                tipo: 'tabela',
                titulo: 'A pagar por plano de conta',
                colunas: ['Plano de conta', 'Em aberto'],
                linhas: linhas.map(([nome, v]) => [nome, centavos(v)]),
              },
            ],
      )
    }

    const d = await fontes.dre(inicioDoMes(hoje), fimDoMes(hoje))
    if (!d.ok) return r('ranking_planos', NAO_CONSEGUI)
    /* "Gastos do plano de conta Fornecedores": filtra pelo nome citado. */
    const citado = /plano de conta\s+(.+)$/i.exec(texto)?.[1]?.trim()
    const gastos = d.dados.lines
      .filter((l) => l.type === 'expense' || l.type === 'cost')
      .filter((l) => !citado || normalizar(l.accountName).includes(normalizar(citado)))
      .sort((a, b) => b.amountCents - a.amountCents)
    return r(
      'ranking_planos',
      gastos.length === 0
        ? citado
          ? `Nenhum gasto no plano "${citado}" em ${rotuloDoMes(hoje.slice(0, 7))}.`
          : `Nenhum gasto lancado em ${rotuloDoMes(hoje.slice(0, 7))}.`
        : `Gastos de ${rotuloDoMes(hoje.slice(0, 7))} por plano de conta:`,
      gastos.length === 0
        ? []
        : [
            {
              tipo: 'tabela',
              titulo: 'Gastos por plano de conta',
              colunas: ['Plano de conta', 'Lancamentos', 'Total'],
              linhas: gastos.map((l) => [
                l.accountName,
                String(l.entryCount),
                centavos(l.amountCents),
              ]),
            },
          ],
    )
  }

  /* ---------------- contas a receber ---------------- */

  if (t.includes('receber') || t.includes('vencido') || t === 'ranking por cliente') {
    const rec = await fontes.contasAReceber()
    if (!rec.ok) return r('contas_receber', NAO_CONSEGUI)
    const abertos = rec.dados.filter(emAberto)

    if (t.includes('ranking')) {
      const porCliente = new Map<string, number>()
      for (const x of abertos) {
        const nome = x.customerName ?? 'Sem cliente'
        porCliente.set(nome, (porCliente.get(nome) ?? 0) + saldoDe(x))
      }
      const linhas = [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      return r('receber_por_cliente', 'Quem mais tem a pagar para a loja:', [
        {
          tipo: 'tabela',
          titulo: 'A receber por cliente',
          colunas: ['Cliente', 'Em aberto'],
          linhas: linhas.map(([nome, v]) => [nome, centavos(v)]),
        },
      ])
    }

    const vencidos = abertos.filter((x) => daysUntil(x.dueDate) < 0)
    const lista = t.includes('vencido') ? vencidos : abertos
    const total = lista.reduce((s, x) => s + saldoDe(x), 0)
    return r(
      'contas_receber',
      lista.length === 0
        ? t.includes('vencido')
          ? 'Nada vencido a receber.'
          : 'Nao ha nada a receber em aberto.'
        : `${lista.length} titulo(s) ${t.includes('vencido') ? 'vencido(s)' : 'em aberto'}, somando ${centavos(total)}.`,
      lista.length === 0
        ? []
        : [
            {
              tipo: 'lista',
              titulo: t.includes('vencido') ? 'Vencidos' : 'A receber',
              itens: [...lista]
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 10)
                .map((x) => ({
                  rotulo: `${x.customerName ?? 'Sem cliente'} · ${x.description}`,
                  valor: `${centavos(saldoDe(x))} · vence ${x.dueDate.split('-').reverse().join('/')}`,
                  destaque: daysUntil(x.dueDate) < 0,
                })),
            },
          ],
    )
  }

  /* ---------------- clientes ---------------- */

  if (t.includes('ranking') && t.includes('cliente')) {
    const de = somarDias(hoje, -89)
    const rk = await fontes.rankingDeClientes(de, hoje)
    if (!rk.ok) return r('ranking_clientes', NAO_CONSEGUI)
    const top = rk.dados.customers.slice(0, 5)
    return r(
      'ranking_clientes',
      top.length === 0
        ? 'Nenhuma venda para cliente identificado nos ultimos 90 dias.'
        : 'Seus maiores clientes nos ultimos 90 dias:',
      top.length === 0
        ? []
        : [
            {
              tipo: 'tabela',
              titulo: 'Ranking de clientes (90 dias)',
              colunas: ['Cliente', 'Compras', 'Total'],
              linhas: top.map((c) => [c.customerName, String(c.salesCount), centavos(c.netCents)]),
            },
          ],
    )
  }

  if (t.includes('nao compram') || t.includes('sumiram') || t.includes('inativ')) {
    const c = await fontes.clientes({ filtro: 'inativos' })
    if (!c.ok) return r('clientes_inativos', NAO_CONSEGUI)
    return r(
      'clientes_inativos',
      c.dados.length === 0
        ? 'Nenhum cliente sem comprar ha mais de 60 dias.'
        : `${c.dados.length} cliente(s) sem comprar ha mais de 60 dias.`,
      c.dados.length === 0
        ? []
        : [
            {
              tipo: 'lista',
              titulo: 'Sem comprar ha 60 dias',
              itens: c.dados.slice(0, 15).map((x) => ({
                rotulo: x.nome,
                valor:
                  x.ultimaCompra === null
                    ? 'nunca comprou'
                    : `ha ${Math.abs(daysUntil(x.ultimaCompra))} dias`,
              })),
            },
          ],
    )
  }

  /* ---------------- produtos ---------------- */

  if ((t.includes('ranking') && t.includes('produto')) || t.includes('mais vendidos')) {
    const rk = await fontes.rankingDeProdutos(somarDias(hoje, -29), hoje)
    if (!rk.ok) return r('ranking_produtos', NAO_CONSEGUI)
    const top = rk.dados.products.slice(0, 5)
    return r(
      'ranking_produtos',
      top.length === 0
        ? 'Nenhum produto vendido nos ultimos 30 dias.'
        : 'Mais vendidos nos ultimos 30 dias:',
      top.length === 0
        ? []
        : [
            {
              tipo: 'tabela',
              titulo: 'Mais vendidos (30 dias)',
              colunas: ['Produto', 'Qtd', 'Faturamento'],
              linhas: top.map((p) => [p.productName, String(p.quantity), centavos(p.netCents)]),
            },
          ],
    )
  }

  if (t.includes('lucrativ')) {
    const c = await fontes.catalogo('todos')
    if (!c.ok) return r('produtos_lucrativos', NAO_CONSEGUI)
    const top = c.dados
      .filter((p) => p.precoVenda > 0)
      .map((p) => ({ p, margem: ((p.precoVenda - p.precoCusto) / p.precoVenda) * 100 }))
      .sort((a, b) => b.margem - a.margem)
      .slice(0, 5)
    return r('produtos_lucrativos', 'Os produtos com maior margem:', [
      {
        tipo: 'tabela',
        titulo: 'Maior margem',
        colunas: ['Produto', 'Custo', 'Venda', 'Margem'],
        linhas: top.map(({ p, margem }) => [
          p.descricao,
          formatMoney(p.precoCusto),
          formatMoney(p.precoVenda),
          `${margem.toFixed(1).replace('.', ',')}%`,
        ]),
      },
    ])
  }

  if (t.includes('sem venda') || t.includes('nao vende') || t.includes('parado')) {
    const [c, rk] = await Promise.all([
      fontes.catalogo('todos'),
      fontes.rankingDeProdutos(somarDias(hoje, -59), hoje),
    ])
    if (!c.ok || !rk.ok) return r('produtos_parados', NAO_CONSEGUI)
    const vendidos = new Set(rk.dados.products.map((p) => p.productId))
    const parados = c.dados.filter((p) => !vendidos.has(p.id) && p.estoque > 0)
    return r(
      'produtos_parados',
      parados.length === 0
        ? 'Todo produto com estoque vendeu nos ultimos 60 dias.'
        : `${parados.length} produto(s) com estoque e sem venda nos ultimos 60 dias.`,
      parados.length === 0
        ? []
        : [
            {
              tipo: 'lista',
              titulo: 'Sem venda em 60 dias',
              itens: parados.slice(0, 15).map((p) => ({
                rotulo: p.descricao,
                valor: `${p.estoque} em estoque`,
              })),
            },
          ],
    )
  }

  if (t.includes('reposic') || t.includes('estoque')) {
    const c = await fontes.catalogo('baixo')
    if (!c.ok) return r('reposicao', NAO_CONSEGUI)
    return r(
      'reposicao',
      c.dados.length === 0
        ? 'Nenhum produto abaixo do estoque minimo.'
        : `${c.dados.length} produto(s) no minimo ou abaixo dele.`,
      c.dados.length === 0
        ? []
        : [
            {
              tipo: 'lista',
              titulo: 'Precisa repor',
              itens: c.dados.map((p) => ({
                rotulo: p.descricao,
                valor: `${p.estoque} em estoque · minimo ${p.estoqueMinimo}`,
                destaque: p.estoque <= 0,
              })),
            },
          ],
    )
  }

  /* ---------------- contas a pagar ---------------- */

  if (t.includes('pagar')) {
    const p = await fontes.contasAPagar()
    if (!p.ok) return r('contas_pagar', NAO_CONSEGUI)
    const abertas = p.dados.filter(emAberto)
    const vencidas = abertas.filter((c) => c.dueDate < hoje)
    const itens = (lista: ContaAPagar[], destaque = false) =>
      lista.map((c) => ({
        rotulo: `${c.supplier} · ${c.description}`,
        valor: `${centavos(saldoDe(c))} · ${c.dueDate.split('-').reverse().join('/')}`,
        destaque,
      }))

    if (t.includes('total')) {
      const total = abertas.reduce((s, c) => s + saldoDe(c), 0)
      const totalVencido = vencidas.reduce((s, c) => s + saldoDe(c), 0)
      return r('total_pagar', `Total a pagar em aberto: ${centavos(total)}.`, [
        {
          tipo: 'indicador',
          rotulo: 'Total a pagar',
          valor: centavos(total),
          apoio: `${abertas.length} conta(s) · ${centavos(totalVencido)} vencido`,
        },
      ])
    }

    const ate = t.includes('sexta') ? proximaSexta(hoje) : hoje
    const noPeriodo = abertas.filter((c) => c.dueDate >= hoje && c.dueDate <= ate)
    const total = noPeriodo.reduce((s, c) => s + saldoDe(c), 0)
    const periodo = t.includes('sexta') ? 'ate sexta' : 'hoje'
    return r(
      'contas_pagar',
      noPeriodo.length === 0
        ? `Nada vencendo ${periodo}.`
        : `${noPeriodo.length} conta(s) vencendo ${periodo}, somando ${centavos(total)}.`,
      [
        ...(noPeriodo.length > 0
          ? [{ tipo: 'lista' as const, titulo: `Vence ${periodo}`, itens: itens(noPeriodo) }]
          : []),
        ...(vencidas.length > 0
          ? [{ tipo: 'lista' as const, titulo: 'Em atraso', itens: itens(vencidas, true) }]
          : []),
      ],
    )
  }

  /* ---------------- um cliente especifico ---------------- */

  const nome = nomeCitado(texto)
  const falaDeCliente =
    nome !== null ||
    t.includes('o que ele comprou') ||
    t.includes('o que ela comprou') ||
    t.includes('ultima compra') ||
    t.includes('devendo') ||
    t.includes('esta cadastrad')

  if (falaDeCliente) {
    if (nome !== null) {
      const achados = await fontes.clientes({ termo: nome })
      if (!achados.ok) return r('cliente', NAO_CONSEGUI)
      const cliente = achados.dados[0]
      if (cliente === undefined) {
        return r('cliente_nao_encontrado', `Nao achei nenhum cliente com "${nome}".`, [
          { tipo: 'confirmacao', pergunta: 'Quer cadastrar?', acao: 'abrir_cadastro_cliente' },
        ])
      }
      ctx.clienteId = cliente.id
      ctx.clienteNome = cliente.nome
    }

    if (ctx.clienteId === null) {
      return r('sem_contexto', 'De qual cliente voce esta falando? Diga o nome que eu busco.')
    }
    const nomeDoCliente = ctx.clienteNome ?? 'o cliente'

    if (t.includes('devendo') || t.includes('deve')) {
      const pend = await fontes.pendenciasDoCliente(ctx.clienteId)
      if (!pend.ok) return r('divida_cliente', NAO_CONSEGUI)
      const total = pend.dados.reduce((s, x) => s + x.valor, 0)
      return r(
        'divida_cliente',
        pend.dados.length === 0
          ? `${nomeDoCliente} nao deve nada.`
          : `${nomeDoCliente} deve ${formatMoney(total)}.`,
        pend.dados.length === 0
          ? []
          : [
              {
                tipo: 'lista',
                titulo: `Em aberto de ${nomeDoCliente}`,
                itens: pend.dados.map((x) => ({
                  rotulo: x.referente,
                  valor: `${formatMoney(x.valor)} · vence ${diaBr(x.vencimento)}`,
                  destaque: x.status === 'vencido',
                })),
              },
            ],
      )
    }

    const compras = await fontes.comprasDoCliente(ctx.clienteId)
    if (!compras.ok) return r('compras_cliente', NAO_CONSEGUI)

    if (t.includes('esta cadastrad')) {
      return r(
        'resumo_cliente',
        `${nomeDoCliente} esta cadastrado, com ${compras.dados.length} compra(s).`,
        [{ tipo: 'texto', texto: 'Pergunte, por exemplo: o que ele comprou?' }],
      )
    }

    if (t.includes('ultima compra')) {
      const ultima = compras.dados[0]
      return r(
        'ultima_compra',
        ultima === undefined
          ? `${nomeDoCliente} ainda nao comprou.`
          : `A ultima compra de ${nomeDoCliente} foi em ${diaBr(ultima.data)}, de ${formatMoney(ultima.valor)}.`,
      )
    }

    return r(
      'compras_cliente',
      compras.dados.length === 0
        ? `${nomeDoCliente} ainda nao comprou.`
        : `As ultimas compras de ${nomeDoCliente}:`,
      compras.dados.length === 0
        ? []
        : [
            {
              tipo: 'tabela',
              titulo: `Compras de ${nomeDoCliente}`,
              colunas: ['Venda', 'Data', 'Itens', 'Total'],
              linhas: compras.dados
                .slice(0, 10)
                .map((v) => [v.numero, diaBr(v.data), String(v.itens), formatMoney(v.valor)]),
            },
          ],
    )
  }

  /* --- Nao entendeu --- */
  return r(
    'desconhecida',
    'Ainda nao sei responder isso. Tente uma das sugestoes abaixo, ou pergunte sobre vendas, clientes, produtos ou contas.',
  )
}

/**
 * SUBSTITUIR POR: POST /assistente/mensagens
 *
 * Recebe a pergunta e o contexto corrente e devolve a resposta com o
 * contexto atualizado.
 */
export function enviarMensagem(texto: string, contexto: Contexto): Promise<Resposta> {
  return responder(texto, contexto, FONTES_REAIS, diaLocal(new Date()))
}
