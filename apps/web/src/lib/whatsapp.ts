/**
 * Mandar texto pelo WhatsApp — achado do QA: "verificar se o aplicativo do
 * Whats esta aberto, caso nao, recorrer ao Whats Web".
 *
 * Antes o botao abria `wa.me`, uma pagina intermediaria do WhatsApp que pede
 * mais um clique (e, no computador sem o aplicativo, mais outro para o Web).
 *
 * ## Como sabemos se o aplicativo abriu
 *
 * O navegador nao conta se um endereco `whatsapp://` tem aplicativo
 * instalado. O sinal que existe e indireto: quando o aplicativo (ou a pergunta
 * "Abrir o WhatsApp?") aparece, a janela do navegador PERDE o foco. Se em
 * `ESPERA_MS` a pagina continua com foco e visivel, nada abriu — e o WhatsApp
 * Web vai numa aba nova, com o mesmo texto.
 *
 * O resultado fica lembrado nesta aba (`sessionStorage`): quem nao tem o
 * aplicativo vai direto para o Web nos proximos envios, sem esperar; uma aba
 * nova tenta o aplicativo de novo (alguem pode ter instalado).
 *
 * No celular, `wa.me` ja e o caminho certo: o sistema abre o aplicativo
 * direto, e sem ele a pagina oferece instalar.
 */

export const ESPERA_MS = 1500
const CHAVE = 'nr:whatsapp-caminho'

export type Destino = { texto: string; telefone?: string | null }

/** So digitos, com o 55 do Brasil quando falta. Vazio quando nao ha numero. */
export function telefoneParaWhatsApp(telefone: string | null | undefined): string {
  const d = (telefone ?? '').replace(/\D/g, '')
  if (d === '') return ''
  return d.startsWith('55') && d.length > 11 ? d : `55${d}`
}

function parametros({ texto, telefone }: Destino): string {
  const q = new URLSearchParams()
  const numero = telefoneParaWhatsApp(telefone)
  if (numero !== '') q.set('phone', numero)
  q.set('text', texto)
  return q.toString()
}

export const enderecoDoAplicativo = (d: Destino) => `whatsapp://send?${parametros(d)}`
export const enderecoDoWeb = (d: Destino) => `https://web.whatsapp.com/send?${parametros(d)}`

export function enderecoDoCelular({ texto, telefone }: Destino): string {
  const numero = telefoneParaWhatsApp(telefone)
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

export function eCelular(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
}

function lembrado(): 'app' | 'web' | null {
  try {
    const v = window.sessionStorage.getItem(CHAVE)
    return v === 'app' || v === 'web' ? v : null
  } catch {
    return null
  }
}

function lembrar(v: 'app' | 'web') {
  try {
    window.sessionStorage.setItem(CHAVE, v)
  } catch {
    /* Aba anonima ou armazenamento bloqueado: so nao lembra. */
  }
}

/**
 * Abre o WhatsApp com o texto. Chame DENTRO do clique: abrir aba nova fora de
 * um gesto do usuario e bloqueado como pop-up.
 *
 * Devolve o caminho tomado; `'bloqueado'` quando o navegador barrou a aba do
 * WhatsApp Web — a tela oferece o link para clicar.
 */
export function abrirWhatsApp(destino: Destino): Promise<'celular' | 'app' | 'web' | 'bloqueado'> {
  if (eCelular(navigator.userAgent)) {
    window.location.href = enderecoDoCelular(destino)
    return Promise.resolve('celular')
  }

  /* Sem `noopener` nos recursos: com ele, `window.open` devolve `null`
     sempre, e nao daria para saber se o navegador barrou a aba. */
  const abrirWeb = (): 'web' | 'bloqueado' => {
    const aba = window.open(enderecoDoWeb(destino), '_blank')
    if (aba === null) return 'bloqueado'
    aba.opener = null
    return 'web'
  }

  if (lembrado() === 'web') return Promise.resolve(abrirWeb())

  return new Promise((resolve) => {
    let saiu = false
    const marcarSaida = () => {
      saiu = true
    }
    const aoMudarVisibilidade = () => {
      if (document.hidden) saiu = true
    }
    window.addEventListener('blur', marcarSaida)
    document.addEventListener('visibilitychange', aoMudarVisibilidade)

    window.location.href = enderecoDoAplicativo(destino)

    window.setTimeout(() => {
      window.removeEventListener('blur', marcarSaida)
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      if (saiu) {
        lembrar('app')
        resolve('app')
        return
      }
      lembrar('web')
      resolve(abrirWeb())
    }, ESPERA_MS)
  })
}
