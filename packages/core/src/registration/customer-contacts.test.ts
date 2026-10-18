import type { Role } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { addCustomerContact, listCustomerContacts } from './customer-contacts.js'
import { InMemoryCustomerContacts, InMemoryCustomerRepository } from './fakes.js'
import { registerCustomer } from './register-customer.js'

/* Documento, celular e endereco sao obrigatorios no cadastro (NR-142, NR-149). O celular muda a
   cada chamada: repetido, o cadastro acusaria cliente duplicado. */
let celularDoTeste = 0
const ENDERECO_DO_TESTE = {
  zipCode: '80010000',
  street: 'Rua XV de Novembro',
  number: '100',
  district: 'Centro',
  city: 'Curitiba',
  state: 'PR',
} as const
/* CPF valido e unico por chamada: repetido, o cadastro acusaria duplicado. */
function cpfDoTeste(n: number): string {
  const base = String(100_000_000 + n)
    .slice(-9)
    .split('')
    .map(Number)
  const dv = (d: number[]) => {
    const soma = d.reduce((a, x, i) => a + x * (d.length + 1 - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  base.push(dv(base))
  base.push(dv(base))
  return base.join('')
}

function cliente<T extends object>(campos: T) {
  celularDoTeste += 1
  return {
    document: cpfDoTeste(celularDoTeste),
    phone: `4198${String(celularDoTeste).padStart(7, '0')}`,
    address: ENDERECO_DO_TESTE,
    ...campos,
  }
}

/** Contatos da ficha — RF-011, NR-072. */

const AGORA = new Date('2026-09-24T13:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

async function cenario() {
  const customers = new InMemoryCustomerRepository()
  const contacts = new InMemoryCustomerContacts(customers)

  const r = await registerCustomer({ customers }, contexto(), cliente({ name: 'Joao do Bar' }))
  if (r.status !== 'created') throw new Error('esperava created')

  return { deps: { contacts }, clienteId: r.customer.id }
}

describe('contatos da ficha — RF-011', () => {
  /*
   * Sem data, o dia vem de `ctx.now` — nao de `new Date()` dentro da funcao.
   * Caso de uso que le o relogio sozinho nao e testavel, e isto e a prova.
   */
  it('sem data, usa o dia de hoje do contexto', async () => {
    const { deps, clienteId } = await cenario()

    const contato = await addCustomerContact(deps, contexto(), clienteId, {
      kind: 'note',
      description: 'Passou no balcao perguntando por azeite.',
    })

    expect(contato.happenedOn).toBe('2026-09-24')
  })

  /*
   * Cliente de outra empresa cai no MESMO 404 de "nao existe": um erro
   * diferente confirmaria, para quem estivesse tentando ids, que aquele
   * cliente existe em alguma outra loja.
   */
  it('cliente de outra empresa responde NOT_FOUND', async () => {
    const { deps, clienteId } = await cenario()

    const erro = await addCustomerContact(deps, contexto({ companyId: 'emp-2' }), clienteId, {
      kind: 'call',
      description: 'Nao deveria gravar.',
    }).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  /* Do dia do FATO mais recente para o mais antigo — e nao da ordem de
     lancamento: quem anota na segunda a ligacao do sabado espera ve-la no
     sabado. */
  it('ordena pelo dia do fato, do mais recente para o mais antigo', async () => {
    const { deps, clienteId } = await cenario()

    await addCustomerContact(deps, contexto(), clienteId, {
      kind: 'call',
      description: 'A mais antiga.',
      happenedOn: '2026-09-01',
    })
    await addCustomerContact(deps, contexto(), clienteId, {
      kind: 'visit',
      description: 'A mais recente.',
      happenedOn: '2026-09-20',
    })

    const lista = await listCustomerContacts(deps, contexto(), clienteId)

    expect(lista.map((c) => c.description)).toEqual(['A mais recente.', 'A mais antiga.'])
  })

  it('nao vaza contato de outra empresa na leitura', async () => {
    const { deps, clienteId } = await cenario()
    await addCustomerContact(deps, contexto(), clienteId, {
      kind: 'call',
      description: 'So da emp-1.',
    })

    const lista = await listCustomerContacts(deps, contexto({ companyId: 'emp-2' }), clienteId)

    expect(lista).toHaveLength(0)
  })
})
