import { useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { recuperarSenha } from '@/lib/auth-api'
import { validateEmail } from '@/lib/validation'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Esqueci a senha — a mesma rota do web. O link chega por e-mail e abre a
 * pagina de nova senha no navegador.
 */
export default function RecuperarSenha() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function enviar() {
    const problema = validateEmail(email)
    if (problema !== null) {
      setErro(problema)
      return
    }
    setEnviando(true)
    setErro(null)
    const r = await recuperarSenha(email)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setEnviado(true)
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <KeyboardAvoidingView
        style={estilos.tela}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          <Text style={estilos.titulo}>Recuperar senha</Text>
          {enviado ? (
            <Text style={estilos.texto}>
              Se existir uma conta para {email.trim()}, enviamos um link para criar uma nova senha.
              Confira a caixa de entrada e o spam.
            </Text>
          ) : (
            <>
              <Text style={estilos.texto}>
                Informe o e-mail da sua conta e enviamos um link para criar uma nova senha.
              </Text>
              <Campo
                rotulo="E-mail"
                valor={email}
                onChange={setEmail}
                erro={erro}
                tipoTeclado="email-address"
                autoCap="none"
                placeholder="voce@empresa.com.br"
              />
              <Botao onPress={() => void enviar()} carregando={enviando} largura>
                Enviar link
              </Botao>
            </>
          )}
          <Botao variante="fantasma" onPress={() => router.back()} largura>
            Voltar para o login
          </Botao>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { flexGrow: 1, justifyContent: 'center', padding: espaco.xl, gap: espaco.lg },
  titulo: { fontSize: fonte.display, fontWeight: peso.pesado, color: cores.texto },
  texto: { fontSize: fonte.corpo, color: cores.textoFraco, lineHeight: 22 },
}))
