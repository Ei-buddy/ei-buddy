import type { Credential } from '@na-regua/contracts'
import type {
  IdentityProvider,
  IdentityRegistrar,
  PasswordSetter,
  VerifiedIdentity,
} from '@na-regua/core'
import { betterAuth } from 'better-auth'
import { phoneNumber } from 'better-auth/plugins'
import { Pool } from 'pg'

/**
 * O provedor de identidade de verdade — NR-084, ADR-0002 (opcao D).
 *
 * ## O que ele e, e o que ele nao e
 *
 * A ADR-0002 decidiu: **somos donos da sessao, alugamos a prova.** Este arquivo
 * e a prova alugada, e nada mais. Ele responde uma pergunta — esta credencial e
 * desta pessoa? — e devolve um `subject` opaco. Empresa, papel e sessao
 * continuam nossos, em `public`, sob RLS, porque e de la que a RLS le
 * `app.company_id` e papel guardado num provedor seria adorno.
 *
 * Por isso a sessao do Better Auth e DESCARTADA no fim de `verify`. Ele nao tem
 * rota montada, ninguem recebe cookie dele, e o token que ele emite nao sai
 * deste arquivo. Quem emite sessao aqui e `createSessionIssuer` (NR-083).
 *
 * ## Por que Better Auth, e nao continuar com scrypt nosso
 *
 * `IdentidadeEmArquivo` faz scrypt com sal e serve bem ao desenvolvimento. O
 * que ela nao tem, e que nao vale escrever, e o resto: recuperacao de senha,
 * verificacao de contato, segundo fator para `platform_admin` (RNF-025). A
 * propria ADR-0002 recusou a opcao A com uma frase que continua valendo —
 * escrever primitiva de seguranca e onde time pequeno erra caro.
 *
 * ## Um segundo driver de Postgres, de proposito
 *
 * O repo fala com o banco por `postgres.js`; o Better Auth fala por Kysely, que
 * quer um `Pool` do `pg`. Nao ha dialeto de Kysely sobre `postgres.js`, e
 * escrever um seria manter um adaptador de banco para nao instalar um driver.
 *
 * O pool separado nao e so imposicao: ele e o que mantem
 * `search_path=identidade` LONGE do nosso. Se o Better Auth compartilhasse a
 * conexao da aplicacao, as consultas dela passariam a procurar tabela no schema
 * errado — e o RLS de `public` nunca mais seria alcancado pelo caminho normal.
 */

/**
 * As tabelas do provedor moram fora de `public`.
 *
 * `-c search_path=identidade` vai na conexao, e nao em cada consulta, porque
 * quem monta as consultas e o Kysely dele: nao ha onde qualificar o nome. A
 * migration 0023 cria o schema e explica por que ele existe.
 *
 * Sem `public` na lista: se o schema estiver faltando, a consulta FALHA em vez
 * de cair em `public` e criar `user`, `session`, `account` e `verification` ao
 * lado das nossas tabelas — silenciosamente, e por baixo da invariante de RLS.
 */
const SCHEMA = 'identidade'

/**
 * O dominio do e-mail que inventamos para quem so tem telefone.
 *
 * `signUpEmail` exige e-mail, e a RF-005 permite convidar so por telefone. O
 * plugin de telefone do Better Auth resolve o LOGIN por numero, mas nao oferece
 * cadastro sem e-mail — o caminho dele passa por OTP, e OTP depende de mandar
 * mensagem, que e a NR-046 (adapter Meta / consentimento no WhatsApp).
 *
 * Entao o e-mail existe, e e falso de forma declarada: `.invalid` e reservado
 * pela RFC 2606 justamente para isso, e nunca resolve. Ele NAO sai daqui —
 * `verify` filtra o dominio antes de devolver, e o contato de verdade mora em
 * `users`, que e a nossa tabela. Se um dia este endereco aparecer numa tela, o
 * defeito e o filtro ter sido esquecido, nao o endereco existir.
 */
const DOMINIO_SEM_EMAIL = 'telefone.invalid'

const sinteticoDeTelefone = (phone: string) => `${phone}@${DOMINIO_SEM_EMAIL}`

const ehSintetico = (email: string) => email.endsWith(`@${DOMINIO_SEM_EMAIL}`)

/**
 * E-mail ou telefone?
 *
 * A pergunta e simples de proposito: o `@` decide. Nao e validacao de e-mail —
 * quem valida e o `credentialSchema` em `contracts` e o proprio Better Auth. O
 * que se decide aqui e apenas por QUAL porta entrar, e um identificador com `@`
 * que nao seja e-mail valido vai ser recusado do outro lado com a mesma
 * mensagem de sempre (RF-120).
 */
