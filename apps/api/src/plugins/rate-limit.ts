import rateLimit from '@fastify/rate-limit'
import { AppError } from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'

/**
 * Limite de requisicoes — RNF-026, e o alerta do CodeQL na rota de login.
 *
 * **Nao e o mesmo que a desaceleracao de login.** O `LoginThrottle` de `core`
 * conta tentativas FALHAS por identificador e por origem (RF-120): ele existe
 * para que descobrir uma senha por forca bruta seja inviavel. Isto aqui conta
 * REQUISICOES, certas ou erradas, e existe para que ninguem derrube a rota
 * batendo nela — inclusive com credencial valida.
 *
 * A diferenca fica clara no caso que so um dos dois pega: mil logins corretos
 * por segundo passam ilesos pelo throttle (ele so conta falha) e sao barrados
 * aqui.
 *
 * ## Por que Redis, e nao memoria
 *
 * O `LoginThrottle` de hoje e em memoria e por instancia — uma limitacao ja
 * registrada no PR da NR-014. Repetir isso aqui seria pior, porque o limite de
 * requisicao e justamente o controle que precisa valer para a frota inteira:
 * com duas instancias e limite por processo, o teto real dobra sem ninguem
 * perceber.
 *
 * O Redis ja existe na composicao. Quando ele nao esta disponivel o plugin cai
 * para memoria sozinho (`skipOnError`), e isso e deliberado: limite degradado
 * e melhor que api fora do ar por causa do limitador.
 */

/** Rotas de escrita — RNF-026 pede limite nelas tambem, mais folgado. */
export const LIMITE_DE_ESCRITA = { max: 120, timeWindow: '1 minute' }

/**
 * Rotas de autenticacao, bem mais apertado.
 *
 * Dez por minuto por IP acomoda com folga uma pessoa errando a senha, trocando
 * de loja e entrando de novo. Nao acomoda quem varre.
 */
export const LIMITE_DE_AUTENTICACAO = { max: 10, timeWindow: '1 minute' }

export async function registerRateLimit(app: FastifyInstance, redis?: Redis): Promise<void> {
  await app.register(rateLimit, {
    /*
     * `global: false`: cada rota declara o proprio limite. Um teto global
     * escondido faria a rota de venda de um PDV movimentado bater num limite
     * que ninguem lembra de onde veio.
     */
    global: false,
    ...(redis === undefined ? {} : { redis }),
    /* Continua servindo se o Redis cair. Ver o comentario acima. */
    skipOnError: true,

    /*
     * Chave por IP. `request.ip` atras de proxy exige `trustProxy` — a mesma
     * limitacao ja registrada na desaceleracao de login. Quando a DEC-009
     * definir a topologia, os dois passam a valer de verdade juntos.
     */
    keyGenerator: (request: FastifyRequest) => request.ip,

    /*
     * O erro sai pelo mesmo envelope de todo o resto: quem consome a api nao
     * deveria receber um formato diferente so porque bateu no limite. O
     * `error-handler` ja mapeia RATE_LIMITED para 429.
     */
    errorResponseBuilder: (_request, contexto) =>
      AppError.rateLimited(
        `Muitas requisições. Tente de novo em ${Math.ceil(contexto.ttl / 1000)} segundos.`,
      ),
  })
}
