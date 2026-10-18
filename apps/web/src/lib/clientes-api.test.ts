import { camposFaltandoNoCliente as doContrato } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { camposFaltandoNoCliente } from './clientes-api'

/* A copia do web contra o contrato de verdade (DEC-025): se um mudar e o
   outro nao, o aviso de cadastro incompleto da tela mente. */
describe('cadastro incompleto: a copia do web e o contrato', () => {
  const COMPLETO = {
    document: '52998224725',
    phone: '41988887777',
    address: {
      zipCode: '80010000',
      street: 'Rua XV',
      number: '100',
      district: 'Centro',
      city: 'Curitiba',
      state: 'PR',
    },
  }
  const VAZIO = {
    zipCode: null,
    street: null,
    number: null,
    district: null,
    city: null,
    state: null,
  }

  it.each([
    ['completo', COMPLETO],
    ['cliente antigo so com nome', { document: null, phone: null, address: VAZIO }],
    ['sem documento', { ...COMPLETO, document: null }],
    ['sem bairro', { ...COMPLETO, address: { ...COMPLETO.address, district: '  ' } }],
    ['sem celular', { ...COMPLETO, phone: null }],
  ])('%s', (_caso, cliente) => {
    expect(camposFaltandoNoCliente(cliente)).toEqual(doContrato(cliente))
  })
})
