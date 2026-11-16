import type { EmailSender, SupportAlertDirectory, SupportTicketAlert } from '@na-regua/core'

/**
 * O aviso de chamado novo por e-mail — DEC-029, NR-220.
 *
 * Decisao de 15/11: todo Super Admin recebe. Um e-mail por pessoa (e nao um
 * so com todos em copia): ninguem ve o endereco dos outros, e o que falhar
 * para um nao impede os demais.
 *
 * Sai pelo mesmo envio da troca de senha (SMTP ou log). Sem SMTP configurado,
 * o aviso vai para o log e a fila da Plataforma continua sendo a fonte.
 */

const ROTULO_DA_CATEGORIA: Record<string, string> = {
  financeiro: 'Financeiro',
  cadastro: 'Cadastro',
  vendas: 'Vendas',
  tecnico: 'Técnico',
  outro: 'Outro',
}

export function criarAvisoDeChamado(deps: {
  readonly email: EmailSender
  readonly diretorio: SupportAlertDirectory
  /** Endereco da web, para o link da fila. */
  readonly webUrl: string
}): SupportTicketAlert {
  return {
    chamadoAberto: async (c) => {
      const [destinatarios, loja] = await Promise.all([
        deps.diretorio.destinatarios(),
        deps.diretorio.nomeDaLoja(c.companyId),
      ])
      if (destinatarios.length === 0) return

      const nomeDaLoja = loja ?? 'Uma loja'
      const assunto = `Novo chamado ${c.protocol} — ${nomeDaLoja}: ${c.subject}`
      const texto = [
        `${nomeDaLoja} abriu um chamado de suporte.`,
        '',
        `Protocolo: ${c.protocol}`,
        `Categoria: ${ROTULO_DA_CATEGORIA[c.category] ?? c.category}`,
        `Assunto: ${c.subject}`,
        `Quem escreveu: ${c.authorName}`,
        '',
        c.body,
        '',
        `Responder: ${deps.webUrl}/app/plataforma/chamados`,
      ].join('\n')

      await Promise.allSettled(
        destinatarios.map((d) => deps.email.send({ to: d.email, subject: assunto, text: texto })),
      )
    },
  }
}
