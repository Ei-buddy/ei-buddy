import { describe, expect, it } from 'vitest'
import {
  ErroDeIntegracao,
  ehErroDeIntegracao,
  LIMITE_DA_RESPOSTA,
  resumirResposta,
} from './integration-error.js'

describe('ErroDeIntegracao — RF-129', () => {
  it('guarda provedor, operacao, status e a resposta resumida', () => {
    const e = new ErroDeIntegracao('O Asaas nao devolveu id da cobranca.', {
      provedor: 'asaas',
      operacao: 'criar cobranca pix',
      status: 400,
      resposta: { errors: [{ code: 'invalid_value', description: 'Valor invalido' }] },
    })
    expect(ehErroDeIntegracao(e)).toBe(true)
    expect(e.detalhes()).toEqual({
      provedor: 'asaas',
      operacao: 'criar cobranca pix',
      status: 400,
      resposta: '{"errors":[{"code":"invalid_value","description":"Valor invalido"}]}',
    })
  })

  it('corta resposta longa para nao inflar o log', () => {
    expect(resumirResposta('x'.repeat(LIMITE_DA_RESPOSTA + 50))).toHaveLength(
      LIMITE_DA_RESPOSTA + 1,
    )
  })

  it('erro comum nao e de integracao', () => {
    expect(ehErroDeIntegracao(new Error('boom'))).toBe(false)
  })
})
