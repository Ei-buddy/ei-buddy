import type { CompanyId } from '../context.js'

/**
 * O aviso de chamado novo para a equipe EiBuddy — DEC-029.
 *
 * Decisao de 15/11: todo Super Admin recebe o aviso. Quem resolve PARA QUEM
 * vai (e por qual canal) e o adapter; o caso de uso so diz que um chamado
 * nasceu, e com o que a equipe precisa para decidir se age agora.
 */
export type SupportTicketAlert = {
  chamadoAberto(info: {
    readonly companyId: CompanyId
    readonly ticketId: string
    readonly protocol: string
    readonly subject: string
    readonly category: string
    readonly authorName: string
    readonly body: string
  }): Promise<void>
}

/**
 * O que o aviso de chamado precisa saber — DEC-029. O banco implementa:
 * os Super Admins ativos (por funcao, a tabela nao tem RLS aberta) e o nome
 * da loja, lido dentro do tenant dela.
 */
export type SupportAlertDirectory = {
  destinatarios(): Promise<{ nome: string; email: string }[]>
  nomeDaLoja(companyId: CompanyId): Promise<string | null>
}
