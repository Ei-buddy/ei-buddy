function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** Pedido explícito de cadastro na mensagem da foto (FR-004, FR-012). */
export function temPedidoCadastroExplicito(text: string): boolean {
  const compact = normalizar(text)
  if (compact === '') return false
  return /cadastr/.test(compact)
}
