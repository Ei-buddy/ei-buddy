/**
 * Filas do sistema.
 *
 * Nomenclatura: `<dominio>-<acao>` em kebab-case (docs/produto/glossario.md).
 * NAO usar `:` — o BullMQ o reserva como separador de chave no Redis e recusa
 * o nome em tempo de execucao.
 * Toda fila precisa de fila de descarte visivel e reprocessavel — RNF-062.
 */
export const QUEUES = {
  /** Emissao fiscal assincrona. Nao pode bloquear o fechamento da venda — RNF-004. */
  invoiceIssue: 'invoice-issue',
  /** Envio de mensagem pelo WhatsApp: cobranca, comprovante, catalogo. */
  whatsappSend: 'whatsapp-send',
  /** Varredura diaria de recebiveis vencidos — docs/arquitetura/fluxos.md */
  chargeOverdue: 'charge-overdue',
  /** Expurgo de corpos de conversa com mais de 30 dias — RNF-035, NR-062 US5. */
  conversationPurge: 'conversation-purge',
  /** Importacao periodica de extrato bancario. */
  bankSync: 'bank-sync',
  /** Processamento de webhook recebido, apos resposta 200 imediata. */
  webhookProcess: 'webhook-process',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/** Politica padrao: espera crescente e limite de tentativas — RNF-011, RF-130. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: false,
} as const
