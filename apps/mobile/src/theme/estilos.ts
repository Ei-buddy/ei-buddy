import { StyleSheet } from 'react-native'
import { temaDaVez, type Tema } from './tokens'

/**
 * `StyleSheet.create` por tema — NR-167.
 *
 * A folha e montada na primeira leitura de cada tema e guardada. A fabrica le
 * `cores` e `vidro` NA HORA de montar, entao o claro e o escuro saem dos
 * mesmos estilos escritos uma vez so.
 */
export function criarEstilos<T extends StyleSheet.NamedStyles<T>>(
  fabrica: () => T & StyleSheet.NamedStyles<unknown>,
): T {
  const porTema: Partial<Record<Tema, T>> = {}
  const atual = (): T => (porTema[temaDaVez()] ??= StyleSheet.create(fabrica()))
  return new Proxy({} as T, {
    get: (_alvo, chave) => atual()[chave as keyof T],
    has: (_alvo, chave) => chave in atual(),
    ownKeys: () => Reflect.ownKeys(atual()),
    getOwnPropertyDescriptor: (_alvo, chave) => ({
      enumerable: true,
      configurable: true,
      value: atual()[chave as keyof T],
    }),
  })
}
