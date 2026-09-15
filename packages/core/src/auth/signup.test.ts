import { describe, expect, it } from 'vitest'
import { PLANO_DE_CONTAS_PADRAO } from '../accounting/default-chart.js'
import { InMemoryChartOfAccounts } from '../accounting/fakes.js'
import { isAppError } from '../app-error.js'
import { InMemoryLegalConsentRepository } from '../legal/fakes.js'
import { InMemoryPartnerApplicationRepository } from '../partners/fakes.js'
import { InMemoryCompanyRepository } from '../registration/fakes.js'
import { FakeIdentityProvider, InMemorySessionIssuer } from './fakes.js'
import { signup } from './signup.js'

/**
 * Cadastro de conta — NR-014, RF-001, RF-002.
 *
 * O primeiro acesso ao sistema. O que se guarda aqui e a ORDEM das escritas:
 * ela e o que impede os estados que nao servem para nada — credencial sem loja,
 * loja sem dono, conta que existe e nao entra.
 */

const AGORA = new Date('2026-09-04T12:00:00.000Z')

const entrada = {
  name: 'Ana Souza',
  email: 'ana@mercearia.local',
  phone: '41999990000',
  secret: 'senha-de-teste-longa',
  legalName: 'Mercearia da Ana LTDA',
  cnpj: '11222333000181',
  /* RF-02: o contrato nao aceita cadastro sem aceite — `literal(true)`. */
  acceptedLegalTerms: true as const,
}

