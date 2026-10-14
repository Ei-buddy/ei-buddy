import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentidadeEmArquivo } from './identidade-em-arquivo.js'

/**
 * Fila de falhas transientes para o proximo `renameSync` — ver o teste "Windows
 * recusa o rename uma vez (EPERM) e a segunda tentativa resolve" abaixo.
 * Vazia, o mock so repassa para a implementacao de verdade: as outras 4
 * suites deste arquivo nao sabem que o mock existe.
 */
const proximasFalhasDoRename: NodeJS.ErrnoException[] = []

vi.mock('node:fs', async (importarOriginal) => {
  const real = await importarOriginal<typeof import('node:fs')>()
  return {
    ...real,
    renameSync: (origem: string, destino: string) => {
      const falha = proximasFalhasDoRename.shift()
      if (falha !== undefined) throw falha
      return real.renameSync(origem, destino)
    },
  }
})

/**
 * `IdentidadeEmArquivo` sob escrita concorrente — achado ao investigar um 500
 * intermitente em `/auth/signup` na suite de e2e (varios arquivos, cada um
 * com a propria instancia, todos gravando o mesmo arquivo em paralelo).
 *
 * Dois defeitos, um so tiro: o `.tmp` fixo fazia o segundo processo a
 * renomear estourar com "arquivo nao encontrado" (o primeiro ja tinha levado
 * o dele); e mesmo sem o estouro, cada processo gravava so o que TINHA em
 * memoria, entao o cadastro mais recente do outro processo desaparecia.
 */
describe('IdentidadeEmArquivo — escrita concorrente', () => {
  let pasta: string
  let caminho: string

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'identidade-em-arquivo-'))
    caminho = join(pasta, 'identidades.json')
    proximasFalhasDoRename.length = 0
  })

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true })
  })

  it('registra e verifica normalmente', async () => {
    const identidade = new IdentidadeEmArquivo(caminho)

    const registrado = await identidade.register(
      { identifier: 'ana@loja.local', secret: 'senha-123' },
      { email: 'ana@loja.local', phone: null },
    )
    expect(registrado).toBeDefined()

    const verificado = await identidade.verify({
      identifier: 'ana@loja.local',
      secret: 'senha-123',
    })
    expect(verificado?.subject).toBe(registrado?.subject)
  })

  /* Meu perfil — NR-153. */
  it('trocar o e-mail move o login para o novo; trocar a senha vale para os dois caminhos', async () => {
    const identidade = new IdentidadeEmArquivo(caminho)
    const r = await identidade.register(
      { identifier: 'ana@loja.local', secret: 'senha-123' },
      { email: 'ana@loja.local', phone: '41999990000' },
    )

    expect(await identidade.setEmail(r!.subject, 'ana.paula@loja.local')).toBe(true)
    expect(await identidade.setSecretFor(r!.subject, 'senha-nova-456')).toBe(true)

    expect(
      await identidade.verify({ identifier: 'ana@loja.local', secret: 'senha-nova-456' }),
    ).toBeUndefined()
    expect(
      (await identidade.verify({ identifier: 'ana.paula@loja.local', secret: 'senha-nova-456' }))
        ?.subject,
    ).toBe(r!.subject)
    expect(
      await identidade.verify({ identifier: 'ana.paula@loja.local', secret: 'senha-123' }),
    ).toBeUndefined()
  })

  it('duas instancias gravando o MESMO arquivo, uma apos a outra, nao se apagam', async () => {
    /*
     * Simula dois processos: cada `IdentidadeEmArquivo` so conhece o que
     * existia no disco NO MOMENTO em que foi construida — exatamente como
     * dois processos de teste que sobem ao mesmo tempo.
     */
    const processoA = new IdentidadeEmArquivo(caminho)
    const processoB = new IdentidadeEmArquivo(caminho)

    await processoA.register(
      { identifier: 'a@loja.local', secret: 'senha-a' },
      { email: 'a@loja.local', phone: null },
    )
    /* B nasceu ANTES do registro de A, entao o mapa dele nao tem A — e
       exatamente o cenario que perdia o registro de A antes da correcao. */
    await processoB.register(
      { identifier: 'b@loja.local', secret: 'senha-b' },
      { email: 'b@loja.local', phone: null },
    )

    /* Uma terceira instancia, fresca, prova o que ficou gravado de verdade. */
    const leitor = new IdentidadeEmArquivo(caminho)
    const a = await leitor.verify({ identifier: 'a@loja.local', secret: 'senha-a' })
    const b = await leitor.verify({ identifier: 'b@loja.local', secret: 'senha-b' })

    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })

  it('escritas concorrentes de verdade (Promise.all) nao colidem no rename', async () => {
    const identificadores = Array.from({ length: 8 }, () => `usuario-${randomUUID()}@loja.local`)
    const instancias = identificadores.map(() => new IdentidadeEmArquivo(caminho))

    /* As 8 gravacoes disputam o mesmo arquivo ao mesmo tempo — antes da
       correcao, algumas destas promessas rejeitavam com ENOENT no rename. */
    await Promise.all(
      instancias.map((identidade, i) =>
        identidade.register(
          { identifier: identificadores[i]!, secret: 'senha-123' },
          { email: null, phone: null },
        ),
      ),
    )

    const leitor = new IdentidadeEmArquivo(caminho)
    for (const identifier of identificadores) {
      const verificado = await leitor.verify({ identifier, secret: 'senha-123' })
      expect(verificado, `esperava achar ${identifier}`).toBeDefined()
    }
  })

  /*
   * Achado ao investigar uma flakiness residual em `caminho-critico.test.ts`
   * mesmo depois da correcao acima: o Windows pode recusar `rename` com
   * EPERM/EBUSY quando outro processo tem o DESTINO aberto no instante exato
   * da troca — nao e o mesmo bug do `.tmp` fixo, e sim uma diferenca real de
   * semantica entre Windows e POSIX.
   */
  it('Windows recusa o rename uma vez (EPERM) e a segunda tentativa resolve', async () => {
    proximasFalhasDoRename.push(
      Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }),
    )

    const identidade = new IdentidadeEmArquivo(caminho)
    const registrado = await identidade.register(
      { identifier: 'eperm@loja.local', secret: 'senha-123' },
      { email: null, phone: null },
    )

    expect(registrado).toBeDefined()
    expect(proximasFalhasDoRename).toHaveLength(0)

    const leitor = new IdentidadeEmArquivo(caminho)
    const verificado = await leitor.verify({ identifier: 'eperm@loja.local', secret: 'senha-123' })
    expect(verificado).toBeDefined()
  })

  it('erro de rename que nao e EPERM/EBUSY nao e retentado', async () => {
    proximasFalhasDoRename.push(
      Object.assign(new Error('EACCES: permission denied, rename'), { code: 'EACCES' }),
    )

    const identidade = new IdentidadeEmArquivo(caminho)
    await expect(
      identidade.register(
        { identifier: 'eacces@loja.local', secret: 'senha-123' },
        { email: null, phone: null },
      ),
    ).rejects.toThrow('EACCES')
  })
})
