/** NR-116 — foto ilegivel; orienta venda ou cadastro por texto. */
export const TEXTO_RECUSA_FOTO_ILEGIVEL =
  'Nao consegui ler o codigo de barras desta foto. Nada foi registrado. Para vender ou cadastrar um produto, descreva-o por texto.'

/** NR-116 — varios codigos na mesma foto (FR-011). */
export const TEXTO_RECUSA_FOTO_MULTIPLOS =
  'Encontrei mais de um codigo de barras nesta foto. Envie uma foto com um produto por vez. Nada foi registrado.'

/** NR-116 — codigo lido sem produto no cadastro e sem pedido de cadastro. */
export const TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO =
  'Nao encontrei esse codigo no cadastro. Nada foi registrado. Descreva o produto por texto para vender ou cadastrar.'

export const MIME_FOTO_VALIDOS = new Set<string>(['image/jpeg', 'image/png', 'image/webp'])

/** NR-116 — cadastro explicito + codigo lido sem produto (FR-004). */
export function TEXTO_FOTO_CADASTRO_CODIGO(barcode: string): string {
  return `Codigo de barras lido: ${barcode}. Para cadastrar este produto, informe nome, custo e preco por texto. Nada foi registrado.`
}

/** NR-116 — cadastro explicito + produto ja existente (FR-004). */
export function TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE(description: string): string {
  return `Esse codigo ja esta cadastrado como ${description}. Nada foi registrado.`
}