function cenario() {
  const companies = new InMemoryCompanyRepository()
  const accounts = new InMemoryChartOfAccounts()
  const provider = new FakeIdentityProvider()
  const sessions = new InMemorySessionIssuer()
  const partners = new InMemoryPartnerApplicationRepository()
  const legalConsents = new InMemoryLegalConsentRepository()

  /* O diretorio nao tem falso proprio: o minimo que o caso de uso usa. */
  const criados: { id: string; name: string; companyId: string }[] = []
  const users = {
    createUserWithAccess: async (c: {
      companyId: string
      name: string
      email: string | null
      phone: string | null
    }) => {
      const usuario = { id: `usr-${criados.length + 1}`, name: c.name, isActive: true }
      criados.push({ id: usuario.id, name: c.name, companyId: c.companyId })
      return usuario
    },
  }

  return {
    deps: {
      companies,
      accounts,
      users,
      registrar: provider,
      sessions,
      partners,
      legalConsents,
    } as never,
    companies,
    accounts,
    provider,
    partners,
    legalConsents,
    criados,
  }
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('cadastro de conta', () => {
  it('cria pessoa, loja e vinculo, e devolve a sessao ABERTA', async () => {
    const c = cenario()

    const sessao = await signup(c.deps, entrada, AGORA)

    /* Quem acabou de cadastrar quer usar o sistema. Mandar para a tela de login
       digitar de novo o que digitou ha dois segundos e trocar uma tela por duas. */
    expect(sessao.token).not.toBe('')
    expect(sessao.activeCompanyId).not.toBeNull()
    expect(sessao.memberships).toHaveLength(1)
    expect(sessao.memberships[0]?.role).toBe('owner')
  })

  it('a credencial passa a valer — o login funciona depois', async () => {
    const c = cenario()

    await signup(c.deps, entrada, AGORA)

    /*
     * O defeito que este caso de uso nasceu para corrigir. Antes, o cadastro
     * criava tudo e a pessoa nao entrava: o provedor falso nascia sem
     * credencial nenhuma, e `verify` devolvia indefinido para todo mundo.
     */
    const identidade = await c.provider.verify({
      identifier: entrada.email,
      secret: entrada.secret,
    })
    expect(identidade).toBeDefined()
  })

  it('a loja nasce com o plano de contas padrao', async () => {
    const c = cenario()

    const sessao = await signup(c.deps, entrada, AGORA)

    /* RF-081: sem isto o lojista abre a tela de classificacao vazia e a
       resposta pratica dele e nao classificar nada. */
    expect(await c.accounts.list(sessao.activeCompanyId!)).toHaveLength(
      PLANO_DE_CONTAS_PADRAO.length,
    )
  })

  it('recusa CNPJ repetido sem revelar de quem e', async () => {
    const c = cenario()
    await signup(c.deps, entrada, AGORA)

    const erro = await pegaErro(() =>
      signup(c.deps, { ...entrada, email: 'outra@loja.local' }, AGORA),
    )

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    /* RF-002: a mensagem fala do que fazer, e nao de quem ja tem o cadastro. */
    expect((erro as Error).message).not.toContain('Mercearia da Ana')
  })

  it('CNPJ repetido nao deixa credencial orfa no provedor', async () => {
    const c = cenario()
    await signup(c.deps, entrada, AGORA)

    await pegaErro(() => signup(c.deps, { ...entrada, email: 'outra@loja.local' }, AGORA))

    /*
     * A ORDEM: o CNPJ e conferido ANTES de escrever no provedor. Se fosse
     * depois, sobraria uma credencial em sistema de terceiro sem loja nenhuma
     * deste lado — e ninguem aqui conseguiria apaga-la.
     */
    const orfa = await c.provider.verify({
      identifier: 'outra@loja.local',
      secret: entrada.secret,
    })
    expect(orfa).toBeUndefined()
  })

  it('e-mail ja usado e recusado sem confirmar que a conta existe', async () => {
    const c = cenario()
    await signup(c.deps, entrada, AGORA)

    const erro = await pegaErro(() => signup(c.deps, { ...entrada, cnpj: '11444777000161' }, AGORA))

    /* Dizer "ja cadastrado" a quem digitou um e-mail alheio transformaria o
       formulario num consultor de contas. */
    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    expect((erro as Error).message).not.toMatch(/ja cadastrad|ja existe/i)
  })

  it('e-mail ja usado nao cria a segunda empresa', async () => {
    const c = cenario()
    await signup(c.deps, entrada, AGORA)

    await pegaErro(() => signup(c.deps, { ...entrada, cnpj: '11444777000161' }, AGORA))

    /* A credencial e a PRIMEIRA escrita depois da checagem de CNPJ: falhando
       ali, nada nosso foi criado. */
    expect(c.criados).toHaveLength(1)
  })

  it('quem cadastra a loja e dono dela', async () => {
    const c = cenario()

    const sessao = await signup(c.deps, entrada, AGORA)

    /* Papel menor deixaria a empresa sem ninguem que possa convidar o segundo
       usuario. */
    expect(sessao.memberships[0]?.role).toBe('owner')
  })

  describe('aceite dos documentos legais — RF-02, LGPD art. 8 §1', () => {
    it('o cadastro grava a prova do aceite dos dois documentos', async () => {
      const c = cenario()

      await signup(c.deps, entrada, AGORA)

      /* Antes disto o aceite era so um checkbox que morria no navegador: a
         empresa nao tinha como provar o consentimento de ninguem. */
      expect(c.legalConsents.registros.map((r) => r.type).sort()).toEqual(['privacy', 'terms'])
    })

    it('guarda de onde veio o aceite, quando a requisicao informa', async () => {
      const c = cenario()

      await signup(c.deps, entrada, AGORA, { ip: '200.0.0.1', userAgent: 'Firefox' })

      expect(c.legalConsents.registros[0]?.ip).toBe('200.0.0.1')
      expect(c.legalConsents.registros[0]?.userAgent).toBe('Firefox')
    })

    it('a origem e opcional — sem ela o aceite continua valendo', async () => {
      const c = cenario()

      const sessao = await signup(c.deps, entrada, AGORA)

      expect(sessao.token).not.toBe('')
      expect(c.legalConsents.registros).toHaveLength(2)
    })
  })

  describe('cadastro como Parceiro — NR-115, ADR-0013', () => {
    it('sem `account`, ninguem vira candidato — e o comportamento de sempre', async () => {
      const c = cenario()
      const sessao = await signup(c.deps, entrada, AGORA)

      const minha = await c.partners.mine(sessao.activeCompanyId!)
      expect(minha).toBeUndefined()
    })

    it('`account.type: "lojista"` explicito tambem nao candidata', async () => {
      const c = cenario()
      const sessao = await signup(c.deps, { ...entrada, account: { type: 'lojista' } }, AGORA)

      const minha = await c.partners.mine(sessao.activeCompanyId!)
      expect(minha).toBeUndefined()
    })

    it('`account.type: "parceiro"` cria a candidatura pending, sessao continua abrindo normal', async () => {
      const c = cenario()
      const sessao = await signup(
        c.deps,
        {
          ...entrada,
          account: {
            type: 'parceiro',
            pixKey: '41999990000',
            pixKeyType: 'PHONE',
            message: 'Quero divulgar o Buddy para meus clientes.',
            couponCode: 'ANA10',
          },
        },
        AGORA,
      )

      /* A conta funciona como lojista imediatamente — so o cupom fica pendente. */
      expect(sessao.activeCompanyId).not.toBeNull()
      expect(sessao.memberships[0]?.role).toBe('owner')

      const minha = await c.partners.mine(sessao.activeCompanyId!)
      expect(minha?.status).toBe('pending')
      expect(minha?.couponCode).toBe('ANA10')
    })
  })
})
