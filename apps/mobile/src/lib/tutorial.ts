import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Tutorial guiado do app — NR-166, o par do tutorial do painel web (NR-101).
 *
 * Como no web: "ja vi?" sobrevive a fechar o app (no aparelho); "esta na
 * tela agora?" e so desta sessao, em memoria.
 */

const CHAVE_TUTORIAL = 'eibuddy:tutorial-visto'

export async function tutorialJaVisto(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHAVE_TUTORIAL)) === '1'
  } catch {
    /* Sem armazenamento, nao insistir: melhor nao mostrar que mostrar sempre. */
    return true
  }
}

let ativo = false
const ouvintes = new Set<(ativo: boolean) => void>()

export function assinarTutorial(ouvinte: (ativo: boolean) => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

export const tutorialAtivo = () => ativo

function avisar() {
  for (const o of ouvintes) o(ativo)
}

/** Chamado pelo inicio automatico (primeira abertura) e pelo item do menu. */
export function iniciarTutorial(): void {
  ativo = true
  avisar()
}

/** Pular ou terminar dao no mesmo lugar: marcado como visto, sai da tela. */
export function encerrarTutorial(): void {
  ativo = false
  avisar()
  void AsyncStorage.setItem(CHAVE_TUTORIAL, '1').catch(() => undefined)
}
