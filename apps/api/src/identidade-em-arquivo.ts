import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Credential } from '@na-regua/contracts'
import type {
  IdentityProvider,
  IdentityRegistrar,
  PasswordSetter,
  VerifiedIdentity,
} from '@na-regua/core'

/**
 * Credencial de DESENVOLVIMENTO que sobrevive a reinicio — NR-014, ADR-0002.
 *
 * ## O problema que isto resolve
 *
 * `FakeIdentityProvider` guarda as credenciais num `Map` da instancia, e
 * `pnpm dev` roda a api com `tsx watch`. Consequencia: **cada arquivo salvo
 * apagava todas as contas**. O lojista (ou quem esta desenvolvendo) cadastrava,
 * salvava qualquer arquivo, e a partir dali:
 *
 * - o login recusava, porque a credencial evaporou; e
 * - cadastrar de novo recusava com "este CNPJ ja tem cadastro", porque a
 *   empresa e o usuario continuavam no Postgres.
 *
 * Ficava impossivel entrar, sem nenhuma mensagem que apontasse para a causa. O
 * dado no banco era permanente e a credencial era volatil — e essa assimetria
 * era o defeito.
 *
 * ## Por que aqui, e nao em `core`
 *
 * `core` nao toca em disco: ele declara portas e os adapters as implementam.
 * Persistir e detalhe de infraestrutura, entao mora na raiz de composicao. O
 * `FakeIdentityProvider` continua existindo e continua servindo aos testes, que
 * querem justamente um mapa em memoria.
 *
 * ## Isto NAO e um provedor de identidade de verdade
 *
 * Continua sendo o modo `fake` da ADR-0002, e `assertAuthUsavelEmProducao`
 * recusa subir com ele em producao. O que ele ganhou foi durabilidade no
 * desenvolvimento, nao robustez.
 *
 * Ainda assim o segredo NAO vai em texto puro para o disco: guarda-se um
 * `scrypt` com sal por credencial. Nao e exigencia de nada aqui — e que um
 * arquivo de desenvolvimento acaba num backup, num zip mandado para alguem, e
 * as pessoas reusam senha. Custa cinco linhas.
 */

/** Onde o arquivo mora. Fora de `src`, e ignorado pelo git. */
const CAMINHO_PADRAO = join(process.cwd(), '.dev', 'identidades.json')

const TAMANHO_DA_CHAVE = 32
const TAMANHO_DO_SAL = 16

type Registro = {
  readonly identifier: string
  readonly subject: string
  readonly email: string | null
  readonly phone: string | null
  /** `sal:hash`, os dois em base64url. O segredo nao e guardado. */
  readonly verificador: string
}

const derivar = (secret: string, sal: Buffer): Buffer => scryptSync(secret, sal, TAMANHO_DA_CHAVE)

function criarVerificador(secret: string): string {
  const sal = randomBytes(TAMANHO_DO_SAL)
  return `${sal.toString('base64url')}:${derivar(secret, sal).toString('base64url')}`
}

/** Sincrono de proposito — a classe inteira e sincrona, e um `await` a mais so para dormir destoaria. */
function dormirSincrono(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * `rename` no Windows pode recusar com `EPERM`/`EBUSY` quando outro processo
 * tem o DESTINO aberto no instante exato da troca — nao e o mesmo bug do
 * `.tmp` fixo (esse ja tinha nome unico), e sim uma diferenca real de
 * semantica de arquivo entre Windows e POSIX: `rename` sobre um arquivo que
 * outro processo esta lendo e permitido em Linux e pode falhar no Windows.
 * A suite de e2e roda em varios processos Vitest, todos gravando o mesmo
 * arquivo — a colisao e rara, mas o suficiente numero de tentativas com um
 * atraso pequeno resolve sem inventar um lock de arquivo.
 */
function renomearComRetentativa(origem: string, destino: string): void {
  const MAX_TENTATIVAS = 5
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      renameSync(origem, destino)
      return
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code
      if ((codigo !== 'EPERM' && codigo !== 'EBUSY') || tentativa === MAX_TENTATIVAS) throw erro
      dormirSincrono(20 * tentativa)
    }
  }
}

function confere(secret: string, verificador: string): boolean {
  const [salBase, hashBase] = verificador.split(':')
  if (salBase === undefined || hashBase === undefined) return false

  const esperado = Buffer.from(hashBase, 'base64url')
  const obtido = derivar(secret, Buffer.from(salBase, 'base64url'))

  /*
   * `timingSafeEqual` exige o mesmo tamanho e lanca quando difere. Comparar o
   * tamanho antes evita a excecao — e um verificador de tamanho errado so
   * aparece com arquivo corrompido, que e "nao confere" e nao "quebrou".
   */
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido)
}

