import { describe, expect, it } from 'vitest'
import {
  credentialSchema,
  grantableRoleSchema,
  inviteUserInputSchema,
  invitedUserOutputSchema,
  loginInputSchema,
  membershipOutputSchema,
  normalizarIdentificadorDeLogin,
  selectCompanyInputSchema,
  sessionOutputSchema,
} from './auth.js'

describe('credencial — RF-119', () => {
  const valida = { identifier: 'ana@loja.com', secret: 'senha-certa' }

  it('aceita e-mail e senha', () => {
    expect(credentialSchema.parse(valida).identifier).toBe('ana@loja.com')
  })

  it('aceita telefone e codigo — a mesma forma serve para os dois', () => {
    expect(loginInputSchema.parse({ identifier: '41988887777', secret: '123456' }).secret).toBe(
      '123456',
    )
  })

  it('apara o identificador', () => {
    expect(credentialSchema.parse({ ...valida, identifier: '  ana@loja.com  ' }).identifier).toBe(
      'ana@loja.com',
    )
  })

  /*
   * Espaco pode ser parte da senha, e aparar silenciosamente faria uma senha
   * valida ser recusada sem explicacao nenhuma.
   */
  it('NAO apara o segredo', () => {
    expect(credentialSchema.parse({ ...valida, secret: ' senha ' }).secret).toBe(' senha ')
  })

  it.each([
    ['identifier vazio', { ...valida, identifier: '' }],
    ['identifier so com espaco', { ...valida, identifier: '   ' }],
    ['secret vazio', { ...valida, secret: '' }],
  ])('recusa %s', (_motivo, entrada) => {
    expect(credentialSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa campo desconhecido — o schema e strict', () => {
    expect(credentialSchema.safeParse({ ...valida, lembrarDeMim: true }).success).toBe(false)
  })

  it('recusa segredo absurdamente longo', () => {
    expect(credentialSchema.safeParse({ ...valida, secret: 'x'.repeat(201) }).success).toBe(false)
  })

  /*
   * NR-231 — achado de usuaria em teste: criou a conta, saiu, e ao entrar de
   * novo pelo celular formatado recebeu "senha incorreta". O cadastro guarda so
   * os digitos; o login tem de comparar a mesma coisa.
   */
  it.each([
    ['(41) 99876-5432', '41998765432'],
    ['41 99876-5432', '41998765432'],
    ['41-99876-5432', '41998765432'],
    ['+55 41 99876-5432', '41998765432'],
    ['55 (41) 99876-5432', '41998765432'],
    ['+55 (41) 3333-4444', '4133334444'],
    ['041 99876-5432', '41998765432'],
    ['(041) 3333-4444', '4133334444'],
    ['41998765432', '41998765432'],
  ])('telefone "%s" entra como o cadastro guarda: %s', (digitado, guardado) => {
    expect(loginInputSchema.parse({ identifier: digitado, secret: 's' }).identifier).toBe(guardado)
  })

  it('celular de DDD 55 nao perde o DDD', () => {
    expect(loginInputSchema.parse({ identifier: '(55) 99876-5432', secret: 's' }).identifier).toBe(
      '55998765432',
    )
  })

  it('e-mail passa como veio, so aparado', () => {
    expect(credentialSchema.parse({ ...valida, identifier: ' Ana@Loja.com ' }).identifier).toBe(
      'Ana@Loja.com',
    )
  })

  it('o que nao e e-mail nem telefone passa como veio — e vai falhar do outro lado', () => {
    expect(credentialSchema.parse({ ...valida, identifier: 'ana' }).identifier).toBe('ana')
  })

  it.each([
    ['(41) 99876-5432', '41998765432'],
    ['ana@loja.com', 'ana@loja.com'],
    /* Comprido demais para ser telefone: so os digitos, e o provedor recusa. */
    ['+1 (555) 123-4567-89', '1555123456789'],
  ])('normalizarIdentificadorDeLogin("%s")', (entrada, saida) => {
    expect(normalizarIdentificadorDeLogin(entrada)).toBe(saida)
  })
})

describe('sessao', () => {
  const valida = {
    token: 'abc.def.ghi',
    expiresAt: '2026-09-04T00:00:00.000Z',
    userId: 'usr-1',
    userName: 'Ana',
    memberships: [{ companyId: 'empresa-1', companyName: 'Loja da Ana', role: 'owner' }],
    activeCompanyId: 'empresa-1',
    isPlatformAdmin: false,
  }

  it('aceita a sessao com loja escolhida', () => {
    expect(sessionOutputSchema.parse(valida).activeCompanyId).toBe('empresa-1')
  })

  /* Estado legitimo, e nao erro: quem tem varias lojas entra e depois escolhe. */
  it('aceita sessao sem loja ativa', () => {
    expect(
      sessionOutputSchema.parse({ ...valida, activeCompanyId: null }).activeCompanyId,
    ).toBeNull()
  })

  it('exige fuso na expiracao', () => {
    expect(
      sessionOutputSchema.safeParse({ ...valida, expiresAt: '2026-09-04T00:00:00' }).success,
    ).toBe(false)
  })

  it('aceita varias lojas', () => {
    const s = sessionOutputSchema.parse({
      ...valida,
      activeCompanyId: null,
      memberships: [
        { companyId: 'empresa-1', companyName: 'Uma', role: 'accountant' },
        { companyId: 'empresa-2', companyName: 'Outra', role: 'staff' },
      ],
    })
    expect(s.memberships).toHaveLength(2)
  })

  it('recusa papel que nao existe no vinculo', () => {
    expect(
      membershipOutputSchema.safeParse({ companyId: 'e1', companyName: 'X', role: 'gerente' })
        .success,
    ).toBe(false)
  })

  it('o vinculo aceita platform_admin — ele existe, so nao e concedivel', () => {
    expect(
      membershipOutputSchema.parse({ companyId: 'e1', companyName: 'X', role: 'platform_admin' })
        .role,
    ).toBe('platform_admin')
  })
})

describe('escolher a loja', () => {
  it('pede so a empresa', () => {
    expect(selectCompanyInputSchema.parse({ companyId: 'empresa-2' }).companyId).toBe('empresa-2')
  })

  it('recusa campo desconhecido', () => {
    expect(selectCompanyInputSchema.safeParse({ companyId: 'e2', role: 'owner' }).success).toBe(
      false,
    )
  })
})

describe('papel concedivel — RF-005', () => {
  it.each(['owner', 'staff', 'accountant'])('aceita %s', (r) => {
    expect(grantableRoleSchema.parse(r)).toBe(r)
  })

  /*
   * `platform_admin` fora: conceder por esta rota deixaria um lojista criar
   * acesso de plataforma. Quem rege esse papel e a RF-131.
   */
  it('recusa platform_admin', () => {
    expect(grantableRoleSchema.safeParse('platform_admin').success).toBe(false)
  })

  it('a mensagem lista os papeis que servem', () => {
    const r = grantableRoleSchema.safeParse('platform_admin')
    expect(r.success ? '' : r.error.issues[0]!.message).toContain('owner, staff ou accountant')
  })
})

describe('convite — RF-005', () => {
  const valida = { name: 'Novo Funcionario', email: 'novo@x.com', role: 'staff' as const }

  it('aceita convite por e-mail', () => {
    expect(inviteUserInputSchema.parse(valida).email).toBe('novo@x.com')
  })

  it('aceita convite por telefone', () => {
    const { email: _fora, ...semEmail } = valida
    expect(inviteUserInputSchema.parse({ ...semEmail, phone: '(41) 98888-7777' }).phone).toBe(
      '41988887777',
    )
  })

  it('normaliza o e-mail para minusculo', () => {
    expect(inviteUserInputSchema.parse({ ...valida, email: 'NOVO@X.COM' }).email).toBe('novo@x.com')
  })

  /*
   * O convite existe para a pessoa poder entrar depois, e o primeiro login
   * amarra a identidade externa por e-mail ou telefone. Sem nenhum dos dois, o
   * convite cria uma linha em `users` que ninguem consegue reivindicar.
   */
  it('recusa convite sem e-mail e sem telefone', () => {
    const { email: _fora, ...sem } = valida
    expect(inviteUserInputSchema.safeParse(sem).success).toBe(false)
  })

  it.each([
    ['e-mail invalido', { ...valida, email: 'novo@' }],
    ['telefone curto', { name: 'X Y', phone: '4198888', role: 'staff' }],
    ['nome curto', { ...valida, name: 'A' }],
    ['papel de plataforma', { ...valida, role: 'platform_admin' }],
    ['campo desconhecido', { ...valida, sendEmail: false }],
  ])('recusa %s', (_motivo, entrada) => {
    expect(inviteUserInputSchema.safeParse(entrada).success).toBe(false)
  })
})

describe('resultado do convite', () => {
  it('diz quando criou a pessoa', () => {
    const r = invitedUserOutputSchema.parse({
      userId: 'usr-9',
      companyId: 'empresa-1',
      role: 'staff',
      created: true,
    })
    expect(r.created).toBe(true)
  })

  /* Falso quando a pessoa ja existia e so ganhou acesso a esta loja — o caso
     do contador que atende varias. */
  it('diz quando so deu acesso a quem ja existia', () => {
    const r = invitedUserOutputSchema.parse({
      userId: 'usr-9',
      companyId: 'empresa-2',
      role: 'accountant',
      created: false,
    })
    expect(r.created).toBe(false)
  })
})
