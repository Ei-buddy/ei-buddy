import { podeEscrever } from '@na-regua/contracts'
import { AppError } from './app-error.js'
import type { Channel, ExecutionContext } from './context.js'

/**
 * Verificacao de papel — em `core`, nunca no handler HTTP.
 *
 * Se ficasse no handler, o canal WhatsApp nao a aplicaria: as duas entradas
 * chamam o mesmo caso de uso, e so uma passa por rota HTTP. E o principio 1,
 * e e o que torna verificavel a promessa de que app e WhatsApp fazem a mesma
 * coisa. Ver docs/arquitetura/seguranca.md
 */

/** Papeis que so leem. Documentado em seguranca.md: "accountant e somente leitura e exportacao". */
const SOMENTE_LEITURA = new Set(['accountant'])

/**
 * Recusa escrita de quem so pode ler.
 *
 * `platform_admin` NAO entra nesta lista: ele nao e operador da empresa, e o
 * que rege o acesso dele e a RF-131 (nao acessa dado de tenant sem registro),
 * que e outra regra e ainda nao existe. Deixar passar aqui seria inventar
 * politica; barrar aqui tambem seria. Quando a RF-131 for implementada, este
 * e o lugar dela.
 */
export function assertCanWrite(ctx: ExecutionContext): void {
  assertPapelPodeEscrever(ctx)
  assertAssinaturaPermiteEscrita(ctx)
}

/**
 * So o papel — para o que a loja RESTRITA ainda pode fazer.
 *
 * Abrir chamado no suporte e atender o titular (LGPD) continuam valendo com a
 * assinatura restrita: o suporte e o caminho para regularizar, e o direito do
 * titular nao depende de a loja estar em dia. Esses casos de uso chamam esta,
 * e nao `assertCanWrite`.
 */
export function assertPapelPodeEscrever(ctx: ExecutionContext): void {
  if (SOMENTE_LEITURA.has(ctx.role)) {
    throw AppError.forbidden('Seu perfil tem acesso somente de leitura.')
  }
}

/** A mensagem diz o que ainda da para fazer, e onde regularizar. */
export const MENSAGEM_ASSINATURA_RESTRITA =
  'A assinatura da loja está restrita: dá para consultar e exportar tudo, mas não lançar nada novo. Regularize em Assinatura para voltar a lançar.'

/**
 * Loja restrita ou cancelada so le — RF-117, RF-126.
 *
 * No servidor, e nao so na tela: a tela trancada e conveniencia, e uma
 * chamada direta da api (ou o assistente no WhatsApp) passaria por cima dela.
 * Ler e exportar continuam valendo em todos os estados — o dado e da loja.
 */
export function assertAssinaturaPermiteEscrita(ctx: ExecutionContext): void {
  const status = ctx.subscriptionStatus
  if (status !== undefined && status !== null && !podeEscrever(status)) {
    throw AppError.forbidden(MENSAGEM_ASSINATURA_RESTRITA)
  }
}

/**
 * Canais que provam identidade fraca — ADR-0002.
 *
 * O numero de WhatsApp prova CONTINUIDADE DE CONVERSA, nao identidade. Quem
 * fez SIM swap tem o numero, e a confirmacao explicita de RF-103 nao ajuda:
 * ela chega e e respondida no mesmo canal que o atacante controla. Confirmacao
 * em banda nao e segundo fator — e o primeiro fator perguntando duas vezes.
 */
const CANAL_FRACO = new Set<Channel>(['whatsapp'])

/**
 * Recusa operacao que muda acesso ou tira valor de dentro, em canal fraco.
 *
 * O eixo e TIPO DE ACAO e nao valor. Um piso monetario — "acima de R$ X pede
 * segundo canal" — foi recusado na ADR-0002 por duas razoes: transforma o
 * ataque em aritmetica, porque quem controla o numero faz N operacoes abaixo
 * da linha; e nao existe linha boa, porque o movimento diario de uma loja de
 * bairro e de uma com quatro funcionarios difere em uma ordem de grandeza.
 *
 * Cada operacao protegida por aqui tem a propriedade de que UMA execucao ja e
 * o dano: revincular o numero, conceder acesso, trocar a conta de repasse,
 * exportar a base.
 *
 * Vive em `core` e nao no handler HTTP pelo mesmo motivo que `assertCanWrite`:
 * no handler, o canal WhatsApp nao a aplicaria — que e exatamente o canal
 * contra o qual ela existe.
 *
 * `operacao` entra na mensagem porque "faca isso no aplicativo" sem dizer o
 * que nao pode ser feito manda a pessoa procurar sozinha o que ela pediu.
 */
export function assertSegundoCanal(ctx: ExecutionContext, operacao: string): void {
  if (CANAL_FRACO.has(ctx.channel)) {
    throw AppError.forbidden(
      `${operacao} exige o aplicativo, por segurança. Entre no aplicativo para continuar.`,
    )
  }
}