export class IdentidadeEmArquivo implements IdentityProvider, IdentityRegistrar, PasswordSetter {
  private readonly registros = new Map<string, Registro>()

  constructor(private readonly caminho: string = CAMINHO_PADRAO) {
    this.carregar()
  }

  private carregar(): void {
    if (!existsSync(this.caminho)) return

    try {
      const lidos = JSON.parse(readFileSync(this.caminho, 'utf8')) as Registro[]
      for (const r of lidos) this.registros.set(r.identifier, r)
    } catch {
      /*
       * Arquivo ilegivel comeca vazio, e nao derruba a api.
       *
       * O pior desfecho aqui e "as contas de desenvolvimento sumiram", que e
       * exatamente o estado de antes desta classe existir. Derrubar o processo
       * por causa de um JSON truncado seria trocar um inconveniente por
       * indisponibilidade.
       */
    }
  }

  private gravar(): void {
    mkdirSync(dirname(this.caminho), { recursive: true })

    /*
     * Re-le o disco antes de escrever, e funde com o que este processo tem em
     * memoria.
     *
     * A suite de e2e sobe uma instancia POR ARQUIVO DE TESTE, e o Vitest roda
     * arquivos em processos separados, em paralelo. Sem isto, cada processo
     * escreve so o que ELE conhece — e o cadastro que outro processo acabou
     * de gravar, um instante antes, some quando este processo salva por cima
     * com o proprio instantaneo, mais antigo. Foi assim que um cadastro de
     * e2e passou e o login seguinte, no mesmo teste, apanhou com credencial
     * "inexistente".
     */
    if (existsSync(this.caminho)) {
      try {
        const doDisco = JSON.parse(readFileSync(this.caminho, 'utf8')) as Registro[]
        for (const r of doDisco) {
          if (!this.registros.has(r.identifier)) this.registros.set(r.identifier, r)
        }
      } catch {
        /* Disco ilegivel: segue só com o que ja estava em memoria — mesma
           tolerancia de `carregar()`. */
      }
    }

    /*
     * Escreve num temporario PROPRIO deste processo, e renomeia: `rename` no
     * mesmo volume e atomico, entao um encerramento no meio da escrita nao
     * deixa um arquivo pela metade. O nome do temporario leva o PID e um
     * sufixo aleatorio — dois processos escrevendo ao mesmo tempo usavam o
     * MESMO `.tmp` fixo antes desta linha, e o segundo a renomear estourava
     * com "arquivo nao encontrado" porque o primeiro ja tinha levado o dele.
     */
    const temporario = `${this.caminho}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temporario, JSON.stringify([...this.registros.values()], null, 2), 'utf8')
    renomearComRetentativa(temporario, this.caminho)
  }

  async verify(credential: Credential): Promise<VerifiedIdentity | undefined> {
    const registro = this.registros.get(credential.identifier)
    if (registro === undefined) return undefined
    if (!confere(credential.secret, registro.verificador)) return undefined

    return { subject: registro.subject, email: registro.email, phone: registro.phone }
  }

  async register(
    credential: Credential,
    dados: { email: string | null; phone: string | null },
  ): Promise<{ subject: string } | undefined> {
    /* Identificador ja usado e RESPOSTA, e nao erro — ver a porta em `core`. */
    if (this.registros.has(credential.identifier)) return undefined

    const subject = `fake:${credential.identifier}`

    this.registros.set(credential.identifier, {
      identifier: credential.identifier,
      subject,
      email: dados.email,
      phone: dados.phone,
      verificador: criarVerificador(credential.secret),
    })

    this.gravar()

    return { subject }
  }
  /**
   * Troca a senha pelo link de redefinicao — NR-014.
   *
   * Pelo e-mail, que e o que o link carrega. A pessoa pode ter credencial com o
   * e-mail como identificador E outra com o telefone (o mesmo `subject`): as
   * duas passam a aceitar a senha nova, como no provedor de verdade.
   */
  async setSecret(email: string, secret: string): Promise<boolean> {
    const alvo = email.toLowerCase()
    const achado = [...this.registros.values()].find(
      (r) => r.email?.toLowerCase() === alvo || r.identifier.toLowerCase() === alvo,
    )
    if (achado === undefined) return false

    for (const r of [...this.registros.values()]) {
      if (r.subject === achado.subject) {
        this.registros.set(r.identifier, { ...r, verificador: criarVerificador(secret) })
      }
    }
    this.gravar()
    return true
  }
}
