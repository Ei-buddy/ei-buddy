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
/**
 * Os dialogos abertos, do mais antigo ao de cima. O cadastro rapido de
 * fornecedor abre POR CIMA da nova conta a pagar (achado do QA, NR-207): sem a
 * pilha, um Esc fechava as duas janelas, e fechar a de cima liberava a rolagem
 * da pagina com a de baixo ainda aberta.
 */
const pilha: symbol[] = []

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
    const eu = Symbol('dialogo')
    pilha.push(eu)
    const aoTeclar = (e: KeyboardEvent) => {
      /* So o dialogo de cima responde ao Esc. */
      if (e.key !== 'Escape' || pilha[pilha.length - 1] !== eu) return
      /* Um campo de dentro ja usou o Esc (a busca de cliente fechando a
         propria lista, NR-217) e o marcou com `preventDefault`. Parar a
         propagacao nao bastaria: no App Router o React escuta no proprio
         `document`, o mesmo no deste ouvinte. */
      if (e.defaultPrevented) return
      if (!ocupadoRef.current) fecharRef.current()
    }
    document.addEventListener('keydown', aoTeclar)
    document.body.style.overflow = 'hidden'
    /* Campo com `autoFocus` dentro do dialogo fica com o foco; o painel so o
       recebe quando nada dentro dele o tem. */
    if (!painel.current?.contains(document.activeElement)) painel.current?.focus()
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      const i = pilha.indexOf(eu)
      if (i >= 0) pilha.splice(i, 1)
      if (pilha.length === 0) document.body.style.overflow = ''
    }
  }, [painel])
}
