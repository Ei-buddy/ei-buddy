import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cadastro de cliente pelo app — RF-008, RF-010.
 *
 * O que importa guardar: o 409 com candidatos vira "parece que ja existe" (e
 * nao um erro generico), e o corpo so leva o que foi preenchido — a api recusa
 * endereco todo vazio e documento com mascara.
 */

const chamadas: { caminho: string; opcoes?: { body?: unknown } }[] = []
let resposta: unknown

vi.mock('./api', () => ({
  chamarApi: vi.fn((caminho: string, opcoes?: { body?: unknown }) => {
    chamadas.push({ caminho, opcoes })
    return Promise.resolve(resposta)
  }),
}))

const { listarClientes, resumoDeClientes, salvarCliente } = await import('./clientes-api')

const VAZIO = {
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
}

const dados = {
  documento: '529.982.247-25',
  nome: ' Joana Ribeiro ',
  nomeFantasia: '',
  telefone: '(41) 99876-5432',
  email: '',
  limiteFiado: '',
  endereco: VAZIO,
}

beforeEach(() => {
  chamadas.length = 0
})

describe('salvarCliente', () => {
  it('manda so digitos e omite o que ficou em branco', async () => {
    resposta = { ok: true, dados: { id: 'c-1' } }

    expect(await salvarCliente(dados)).toEqual({ ok: true, id: 'c-1' })
    expect(chamadas[0]?.caminho).toBe('/clientes')
    expect(chamadas[0]?.opcoes?.body).toEqual({
      name: 'Joana Ribeiro',
      document: '52998224725',
      phone: '41998765432',
    })
  })

  it('manda o limite do fiado em centavos — sem ele, a carteira e recusada', async () => {
    resposta = { ok: true, dados: { id: 'c-2' } }
    await salvarCliente({ ...dados, limiteFiado: '150,00' })
    expect(chamadas[0]?.opcoes?.body).toMatchObject({ walletLimitCents: 15000 })
  })

  it('409 com candidatos devolve os duplicados, e "mesmo assim" vai com a permissao', async () => {
    const candidatos = [{ id: 'c-9', name: 'Joana R.', phone: '41998765432', document: null }]
    resposta = {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: 'Parece duplicado',
      corpo: { candidates: candidatos },
    }

    expect(await salvarCliente(dados)).toEqual({ ok: false, duplicados: candidatos })

    await salvarCliente(dados, { permitirDuplicado: true })
    expect(chamadas[1]?.caminho).toBe('/clientes?duplicado=permitir')
  })
})

describe('resumo e paginas da lista — NR-211', () => {
  beforeEach(() => {
    chamadas.length = 0
  })

  it('resumo da loja inteira em reais', async () => {
    resposta = {
      ok: true,
      dados: { total: 12, withBalance: { count: 2, balanceCents: 4_550 }, inactive: 5 },
    }
    expect(await resumoDeClientes()).toEqual({
      ok: true,
      dados: { total: 12, comPendencia: 2, totalPendente: 45.5, semComprar: 5 },
    })
    expect(chamadas[0]?.caminho).toBe('/clientes/resumo')
  })

  it('erro do resumo vira a mensagem', async () => {
    resposta = { ok: false, message: 'Sem conexão.' }
    expect(await resumoDeClientes()).toEqual({ ok: false, erro: 'Sem conexão.' })
  })

  it('"Carregar mais" pede a pagina seguinte; a primeira vai sem page', async () => {
    resposta = { ok: true, dados: { customers: [], total: 0 } }
    await listarClientes({ filtro: 'inativos' })
    await listarClientes({ filtro: 'inativos', pagina: 2 })
    expect(chamadas.map((c) => c.caminho)).toEqual([
      '/clientes?filter=inativos',
      '/clientes?filter=inativos&page=2',
    ])
  })
})
