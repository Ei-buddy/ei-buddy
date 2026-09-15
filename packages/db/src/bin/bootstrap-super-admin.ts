#!/usr/bin/env tsx
/**
 * Promove a PRIMEIRA pessoa a Super Admin — ADR-0007.
 *
 *   pnpm db:super-admin fulano@empresa.com.br
 *
 * ## Por que isto existe
 *
 * `platform_admin_grant` exige que quem concede ja seja Super Admin. E a
 * regra certa — e deixa um ovo-e-galinha no primeiro: num banco novo nao ha
 * ninguem para conceder, e sem este script o unico caminho seria alguem
 * escrever `INSERT` a mao no banco de producao. A migration 0008 ja previa
 * "um script de bootstrap"; ele nao existia ate agora.
 *
 * ## Por que so o primeiro
 *
 * Se ja houver outro Super Admin, este script RECUSA e manda usar o painel
 * (`/admin`). Um atalho de linha de comando que concede o privilegio mais alto
 * do sistema a qualquer momento seria uma porta permanente de escalacao —
 * sem tela, sem `granted_by` verdadeiro e sem ninguem vendo. A excecao se
 * justifica uma vez; como rotina, nao.
 *
 * Le `DATABASE_MIGRATION_URL` pelo mesmo motivo do `migrate`: `platform_admins`
 * tem `FORCE ROW LEVEL SECURITY` sem politica, entao a conexao da aplicacao
 * nao enxerga nem escreve nela.
 */
import { loadMigrationEnv } from '@na-regua/env'
import postgres from 'postgres'

const email = process.argv[2]?.trim().toLowerCase()

if (email === undefined || email === '') {
  console.error('\nInforme o e-mail da conta.\n\n  pnpm db:super-admin fulano@empresa.com.br\n')
  process.exit(1)
}

const env = loadMigrationEnv()
const sql = postgres(env.DATABASE_MIGRATION_URL, { max: 1, onnotice: () => undefined })

try {
  const [pessoa] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM users WHERE lower(email) = ${email}
  `

  if (pessoa === undefined) {
    console.error(
      `\nNenhuma conta com o e-mail ${email}.\n\n` +
        'Crie a conta normalmente pelo site (/criar-conta) e rode de novo —\n' +
        'este script promove uma conta que ja existe, nao cria uma.\n',
    )
    process.exit(1)
  }

  /* Ja e Super Admin: nao ha o que fazer, e dizer isso e melhor que "pronto!"
     sobre uma escrita que nao aconteceu. */
  const [jaEh] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM platform_admins WHERE user_id = ${pessoa.id} AND revoked_at IS NULL
  `

  if (jaEh !== undefined) {
    console.log(`\n${pessoa.name} (${email}) ja e Super Admin. Nada a fazer.\n`)
    process.exit(0)
  }

  const [outro] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM platform_admins WHERE revoked_at IS NULL
  `

  if ((outro?.total ?? 0) > 0) {
    console.error(
      `\nJa existe Super Admin neste banco (${outro?.total}).\n\n` +
        'Este script e so para o PRIMEIRO. Para promover mais alguem, entre em\n' +
        '/admin com uma conta que ja seja Super Admin e use a tela — assim fica\n' +
        'registrado quem concedeu (ADR-0007).\n',
    )
    process.exit(1)
  }

  /*
   * `granted_by` aponta para a propria pessoa: e o unico valor honesto aqui.
   * Inventar outro concedente registraria na trilha de auditoria uma decisao
   * que ninguem tomou.
   */
  await sql`
    INSERT INTO platform_admins (user_id, granted_by) VALUES (${pessoa.id}, ${pessoa.id})
  `

  console.log(
    `\n${pessoa.name} (${email}) agora e Super Admin.\n\n` +
      'Entre em /admin. A partir daqui, promova os outros pela tela —\n' +
      'este script nao roda de novo enquanto houver Super Admin.\n',
  )
} catch (erro) {
  console.error(`\nFalha ao promover:\n  ${erro instanceof Error ? erro.message : erro}\n`)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
