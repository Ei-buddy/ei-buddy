import type { EmailSender, EmailTester } from '@na-regua/core'
import nodemailer from 'nodemailer'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * E-mail por SMTP — NR-014.
 *
 * ## Por que SMTP, e nao o SDK de um provedor
 *
 * O provedor ainda nao foi escolhido, e escolher um SDK agora amarraria o
 * codigo a essa escolha antes de ela existir. SES, Resend, Mailgun, Postmark,
 * Brevo e ate o Gmail falam SMTP: com ele, decidir vira preencher cinco
 * variaveis, e trocar de provedor depois nao toca em nenhuma linha daqui.
 *
 * O compose local ja sobe o Mailpit no perfil `full` (porta 1025) — com
 * `EMAIL_PROVIDER=smtp` e `SMTP_HOST=localhost`, o e-mail de redefinir senha
 * aparece na interface dele em vez de sumir no log.
 *
 * ## Falha de envio NAO derruba o pedido
 *
 * Quem chama e `requestPasswordReset`, que responde a mesma coisa com ou sem
 * conta (RF-120). Deixar a excecao subir faria o endpoint responder 500 quando
 * o e-mail existe e 200 quando nao existe — e aa diferenca de resposta e
 * exatamente o que aquela regra existe para esconder. Entao a falha vira log
 * de aviso, com o motivo, e o token gravado simplesmente expira sozinho.
 */

export type ConfiguracaoSmtp = {
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly from: string
  readonly user?: string | undefined
  readonly password?: string | undefined
}

export function criarEmailSmtp(config: ConfiguracaoSmtp): EmailSender & EmailTester {
  const transporte = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    /*
     * Limites curtos — achado do QA. O padrao do nodemailer espera ate 2 min
     * para conectar: com a porta bloqueada no servidor, o pedido de nova
     * senha e o teste do Super Admin ficavam pendurados em vez de mostrar o
     * motivo ("connect ETIMEDOUT").
     */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    /*
     * Sem `auth` quando nao ha usuario: servidor de teste (Mailpit) e relay
     * interno costumam aceitar sem autenticacao, e mandar `{ user: undefined }`
     * faz o nodemailer tentar autenticar assim mesmo e falhar.
     */
    ...(config.user === undefined
      ? {}
      : { auth: { user: config.user, pass: config.password ?? '' } }),
  })

  return {
    mode: 'smtp',

    /*
     * O teste NAO engole a falha — achado do QA. O motivo volta para o Super
     * Admin ("535 Username and Password not accepted", "connect ETIMEDOUT"):
     * e o que diz se o problema e a senha de app, a porta ou o remetente.
     */
    test: async (destino) => {
      try {
        await transporte.sendMail({
          from: config.from,
          to: destino,
          subject: 'Teste de e-mail do EiBuddy',
          text: [
            'Este é um e-mail de teste do EiBuddy.',
            '',
            'Se ele chegou, a redefinição de senha e os avisos de Parceiro também chegam.',
          ].join('\n'),
        })
        return { ok: true }
      } catch (erro) {
        return { ok: false, reason: motivoDoErro(erro) }
      }
    },

    send: async (mensagem) => {
      try {
        await transporte.sendMail({
          from: config.from,
          to: mensagem.to,
          subject: mensagem.subject,
          text: mensagem.text,
        })
      } catch (erro) {
        /*
         * O DESTINATARIO nao entra no log. Ver o comentario do adapter de log:
         * o corpo carrega o link de redefinicao, e aqui basta saber que o envio
         * falhou e por que — o endereco nao ajuda a diagnosticar e vaza quem
         * pediu para trocar a senha.
         */
        console.warn(
          JSON.stringify({
            level: 40,
            msg: 'envio de e-mail falhou — o token expira sozinho',
            assunto: mensagem.subject,
            motivo: motivoDoErro(erro),
          }),
        )
      }
    },
  }
}
