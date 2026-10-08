import { Stack, usePathname, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TemaProvider } from '@/theme/tema'
import { cores } from '@/theme/tokens'

/**
 * Layout raiz.
 *
 * `headerShown: false` porque cada tela desenha o proprio cabecalho —
 * o header nativo do Stack nao acompanha a identidade do app.
 *
 * O `TemaProvider` (NR-167) aplica o tema guardado antes do primeiro desenho
 * e, na troca, redesenha tudo e volta para a tela em que a pessoa estava.
 */
export default function LayoutRaiz() {
  const caminho = usePathname()
  const router = useRouter()
  const voltarPara = useRef<string | null>(null)

  const guardarTela = useCallback(() => {
    voltarPara.current = caminho
  }, [caminho])

  return (
    <SafeAreaProvider>
      <TemaProvider aoTrocar={guardarTela}>
        {(tema) => (
          <Arvore
            key={tema}
            tema={tema}
            aoMontar={() => {
              const destino = voltarPara.current
              voltarPara.current = null
              if (destino) router.replace(destino as never)
            }}
          />
        )}
      </TemaProvider>
    </SafeAreaProvider>
  )
}

function Arvore({ tema, aoMontar }: { tema: 'claro' | 'escuro'; aoMontar: () => void }) {
  useEffect(() => {
    /* So na montagem: e a volta para a tela depois da troca de tema. */
    aoMontar()
  }, [])

  return (
    <>
      {/* Texto da barra de status contra o fundo do tema. */}
      <StatusBar style={tema === 'claro' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: cores.fundo },
          animation: 'slide_from_right',
        }}
      />
    </>
  )
}
