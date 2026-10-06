import { describe, expect, it } from 'vitest'
import { ErroDeIntegracao } from '@na-regua/contracts'
import { camposDaFalha, safeUrl } from './logging.js'

/**
 * `REDIS_URL` e `DATABASE_URL` sao marcadas como segredo em ambientes.md e
 * carregam credencial no proprio texto. O worker logava a URL inteira ao
 * conectar — RNF-022.
 */
describe('safeUrl', () => {
  it('remove usuario e senha da URL de conexao', () => {
    const saida = safeUrl('redis://admin:senhaSuperSecreta@redis.interno:6379')

    expect(saida).not.toContain('senhaSuperSecreta')
    expect(saida).not.toContain('admin')
    expect(saida).toBe('redis://redis.interno:6379')
  })

  it('mantem host e porta, que e o que ajuda a diagnosticar', () => {
    expect(safeUrl('redis://localhost:6379')).toBe('redis://localhost:6379')
  })

  it('indica quando a porta e a padrao', () => {
    expect(safeUrl('rediss://redis.exemplo.com')).toBe('rediss://redis.exemplo.com:(padrao)')
  })

  it('funciona para Postgres tambem', () => {
    const saida = safeUrl('postgresql://naregua:naregua@localhost:5432/naregua')

    expect(saida).not.toContain('naregua:naregua')
    expect(saida).toBe('postgresql://localhost:5432')
  })

  /* Na duvida, omite: imprimir texto nao parseado pode publicar credencial. */
  it.each(['nao-e-url', '', 'redis//sem-dois-pontos'])('omite %j quando nao parseia', (entrada) => {
    expect(safeUrl(entrada)).toBe('[url invalida]')
  })
})

describe('camposDaFalha — RF-129', () => {
  it('erro de integracao leva provedor, status e a resposta, com a venda do job', () => {
    const erro = new ErroDeIntegracao('Focus NFe respondeu 502 com corpo ilegivel em /nfce.', {
      provedor: 'focusnfe',
      operacao: 'POST /nfce',
      status: 502,
      resposta: '<html>Bad Gateway</html>',
    })

    expect(camposDaFalha(erro, { saleId: 'venda-1', companyId: 'c' })).toEqual({
      error: 'Focus NFe respondeu 502 com corpo ilegivel em /nfce.',
      ref: 'venda-1',
      integracao: {
        provedor: 'focusnfe',
        operacao: 'POST /nfce',
        status: 502,
        resposta: '<html>Bad Gateway</html>',
      },
    })
  })

  it('erro comum continua so com a mensagem', () => {
    expect(camposDaFalha(new Error('Redis fora'), undefined)).toEqual({ error: 'Redis fora' })
  })
})
