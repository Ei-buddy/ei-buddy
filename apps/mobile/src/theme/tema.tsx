import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { aplicarTema, type Tema } from './tokens'

/**
 * Tema claro e escuro do app — NR-167, o par do botao de tema do web (NR-099).
 *
 * O escuro continua o padrao, como no web. A escolha fica no aparelho.
 *
 * Trocar o tema REDESENHA a arvore (a `key` muda): os estilos sao montados por
 * tema (`criarEstilos`), mas so o que desenha de novo le as cores novas. A tela
 * em que a pessoa estava e reaberta pelo `LayoutRaiz`.
 */

const CHAVE_TEMA = 'eibuddy:tema'

type ContextoDoTema = { tema: Tema; alternarTema: () => void }

const Contexto = createContext<ContextoDoTema>({ tema: 'escuro', alternarTema: () => {} })

export const useTema = () => useContext(Contexto)

export function TemaProvider({
  children,
  aoTrocar,
}: {
  children: (tema: Tema) => ReactNode
  /** Chamado antes de redesenhar — a raiz guarda a tela atual para voltar a ela. */
  aoTrocar?: () => void
}) {
  const [tema, setTema] = useState<Tema | null>(null)

  useEffect(() => {
    void (async () => {
      let guardado: Tema = 'escuro'
      try {
        guardado = (await AsyncStorage.getItem(CHAVE_TEMA)) === 'claro' ? 'claro' : 'escuro'
      } catch {
        /* Sem armazenamento: fica no padrao, como no web. */
      }
      aplicarTema(guardado)
      setTema(guardado)
    })()
  }, [])

  const alternarTema = useCallback(() => {
    setTema((atual) => {
      const novo: Tema = atual === 'claro' ? 'escuro' : 'claro'
      aoTrocar?.()
      aplicarTema(novo)
      void AsyncStorage.setItem(CHAVE_TEMA, novo).catch(() => undefined)
      return novo
    })
  }, [aoTrocar])

  /* Ate saber o tema guardado, nada: desenhar no escuro e trocar em seguida
     seria um piscar de tela inteira para quem escolheu o claro. */
  if (tema === null) return null

  return <Contexto.Provider value={{ tema, alternarTema }}>{children(tema)}</Contexto.Provider>
}
