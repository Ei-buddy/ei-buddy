import { useEffect, useRef, type RefObject } from 'react'

/**
 * O comportamento comum dos dialogos: foco no painel ao ABRIR, Esc fecha e a
 * pagina de tras nao rola.
 *
 * ## Por que o efeito roda uma vez so
 *
 * Cada dialogo tinha o proprio efeito, refeito sempre que `onCancelar` mudava
 * — e o pai passa uma funcao nova a cada render. Quando o dialogo tem um campo
 * cujo valor mora no PAI (o motivo do estorno da compra e da venda), cada
 * tecla redesenhava o pai, o efeito rodava de novo e devolvia o foco ao
 * painel: era preciso clicar no campo a cada letra — o "digitar um caractere
 * por vez" do QA.
 *
 * Agora o efeito monta na abertura e desmonta no fechamento; o Esc le a funcao
 * e o "esta processando" da hora por ref.
 */
export function useDialogo(
  painel: RefObject<HTMLElement | null>,
  onFechar: () => void,
  /** Enquanto processa, o Esc nao fecha — o pedido ja foi para o servidor. */
  ocupado = false,
): void {
  const fecharRef = useRef(onFechar)
  const ocupadoRef = useRef(ocupado)

  useEffect(() => {
    fecharRef.current = onFechar
    ocupadoRef.current = ocupado
  })

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ocupadoRef.current) fecharRef.current()
    }
    document.addEventListener('keydown', aoTeclar)
    document.body.style.overflow = 'hidden'
    painel.current?.focus()
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = ''
    }
  }, [painel])
}
