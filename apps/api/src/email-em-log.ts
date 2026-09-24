import type { EmailSender } from '@na-regua/core'

/**
 * E-mail FALSO: escreve no log em vez de enviar — NR-014.
 *
 * O provedor de e-mail ainda nao foi escolhido (SES, Resend, SMTP). Ate la, o
 * desenvolvimento precisa ver o link de redefinir senha, e o log e onde ele
 * aparece. Quando o provedor chegar, e so trocar esta porta na composicao.
 *
 * Em PRODUCAO o corpo nao vai para o log: ele carrega o link, e link de
 * redefinicao em log e senha trocavel lida por quem tiver acesso aos logs. Fica
 * so o aviso de que nada foi enviado.
 */
export function criarEmailEmLog(producao: boolean): EmailSender {
  return {
    send: async (mensagem) => {
      if (producao) {
        console.warn(
          `[email] provedor de e-mail nao configurado: "${mensagem.subject}" NAO foi enviado.`,
        )
        return
      }
      console.info(`[email] para ${mensagem.to} — ${mensagem.subject}\n${mensagem.text}\n[/email]`)
    },
  }
}
