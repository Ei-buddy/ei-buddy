import { isAppError } from '@na-regua/core'
import { describe, expect, it } from 'vitest'
import { lerCertificadoA1, validadeConferida } from './certificado-a1.js'
import {
  A1_ANTIGO_RC2,
  A1_MODERNO_ATE_2099,
  A1_VENCIDO_EM_2025,
  SENHA_DOS_CERTIFICADOS_DE_TESTE as SENHA,
} from './certificados-de-teste.js'

/** Abrir o A1 antes de guardar — NR-214. */

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const FUSO = 'America/Sao_Paulo'
const HOJE = new Date('2026-11-12T15:00:00.000Z')

const erroDe = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    return e
  }
  return undefined
}

describe('lerCertificadoA1', () => {
  it('abre com a senha certa e le a validade do arquivo', () => {
    const r = lerCertificadoA1(bytes(A1_MODERNO_ATE_2099), SENHA)
    expect(r.situacao).toBe('lido')
    expect(r.situacao === 'lido' && r.venceEm.toISOString()).toBe('2099-12-31T23:59:59.000Z')
  })

  it('senha errada e senha errada, no moderno e no antigo', () => {
    expect(lerCertificadoA1(bytes(A1_MODERNO_ATE_2099), 'outra')).toEqual({
      situacao: 'senha_errada',
    })
    expect(lerCertificadoA1(bytes(A1_ANTIGO_RC2), 'outra')).toEqual({ situacao: 'senha_errada' })
  })

  it('o antigo (RC2) com a senha certa: confere, mas nao le a validade', () => {
    expect(lerCertificadoA1(bytes(A1_ANTIGO_RC2), SENHA)).toEqual({ situacao: 'sem_leitura' })
  })

  it('arquivo que nao e certificado', () => {
    expect(lerCertificadoA1(new TextEncoder().encode('ola, nao sou um pfx'), SENHA)).toEqual({
      situacao: 'nao_e_certificado',
    })
    expect(lerCertificadoA1(new Uint8Array(3000).fill(7), SENHA)).toEqual({
      situacao: 'nao_e_certificado',
    })
  })

  it('le o vencido tambem — quem recusa e a regra, nao a leitura', () => {
    const r = lerCertificadoA1(bytes(A1_VENCIDO_EM_2025), SENHA)
    expect(r.situacao === 'lido' && r.venceEm.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })
})

describe('validadeConferida', () => {
  it('lido: vale a data do arquivo, mesmo com outra digitada', () => {
    const leitura = lerCertificadoA1(bytes(A1_MODERNO_ATE_2099), SENHA)
    expect(validadeConferida(leitura, '2027-03-15', HOJE, FUSO)).toBe('2099-12-31')
    expect(validadeConferida(leitura, undefined, HOJE, FUSO)).toBe('2099-12-31')
  })

  it('a data e a do fuso da loja: 01/01 00:00 UTC ainda e 31/12 em Brasilia', () => {
    const leitura = { situacao: 'lido' as const, venceEm: new Date('2027-01-01T00:00:00.000Z') }
    expect(validadeConferida(leitura, undefined, HOJE, FUSO)).toBe('2026-12-31')
  })

  it('vencido e recusado, dizendo quando venceu', () => {
    const e = erroDe(() =>
      validadeConferida(lerCertificadoA1(bytes(A1_VENCIDO_EM_2025), SENHA), undefined, HOJE, FUSO),
    )
    expect(isAppError(e) && e.code).toBe('VALIDATION_FAILED')
    expect(isAppError(e) && e.message).toBe(
      'Este certificado venceu em 31/12/2024. Envie o certificado renovado.',
    )
  })

  it('vence hoje ainda vale', () => {
    const leitura = { situacao: 'lido' as const, venceEm: new Date('2026-11-12T23:00:00.000Z') }
    expect(validadeConferida(leitura, undefined, HOJE, FUSO)).toBe('2026-11-12')
  })

  it('senha errada aponta o campo da senha', () => {
    const e = erroDe(() => validadeConferida({ situacao: 'senha_errada' }, undefined, HOJE, FUSO))
    expect(isAppError(e) && e.fields).toEqual([
      { path: 'certificatePassword', message: 'Senha não confere com o certificado.' },
    ])
  })

  it('arquivo que nao e certificado aponta o arquivo', () => {
    const e = erroDe(() =>
      validadeConferida({ situacao: 'nao_e_certificado' }, '2030-01-01', HOJE, FUSO),
    )
    expect(isAppError(e) && e.fields[0]?.path).toBe('certificateBase64')
  })

  it('sem leitura: vale a digitada; sem ela, pede a data', () => {
    expect(validadeConferida({ situacao: 'sem_leitura' }, '2030-05-20', HOJE, FUSO)).toBe(
      '2030-05-20',
    )
    const e = erroDe(() => validadeConferida({ situacao: 'sem_leitura' }, undefined, HOJE, FUSO))
    expect(isAppError(e) && e.fields[0]?.path).toBe('certificateExpiresAt')
  })
})
