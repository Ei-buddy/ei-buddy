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

const { salvarCliente } = await import('./clientes-api')

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
