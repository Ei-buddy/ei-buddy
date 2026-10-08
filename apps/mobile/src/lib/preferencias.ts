import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Preferencias da tela inicial guardadas no aparelho — NR-161.
 *
 * As mesmas do web (`lib/meta.ts` e o "Primeiros passos" dispensado), que la
 * moram no `localStorage`: uma preferencia que a pessoa define em segundos e
 * que nao precisa acompanha-la entre aparelhos. Em centavos, como todo
 * dinheiro do sistema.
 */

const CHAVE_META = 'eibuddy:meta-diaria'
const CHAVE_CHECKLIST = 'eibuddy:checklist-dispensado'

/** `null` = sem meta definida. */
export async function lerMeta(): Promise<number | null> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_META)
    if (bruto === null) return null
    const centavos = Number.parseInt(bruto, 10)
    return Number.isFinite(centavos) && centavos > 0 ? centavos : null
  } catch {
    return null
  }
}

export async function definirMeta(centavos: number | null): Promise<void> {
  try {
    if (centavos === null || centavos <= 0) await AsyncStorage.removeItem(CHAVE_META)
    else await AsyncStorage.setItem(CHAVE_META, String(Math.round(centavos)))
  } catch {
    /* Sem onde gravar, a meta nao sobrevive a proxima abertura — mesma
       decisao do web. */
  }
}

export async function checklistDispensado(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHAVE_CHECKLIST)) === '1'
  } catch {
    return false
  }
}

export async function dispensarChecklist(): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_CHECKLIST, '1')
  } catch {
    /* idem */
  }
}
