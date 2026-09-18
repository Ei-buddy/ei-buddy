/** Rascunho de venda por foto — uma volta, fora de PendingConfirmation. */
export type PhotoSaleDraft = {
  readonly productId: string
  readonly barcode: string
  readonly salePriceCents: number
  readonly description: string
}

const drafts = new Map<string, PhotoSaleDraft>()

function chave(companyId: string, conversationKey: string): string {
  return `${companyId}:${conversationKey}`
}

export function salvarRascunhoFoto(
  companyId: string,
  conversationKey: string,
  draft: PhotoSaleDraft,
): void {
  drafts.set(chave(companyId, conversationKey), draft)
}

export function pegarRascunhoFoto(
  companyId: string,
  conversationKey: string,
): PhotoSaleDraft | undefined {
  return drafts.get(chave(companyId, conversationKey))
}

export function limparRascunhoFoto(companyId: string, conversationKey: string): void {
  drafts.delete(chave(companyId, conversationKey))
}
