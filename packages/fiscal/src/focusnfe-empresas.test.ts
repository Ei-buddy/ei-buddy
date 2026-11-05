import { ErroDeIntegracao } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import {
  corpoDaEmpresa,
  criarCadastroDeEmpresasFocus,
  type DadosDaEmpresaFocus,
} from './focusnfe-empresas.js'

const DADOS: DadosDaEmpresaFocus = {
  razaoSocial: 'Loja Teste LTDA',
  nomeFantasia: 'Loja Teste',
  cnpj: '12.345.678/0001-95',
  inscricaoEstadual: '123.456.789',
  regimeTributario: 1,
  email: 'loja@teste.local',
  telefone: '(11) 98765-4321',
  endereco: {
    cep: '01310-100',
    logradouro: 'Avenida Paulista',
    numero: '1000',
    bairro: 'Bela Vista',
    municipio: 'São Paulo',
    uf: 'sp',
  },
  certificado: { base64: 'QUJD', senha: 'segredo' },
  cscProducao: { id: '1', codigo: 'CSC-PROD' },
}

type Pedido = { url: string; init: RequestInit }

function fetchFalso(status: number, corpo: unknown) {
  const pedidos: Pedido[] = []
  const f = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init })
    return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })
  }) as unknown as typeof globalThis.fetch
  return { f, pedidos }
}

describe('corpo da empresa — NR-183', () => {
  it('manda so digitos de CNPJ, CEP, telefone e IE, e UF maiuscula', () => {
    const c = corpoDaEmpresa(DADOS)
    expect(c).toMatchObject({
      nome: 'Loja Teste LTDA',
      cnpj: '12345678000195',
      cep: '01310100',
      telefone: '11987654321',
      inscricao_estadual: '123456789',
      uf: 'SP',
      regime_tributario: 1,
      habilita_nfce: true,
      arquivo_certificado_base64: 'QUJD',
      senha_certificado: 'segredo',
      id_token_nfce_producao: '1',
      csc_nfce_producao: 'CSC-PROD',
    })
  })

  it('IE "ISENTO" vai como texto, e nao some', () => {
    expect(corpoDaEmpresa({ ...DADOS, inscricaoEstadual: 'ISENTO' }).inscricao_estadual).toBe(
      'ISENTO',
    )
  })

  it('sem certificado nem CSC, nao manda os campos (nao apaga do lado da Focus)', () => {
    const { certificado: _c, cscProducao: _p, ...semSegredo } = DADOS
    const c = corpoDaEmpresa(semSegredo)
    expect(c).not.toHaveProperty('arquivo_certificado_base64')
    expect(c).not.toHaveProperty('csc_nfce_producao')
  })
})

describe('cadastro na Focus — NR-183', () => {
  it('primeira vez cria com POST e Basic do token da revenda', async () => {
    const { f, pedidos } = fetchFalso(201, {
      id: 42,
      token_producao: 'tp',
      token_homologacao: 'th',
    })
    const r = await criarCadastroDeEmpresasFocus({ tokenDaRevenda: 'rev', fetch: f }).salvar(DADOS)

    expect(r).toEqual({
      ok: true,
      empresa: { focusId: '42', tokenProducao: 'tp', tokenHomologacao: 'th' },
    })
    expect(pedidos[0]?.url).toBe('https://api.focusnfe.com.br/v2/empresas')
    expect(pedidos[0]?.init.method).toBe('POST')
    expect((pedidos[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rev:').toString('base64')}`,
    )
  })

  it('com o id guardado, atualiza com PUT no id', async () => {
    const { f, pedidos } = fetchFalso(200, {
      id: 42,
      token_producao: 'tp',
      token_homologacao: 'th',
    })
    await criarCadastroDeEmpresasFocus({ tokenDaRevenda: 'rev', fetch: f }).salvar({
      ...DADOS,
      focusId: '42',
    })
    expect(pedidos[0]?.url).toBe('https://api.focusnfe.com.br/v2/empresas/42')
    expect(pedidos[0]?.init.method).toBe('PUT')
  })

  it('recusa de dado (422) volta como mensagem para a tela', async () => {
    const { f } = fetchFalso(422, {
      erros: [{ campo: 'senha_certificado', mensagem: 'nao abre o certificado' }],
    })
    const r = await criarCadastroDeEmpresasFocus({ tokenDaRevenda: 'rev', fetch: f }).salvar(DADOS)
    expect(r).toEqual({ ok: false, mensagem: 'senha_certificado: nao abre o certificado' })
  })

  it('token da revenda recusado e infraestrutura: lanca, nao culpa a loja', async () => {
    const { f } = fetchFalso(401, { mensagem: 'nao autorizado' })
    await expect(
      criarCadastroDeEmpresasFocus({ tokenDaRevenda: 'x', fetch: f }).salvar(DADOS),
    ).rejects.toBeInstanceOf(ErroDeIntegracao)
  })

  it('aceito sem tokens na resposta lanca, sem gravar meia empresa', async () => {
    const { f } = fetchFalso(201, { id: 42 })
    await expect(
      criarCadastroDeEmpresasFocus({ tokenDaRevenda: 'rev', fetch: f }).salvar(DADOS),
    ).rejects.toBeInstanceOf(ErroDeIntegracao)
  })
})
