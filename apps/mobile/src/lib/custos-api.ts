import { chamarApi } from './api'

/**
 * Custos fixos e variaveis — NR-110, as mesmas rotas do web.
 *
 * Fixo e o que vence todo mes (aluguel, internet) e vira conta a pagar quando
 * o mes e gerado. Variavel e percentual sobre o preco de venda (taxa, imposto,
 * comissao), e o cadastro de produto mostra quanto sobra depois dele.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export type CustoFixo = {
  id: string
  nome: string
  valorCents: number
  diaVencimento: number
  planoContasId: string | null
  planoContasNome: string | null
}

type CustoFixoDaApi = {
  id: string
  name: string
  amountCents: number
  dueDay: number
  accountId: string | null
  accountName: string | null
}

const paraCustoFixo = (c: CustoFixoDaApi): CustoFixo => ({
  id: c.id,
  nome: c.name,
  valorCents: c.amountCents,
  diaVencimento: c.dueDay,
  planoContasId: c.accountId,
  planoContasNome: c.accountName,
})

export async function carregarCustosFixos(): Promise<Resultado<CustoFixo[]>> {
  const r = await chamarApi<{ fixedCosts: CustoFixoDaApi[] }>('/custos-fixos')
  return r.ok
    ? { ok: true, dados: r.dados.fixedCosts.map(paraCustoFixo) }
    : { ok: false, erro: r.message }
}

export type DadosCustoFixo = {
  nome: string
  valorCents: number
  diaVencimento: number
  planoContasId: string | null
}

const corpo = (d: DadosCustoFixo) => ({
  name: d.nome.trim(),
  amountCents: d.valorCents,
  dueDay: d.diaVencimento,
  ...(d.planoContasId === null ? {} : { accountId: d.planoContasId }),
})

export async function salvarCustoFixo(
  dados: DadosCustoFixo,
  id?: string,
): Promise<Resultado<CustoFixo>> {
  const r = await chamarApi<CustoFixoDaApi>(
    id === undefined ? '/custos-fixos' : `/custos-fixos/${encodeURIComponent(id)}`,
    { method: id === undefined ? 'POST' : 'PATCH', body: corpo(dados) },
  )
  return r.ok ? { ok: true, dados: paraCustoFixo(r.dados) } : { ok: false, erro: r.message }
}

export async function excluirCustoFixo(id: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/custos-fixos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}

/**
 * Gera as contas a pagar do mes — so do mes corrente: gerar num mes ja fechado
 * joga lancamento no passado e desarruma o DRE daquele mes.
 */
export async function gerarContasDoMes(
  competencia: string,
): Promise<Resultado<{ geradas: number; jaExistiam: number }>> {
  const r = await chamarApi<{ generatedCount: number; alreadyExistedCount: number }>(
    '/custos-fixos/gerar',
    { method: 'POST', body: { competencia } },
  )
  return r.ok
    ? {
        ok: true,
        dados: { geradas: r.dados.generatedCount, jaExistiam: r.dados.alreadyExistedCount },
      }
    : { ok: false, erro: r.message }
}

export type CustoVariavel = { id: string; nome: string; percentual: number }

export async function carregarCustosVariaveis(): Promise<Resultado<CustoVariavel[]>> {
  const r = await chamarApi<{ variableCosts: { id: string; name: string; ratePercent: number }[] }>(
    '/custos-variaveis',
  )
  return r.ok
    ? {
        ok: true,
        dados: r.dados.variableCosts.map((c) => ({
          id: c.id,
          nome: c.name,
          percentual: c.ratePercent,
        })),
      }
    : { ok: false, erro: r.message }
}

export async function criarCustoVariavel(
  nome: string,
  percentual: number,
): Promise<Resultado<CustoVariavel>> {
  const r = await chamarApi<{ id: string; name: string; ratePercent: number }>(
    '/custos-variaveis',
    { method: 'POST', body: { name: nome.trim(), ratePercent: percentual } },
  )
  return r.ok
    ? { ok: true, dados: { id: r.dados.id, nome: r.dados.name, percentual: r.dados.ratePercent } }
    : { ok: false, erro: r.message }
}

/** Editar nome e percentual — NR-152. */
export async function editarCustoVariavel(
  id: string,
  nome: string,
  percentual: number,
): Promise<Resultado<CustoVariavel>> {
  const r = await chamarApi<{ id: string; name: string; ratePercent: number }>(
    `/custos-variaveis/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { name: nome.trim(), ratePercent: percentual } },
  )
  return r.ok
    ? { ok: true, dados: { id: r.dados.id, nome: r.dados.name, percentual: r.dados.ratePercent } }
    : { ok: false, erro: r.message }
}

export async function excluirCustoVariavel(id: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>(`/custos-variaveis/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}
