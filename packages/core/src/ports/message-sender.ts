import type {
  InboundReadResult,
  SendMediaRequest,
  SendResult,
  SendTextRequest,
} from '@na-regua/contracts'

/**
 * Porta do envio de mensagem — RF-015, RF-016, RF-094, RF-095.
 *
 * Declarada aqui, implementada por `whatsapp` — a seta aponta para dentro.
 * Como nas outras portas de adapter, nenhum tipo dela mora em `core`: a regra
 * `adapter-nao-importa-core` proibe o adapter de importar `core`, entao o
 * vocabulario e de `contracts`.
 *
 * ## O que esta porta deliberadamente NAO tem
 *
 * **Nao tem envio sem declarar base de consentimento.** Todo pedido carrega
 * `consent`, e o tipo nao permite omitir. A verificacao continua sendo de
 * `core`, que tem o cadastro do cliente — mas o adapter nao oferece caminho que
 * a contorne, que e o que o README de `whatsapp` exige. Mensagem a cliente
 * final sem consentimento registrado e sancao da ANPD e denuncia por spam
 * (ameaca T3).
 *
 * **Nao tem envio em massa.** Um metodo que aceitasse lista de destinatarios
 * seria o caminho mais curto entre este sistema e uma denuncia por spam.
 * Enviar para muitos e enfileirar muitos envios — e a fila tem limite de taxa.
 *
 * **Nao tem envio de mensagem de modelo.** Fora da janela de 24 horas so sai
 * modelo aprovado. O vocabulário Graph (`type: template`) entra no adapter da
 * NR-046, não em `core`. Por ora, `outside_service_window` volta como recusa
 * explicita, para `core` saber que precisa de modelo em vez de retentar.
 */
export type MessageSender = {
  /**
   * Envia texto — RF-015.
   *
   * Idempotente por `idempotencyKey`: a fila reprocessa, e mensagem duplicada
   * e o lojista parecendo insistente com o cliente dele.
   *
   * Recusa por destinatario e resultado, nao excecao — "numero nao tem
   * WhatsApp" nao pode desfazer a venda que gerou o comprovante. Excecao fica
   * para falha de infraestrutura: token invalido, provedor fora do ar.
   */
  sendText(request: SendTextRequest): Promise<SendResult>

  /** Envia imagem ou documento — comprovante, DANFE, foto de produto. */
  sendMedia(request: SendMediaRequest): Promise<SendResult>

  /**
   * Le um webhook de mensagem recebida.
   *
   * Recebe o **corpo bruto** porque o HMAC e sobre os bytes que chegaram —
   * reserializar depois de `JSON.parse` muda os bytes e nenhuma assinatura
   * legitima passa (RNF-028). Sincrona: e HMAC local, sem I/O.
   *
   * **Nao decide se o numero esta vinculado** (RF-094) nem se o texto e um
   * pedido de opt-out. As duas coisas dependem de cadastro, que e de `core`, e
   * RF-095 exige que numero nao vinculado seja ignorado *sem revelar
   * informacao* — o que significa que quem responde nao pode ser o adapter.
   */
  readInbound(rawBody: string, signature: string): InboundReadResult
}