const pareceEmail = (identifier: string) => identifier.includes('@')

/** O que o Better Auth devolve nos dois caminhos de entrada. */
type Entrada = { readonly token: string | null; readonly user: { readonly id: string } }

export type IdentidadeBetterAuthConfig = {
  readonly databaseUrl: string
  /** `BETTER_AUTH_SECRET`. Assina o que ele emite; nada nosso depende dela. */
  readonly secret: string
  /**
   * Minimo de senha, para casar com o que o cadastro ja promete na tela.
   *
   * Divergir daria a pior das recusas: o formulario aceita, a chamada sai, e o
   * erro volta do provedor com o texto dele.
   */
  readonly minimoDeSenha: number
}

/**
 * Monta a instancia do Better Auth.
 *
 * Funcao de modulo, e nao codigo dentro do construtor, por causa do TIPO: os
 * plugins acrescentam endpoints ao `auth.api` (aqui, `signInPhoneNumber`), e
 * anotar a propriedade como `ReturnType<typeof betterAuth>` apaga essa
 * informacao — o campo vira o tipo generico e a chamada nao compila.
 * `ReturnType<typeof criarAuth>` preserva.
 */
function criarAuth(pool: Pool, config: IdentidadeBetterAuthConfig) {
  return betterAuth({
    database: pool,
    secret: config.secret,
    /*
     * Nenhuma rota do Better Auth e montada no Fastify, e `baseURL` so existe
     * porque ele exige uma. Se um dia alguem montar `auth.handler`, isto deixa
     * de ser detalhe: passariam a existir DUAS formas de entrar no sistema, e
     * so uma delas resolve empresa e papel.
     */
    baseURL: 'http://localhost',
    emailAndPassword: {
      enabled: true,
      /*
       * Sem sessao automatica no cadastro. Com ela, `register` criaria uma
       * sessao do Better Auth que ninguem usa e ninguem recolhe.
       */
      autoSignIn: false,
      minPasswordLength: config.minimoDeSenha,
    },
    plugins: [
      phoneNumber({
        /*
         * O OTP nao e usado, e lancar aqui e a forma de garantir isso.
         *
         * O plugin exige a funcao para expor os endpoints de OTP, que nao
         * montamos. Um `sendOTP` vazio faria o codigo ser "enviado" para lugar
         * nenhum e a verificacao ficar esperando para sempre; lancar transforma
         * "alguem ligou um caminho que depende da NR-046" em erro imediato,
         * com o motivo escrito.
         */
        sendOTP: async () => {
          throw new Error(
            'Envio de OTP por telefone depende da NR-046 (adapter WhatsApp / Meta Cloud API). ' +
              'O login por telefone usa senha, nao codigo.',
          )
        },
      }),
    ],
  })
}

export class IdentidadeBetterAuth implements IdentityProvider, IdentityRegistrar, PasswordSetter {
  private readonly pool: Pool
  private readonly auth: ReturnType<typeof criarAuth>

  constructor(config: IdentidadeBetterAuthConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      options: `-c search_path=${SCHEMA}`,
    })

    this.auth = criarAuth(this.pool, config)
  }

  /**
   * Cria as tabelas do provedor — chamado pelo script de migracao.
   *
   * Fica aqui, e nao numa migration de `packages/db`, porque o schema muda com
   * a VERSAO da biblioteca: copiar o DDL para nossa pasta faria cada
   * atualizacao pedir um diff escrito a mao, e o erro apareceria no primeiro
   * login depois do deploy. Ver a 0023.
   */
  async migrar(): Promise<void> {
    const ctx = await this.auth.$context
    await ctx.runMigrations()
    await this.garantirUnicidade()
  }

  /**
   * As restricoes de unicidade que a biblioteca NAO cria.
   *
   * ## O defeito que isto fecha
   *
   * `signUpEmail` nao recusa e-mail repetido, e o schema dele nao tem indice
   * unico: cadastrar duas vezes o mesmo endereco cria DOIS usuarios, com ids
   * diferentes. Foi um teste desta tarefa que pegou, contra Postgres.
   *
   * O estado que sobra e pior que um erro. A senha do primeiro continua valendo
   * e resolve para o primeiro id; a senha do segundo nao entra em lugar nenhum.
   * Do lado de fora parece "cadastrei e nao consigo entrar", e do lado de dentro
   * ha uma pessoa a mais que ninguem alcanca.
   *
   * ## Por que aqui, e nao numa migration nossa
   *
   * Porque as tabelas nao existem quando a 0023 roda — ela cria o schema vazio,
   * e quem cria as tabelas e a linha acima. Este e o primeiro momento em que ha
   * onde por o indice.
   *
   * A regra "a biblioteca e dona do schema dela" continua valendo para a FORMA.
   * Isto e outra coisa: "o mesmo e-mail nao pode ser duas pessoas" e regra
   * nossa, e o indice e aditivo — a migracao dela acrescenta coluna e tabela,
   * nunca remove indice.
   *
   * ## O risco conhecido
   *
   * Se uma versao futura criar um indice proprio sobre as mesmas colunas, o
   * `runMigrations` dela recusa por conflito de definicao. E falha na MIGRACAO,
   * com mensagem, e nao no login — que e a direcao certa de falhar. O nome
   * `nosso_` marca de quem sao.
   */
  private async garantirUnicidade(): Promise<void> {
    /* `lower(email)`, como `users_email_unico` (0002): comparar cru deixaria
       passar duplicata por diferenca de caixa. */
    await this.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS nosso_user_email_unico ON "user" (lower(email))',
    )

    /* Parcial: o telefone e nulo na maioria das linhas, e nulo repetido nao e
       duplicata. */
    await this.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS nosso_user_telefone_unico ' +
        'ON "user" ("phoneNumber") WHERE "phoneNumber" IS NOT NULL',
    )
  }

  async encerrar(): Promise<void> {
    await this.pool.end()
  }

  /**
   * Confere a credencial — RF-119, RF-120.
   *
   * ## A sessao dele e descartada
   *
   * `signInEmail` e `signInPhoneNumber` criam uma sessao do Better Auth. Nao
   * temos uso para ela: a nossa e outra, com empresa e papel dentro. Deixa-la
   * viva seria guardar por sete dias um token valido que ninguem pediu e
   * ninguem acompanha — a mesma coisa que a NR-083 acabou de consertar do nosso
   * lado.
   *
   * O descarte e o ULTIMO passo e nao pode derrubar o login: se falhar, o pior
   * caso e uma linha sobrando numa tabela que so ele le.
   *
   * ## Credencial errada e pessoa inexistente respondem igual
   *
   * E o proprio Better Auth quem garante: os dois casos vem como
   * `INVALID_EMAIL_OR_PASSWORD`. Aqui os dois viram `undefined`, que e o que a
   * porta pede — resultado, e nao excecao, para o caso de uso tratar os dois no
   * mesmo `if` (RF-120).
   */
  async verify(credential: Credential): Promise<VerifiedIdentity | undefined> {
    const entrada = await this.entrar(credential)
    if (entrada === undefined) return undefined

    /* Melhor esforco: sessao dele sobrando nao invalida um login que deu certo. */
    await this.descartarSessao(entrada.token)

    return this.identidadeDe(entrada.user.id)
  }

  private async entrar(credential: Credential): Promise<Entrada | undefined> {
    try {
      return pareceEmail(credential.identifier)
        ? ((await this.auth.api.signInEmail({
            body: { email: credential.identifier, password: credential.secret },
          })) as Entrada)
        : ((await this.auth.api.signInPhoneNumber({
            body: { phoneNumber: credential.identifier, password: credential.secret },
          })) as Entrada)
    } catch {
      /*
       * Toda falha vira `undefined`, inclusive as que nao sao "senha errada".
       *
       * E deliberado e tem custo: banco fora do ar aqui vira "credencial
       * invalida" em vez de erro de infraestrutura, e alguem pode perder tempo
       * conferindo a senha. A alternativa e pior — distinguir os casos na
       * resposta e dar a quem esta tentando um jeito de separar "conta nao
       * existe" de "sistema com problema", que e meio caminho da enumeracao que
       * a RF-120 proibe.
       */
      return undefined
    }
  }

  /**
   * O contato que ELE confirmou, para o primeiro login amarrar o `subject`.
   *
   * Lido do adapter em vez de vir da resposta de entrada porque o
   * `signInPhoneNumber` nao devolve o telefone, e `login.ts` procura o usuario
   * local por e-mail OU telefone — devolver so um dos dois faria o convidado que
   * entra pela primeira vez pelo caminho faltante receber falha na estreia.
   */
  private async identidadeDe(subject: string): Promise<VerifiedIdentity> {
    const ctx = await this.auth.$context
    const usuario = (await ctx.internalAdapter.findUserById(subject)) as
      { email?: string | null; phoneNumber?: string | null } | null | undefined

    const email = usuario?.email ?? null

    return {
      subject,
      /* O sintetico nao sai daqui: `findByEmail` procuraria um endereco que so
         existe dentro do provedor e nao acharia ninguem. */
      email: email === null || ehSintetico(email) ? null : email,
      phone: usuario?.phoneNumber ?? null,
    }
  }

  private async descartarSessao(token: string | null): Promise<void> {
    if (token === null) return

    try {
      const ctx = await this.auth.$context
      await ctx.internalAdapter.deleteSession(token)
    } catch {
      /* Ver `verify`: sobra uma linha, o login continua valido. */
    }
  }

  /**
   * Cria a credencial — NR-014, RF-001.
   *
   * `undefined` quando o identificador ja existe, como a porta pede: "ja tem
   * conta" e resposta que o cadastro trata, e nao falha.
   *
   * O telefone e gravado DEPOIS do cadastro, pelo adapter interno, porque o
   * unico caminho de cadastro que nao depende de OTP e o de e-mail. Ele entra
   * como `phoneNumberVerified: false` de proposito: ninguem confirmou nada — o
   * numero veio do formulario, e marcar como verificado seria afirmar uma prova
   * que nao existe.
   */
  async register(
    credential: Credential,
    dados: { readonly email: string | null; readonly phone: string | null },
  ): Promise<{ readonly subject: string } | undefined> {
    const email = dados.email ?? (dados.phone === null ? null : sinteticoDeTelefone(dados.phone))

    if (email === null) {
      /* Sem e-mail e sem telefone nao ha o que cadastrar. O CHECK
         `users_tem_contato` (0009) diz a mesma coisa do nosso lado. */
      return undefined
    }

    /*
     * Confere ANTES, porque `signUpEmail` nao confere.
     *
     * Sem isto ele cria um segundo usuario com o mesmo e-mail, e a porta
     * receberia um `subject` novo para uma conta que ja existe — que e o
     * oposto do que ela pede. `garantirUnicidade` fecha a corrida entre duas
     * chamadas simultaneas; esta consulta e o que da a RESPOSTA limpa
     * (`undefined`) em vez de um erro de constraint.
     */
    if (await this.jaExiste(email, dados.phone)) return undefined

    let criado: { user: { id: string } }
    try {
      criado = (await this.auth.api.signUpEmail({
        body: { name: credential.identifier, email, password: credential.secret },
      })) as { user: { id: string } }
    } catch {
      /* Senha curta demais cai aqui, e a corrida perdida no indice unico
         tambem. "Nao deu para criar" e o que o cadastro sabe fazer com as
         duas. */
      return undefined
    }

    if (dados.phone !== null) {
      try {
        const ctx = await this.auth.$context
        await ctx.internalAdapter.updateUser(criado.user.id, {
          phoneNumber: dados.phone,
          phoneNumberVerified: false,
        })
      } catch {
        /*
         * O telefone nao entrou — numero de outra pessoa, ou corrida no indice.
         *
         * Sobra um usuario com o e-mail e sem o numero, e devolver sucesso aqui
         * faria o login por telefone falhar depois, sem explicacao. Melhor
         * responder "nao deu" agora: o cadastro trata, e a linha orfa e
         * inalcancavel — ninguem tem credencial para ela.
         */
        return undefined
      }
    }

    return { subject: criado.user.id }
  }

  /**
   * Troca a senha pelo link de redefinicao — NR-014.
   *
   * Pelo adapter interno, e nao pelo `resetPassword` da biblioteca: o link e o
   * nosso (`password_reset_tokens`), porque nenhuma rota dele e montada — ver
   * `criarAuth`. O hash sai do proprio Better Auth, para o `signInEmail`
   * seguinte conferir com o mesmo algoritmo.
   */
  async setSecret(email: string, secret: string): Promise<boolean> {
    const ctx = await this.auth.$context
    const achado = await ctx.internalAdapter.findUserByEmail(email)
    if (achado === null) return false

    await ctx.internalAdapter.updatePassword(achado.user.id, await ctx.password.hash(secret))
    return true
  }

  /**
   * O e-mail ou o telefone ja pertencem a alguem?
   *
   * O telefone vai por consulta direta: o adapter interno tem
   * `findUserByEmail` e nao tem equivalente por numero — o plugin resolve isso
   * dentro do proprio endpoint de entrada.
   */
  private async jaExiste(email: string, phone: string | null): Promise<boolean> {
    const ctx = await this.auth.$context

    if ((await ctx.internalAdapter.findUserByEmail(email)) !== null) return true
    if (phone === null) return false

    const r = await this.pool.query('SELECT 1 FROM "user" WHERE "phoneNumber" = $1 LIMIT 1', [
      phone,
    ])
    return r.rowCount !== null && r.rowCount > 0
  }
}
