import type { KeyboardEvent } from 'react'

/** Campos em que o Enter do navegador ENVIA o formulario (envio implicito). */
const NAO_SAO_TEXTO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'])

function eCampoDeTexto(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !NAO_SAO_TEXTO.has(el.type) && el.type !== 'hidden'
}

function podeReceberFoco(
  el: Element,
): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLSelectElement) &&
    !(el instanceof HTMLTextAreaElement)
  )
    return false
  if (el.disabled || el.tabIndex < 0) return false
  if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.readOnly)) return false
  return el.getClientRects().length > 0
}

/**
 * Enter num campo do formulario PASSA para o proximo campo, em vez de enviar —
 * achado do QA ("um Enter em qualquer campo esta finalizando a compra").
 *
 * Use no `onKeyDown` do `<form>`. Campo que ja usa o Enter (busca de produto,
 * de fornecedor) chama `preventDefault` antes e fica como esta. Enviar passa a
 * ser so pelo botao — os botoes do caminho sao pulados, para dois Enters
 * seguidos nao registrarem nada sem querer.
 */
export function enterVaiParaOProximoCampo(e: KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return
  const atual = e.target as Element
  if (!eCampoDeTexto(atual) && !(atual instanceof HTMLSelectElement)) return
  e.preventDefault()
  const campos = Array.from(e.currentTarget.elements).filter(podeReceberFoco)
  const proximo = campos[campos.indexOf(atual as HTMLInputElement) + 1]
  proximo?.focus()
  if (proximo instanceof HTMLInputElement && eCampoDeTexto(proximo)) proximo.select()
}
