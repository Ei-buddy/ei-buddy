import { randomBytes, randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFiscalCredentials } from './fiscal-credentials-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Credenciais fiscais cifradas — NR-042, RF-004, RNF-022.
 *
 * A cifragem em si tem teste proprio, sem banco. O que se prova AQUI e o que so
 * o banco prova: que o segredo chega cifrado na coluna, que trocar um campo nao
 * apaga o outro, e que a varredura de vencimento acha quem precisa ser avisado
 * sem decifrar nada.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('credenciais fiscais — NR-042', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuario: string
  let cnpjDaA: string

  const CHAVE = randomBytes(32)
  let repo: ReturnType<typeof createFiscalCredentials>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0005_cofre_fiscal')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /* Guardado: `cnpjDeTeste` sai do relogio e devolve outro numero a cada
       chamada — compara-lo com uma segunda chamada nunca bateria. */
    cnpjDaA = cnpjDeTeste('4')
    empresaA = await criarEmpresa(cnpjDaA, 'Loja Credencial A')
    empresaB = await criarEmpresa(cnpjDeTeste('5'), 'Loja Credencial B')

    usuario = randomUUID()
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`
        INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`f${usuario}@local`})
      `,
    )

    repo = createFiscalCredentials(sql, CHAVE)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM company_fiscal_credentials WHERE company_id = ${empresa}`
        await tx`DELETE FROM users WHERE id = ${usuario}`
        await tx`DELETE FROM companies WHERE id = ${empresa}`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('guarda o token e o devolve decifrado', async () => {
    await repo.salvar({
      companyId: empresaA,
      focusToken: 'tok-focus-secreto',
      atualizadoPor: usuario,
    })

    expect(await repo.tokenDe(empresaA)).toBe('tok-focus-secreto')
  })

  it('a COLUNA nao tem o token em texto puro', async () => {
    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ focus_token: string }[]>`
        SELECT focus_token FROM company_fiscal_credentials WHERE company_id = ${empresaA}
      `,
    )

    /*
     * A assercao que importa. Um vazamento de banco nao pode entregar o que
     * autoriza emitir documento fiscal em nome de uma empresa.
     */
    expect(linha?.focus_token).not.toContain('tok-focus-secreto')
    expect(linha?.focus_token).toMatch(/^v1:/)
  })

  it('empresa sem configuracao devolve indefinido, e nao erro', async () => {
    /* Falta de credencial e estado normal: a maioria vende antes de emitir
       nota. Quem transforma isso em recusa e o adapter, com mensagem propria. */
    expect(await repo.tokenDe(empresaB)).toBeUndefined()
  })

  it('trocar o certificado nao apaga o token', async () => {
    await repo.salvar({
      companyId: empresaA,
      certificadoBase64: 'MIIKfQIBAzCCCjcGCS...',
      senhaDoCertificado: 'senha-do-a1',
      certificadoVenceEm: '2027-03-15',
      atualizadoPor: usuario,
    })

    /* `COALESCE` com o valor antigo. Sobrescrever com nulo apagaria a emissao
       inteira numa tela que so queria atualizar um campo. */
    expect(await repo.tokenDe(empresaA)).toBe('tok-focus-secreto')

    const situacao = await repo.situacao(empresaA)
    expect(situacao).toMatchObject({ temToken: true, temCertificado: true })
  })

  it('a situacao NAO devolve o segredo, so se ele existe', async () => {
    const situacao = await repo.situacao(empresaA)

    /* A tela precisa saber SE esta configurado. Mostrar o token seria desfazer
       a cifragem na saida. */
    expect(JSON.stringify(situacao)).not.toContain('tok-focus-secreto')
    expect(situacao.certificadoVenceEm).toBe('2027-03-15')
  })

  it('o vencimento fica EM CLARO na coluna, e nao cifrado', async () => {
    const [linha] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ certificate_expires_at: Date }[]>`
        SELECT certificate_expires_at FROM company_fiscal_credentials
        WHERE company_id = ${empresaA}
      `,
    )

    /*
     * E o unico campo desta tabela que nao e segredo. Precisa ser consultavel
     * para o aviso da RF-004 — uma varredura que tivesse de decifrar todos os
     * certificados manteria segredo em memoria sem necessidade.
     *
     * A varredura em si NAO existe: ela pergunta sobre todas as empresas, e a
     * politica de isolamento recusa leitura sem tenant. Ver o cabecalho do
     * repositorio.
     */
    expect(linha?.certificate_expires_at).toBeInstanceOf(Date)
  })

  it('o CNPJ do emitente vem de `companies`, e nao daqui', async () => {
    /* Duplica-lo nesta tabela criaria duas respostas para "qual e o CNPJ desta
       empresa", e elas divergiriam na primeira correcao de cadastro. */
    expect(await repo.cnpjDe(empresaA)).toBe(cnpjDaA)
  })

  describe('revenda Focus — NR-183', () => {
    it('guarda o CSC cifrado, com o id em claro, e a situacao diz que tem', async () => {
      await repo.salvar({
        companyId: empresaA,
        cscProducao: { id: '1', codigo: 'CSC-SECRETO-PROD' },
        atualizadoPor: usuario,
      })
      const [linha] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ csc_producao: string; csc_id_producao: string }[]>`
          SELECT csc_producao, csc_id_producao FROM company_fiscal_credentials
          WHERE company_id = ${empresaA}
        `,
      )
      expect(linha?.csc_producao).not.toContain('CSC-SECRETO-PROD')
      expect(linha?.csc_id_producao).toBe('1')
      expect((await repo.situacao(empresaA)).temCscProducao).toBe(true)
    })

    it('dadosParaFocus le a empresa e decifra o CSC', async () => {
      const d = await repo.dadosParaFocus(empresaA)
      expect(d?.cnpj).toBe(cnpjDaA)
      expect(d?.razaoSocial).toBe('Loja Credencial A')
      expect(d?.cscProducao).toEqual({ id: '1', codigo: 'CSC-SECRETO-PROD' })
      expect(d?.focusId).toBeUndefined()
    })

    it('cadastro aceito grava id e os dois tokens, e cada ambiente le o seu', async () => {
      await repo.registrarFocus(empresaA, {
        ok: true,
        empresa: { focusId: '77', tokenProducao: 'tok-prod', tokenHomologacao: 'tok-homo' },
      })
      expect(await repo.tokenDe(empresaA)).toBe('tok-prod')
      expect(
        await createFiscalCredentials(sql, CHAVE, { ambiente: 'homologacao' }).tokenDe(empresaA),
      ).toBe('tok-homo')
      const s = await repo.situacao(empresaA)
      expect(s.focusSincronizadaEm).not.toBeNull()
      expect(s.focusErro).toBeNull()
      expect((await repo.dadosParaFocus(empresaA))?.focusId).toBe('77')
    })

    it('recusa da Focus fica registrada sem apagar os tokens que ja valiam', async () => {
      await repo.registrarFocus(empresaA, { ok: false, mensagem: 'certificado vencido' })
      expect((await repo.situacao(empresaA)).focusErro).toBe('certificado vencido')
      expect(await repo.tokenDe(empresaA)).toBe('tok-prod')
    })

    it('CSC sem id e recusado pelo banco', async () => {
      await expect(
        withTenant(
          sql,
          empresaA,
          (tx) => tx`
            UPDATE company_fiscal_credentials SET csc_homologacao = 'x', csc_id_homologacao = NULL
            WHERE company_id = ${empresaA}
          `,
        ),
      ).rejects.toThrow(/fiscal_csc_homologacao_completo/)
    })
  })
})
