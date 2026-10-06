import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { lerSessao } from '@/lib/session'
import { cores } from '@/theme/tokens'

/**
 * Porta de entrada: decide entre login e app conforme haja sessao.
 *
 * A leitura do AsyncStorage e assincrona, entao existe um instante sem
 * resposta — mostrar o indicador evita a piscada de tela de login para
 * quem ja esta logado.
 */
export default function Entrada() {
  const [estado, setEstado] = useState<'verificando' | 'logado' | 'plataforma' | 'deslogado'>(
    'verificando',
  )

  useEffect(() => {
    let cancelado = false

    async function verificar() {
      const sessao = await lerSessao()

      /*
       * Sessao SEM loja escolhida volta para o login, e nao para o painel.
       *
       * E o estado de quem fechou o app entre entrar e escolher a loja: o token
       * esta guardado e valido, mas nenhuma empresa esta ativa. Deixar passar
       * abriria o painel com toda chamada falhando, sem nada explicando.
       *
       * `empresaId === undefined` cobre quem ja tinha sessao antes deste campo
       * existir: entrar de novo custa um login e evita um app que nao funciona.
       */
      const pronta = sessao !== null && typeof sessao.empresaId === 'string'
      /* Super Admin sem loja ativa e estado valido: a area dele e a plataforma. */
      const plataforma = sessao !== null && sessao.empresaId === null && sessao.admin === true
      if (!cancelado) setEstado(pronta ? 'logado' : plataforma ? 'plataforma' : 'deslogado')
    }

    void verificar()
    return () => {
      cancelado = true
    }
  }, [])

  if (estado === 'verificando') {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator color={cores.acento} />
      </View>
    )
  }

  return (
    <Redirect
      href={estado === 'logado' ? '/inicio' : estado === 'plataforma' ? '/plataforma' : '/login'}
    />
  )
}

const estilos = StyleSheet.create({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.fundo,
  },
})
