import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { entrar, escolherLoja } from '@/lib/auth-api'
import type { LojaDaSessao } from '@/lib/session'
import { validateCredential, validateLoginPassword } from '@/lib/validation'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/** O papel na tela e em portugues, e nao o valor do contrato. */
const PAPEL: Record<string, string> = {
  owner: 'Dono',
  staff: 'Funcionário',
  accountant: 'Contador',
  platform_admin: 'Administrador',
}

/** "Marina Alves" no cabecalho e formal demais. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome
}

export default function Login() {
  const router = useRouter()

  const [credencial, setCredencial] = useState('')
  const [senha, setSenha] = useState('')
  const [erroCredencial, setErroCredencial] = useState<string | null>(null)
  const [erroSenha, setErroSenha] = useState<string | null>(null)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  /**
   * Quem opera mais de uma loja entra e DEPOIS escolhe — US-059.
   *
   * Enquanto tem valor, a lista SUBSTITUI o formulario. A senha ja foi aceita,
   * e deixar os campos na tela convida a pessoa a digitar de novo.
   *
   * Nao e passo a mais para todo mundo: com uma loja so, a api ja escolheu e
   * esta tela nem aparece.
   */
  const [escolhendo, setEscolhendo] = useState<readonly LojaDaSessao[] | null>(null)
  const [nome, setNome] = useState('')

  async function submeter() {
    const eCred = validateCredential(credencial)
    const eSenha = validateLoginPassword(senha)
    setErroCredencial(eCred)
    setErroSenha(eSenha)
    if (eCred || eSenha) return

    setErroGeral(null)
    setCarregando(true)

    const r = await entrar(credencial, senha)

    if (r.estado === 'falhou') {
      setErroGeral(r.erro)
      setCarregando(false)
      return
    }

    if (r.estado === 'plataforma') {
      router.replace('/plataforma')
      return
    }

    if (r.estado === 'escolher-loja') {
      setNome(r.nome)
      setEscolhendo(r.lojas)
      setCarregando(false)
      return
    }

    entrarNoApp()
  }

  async function selecionar(companyId: string) {
    setErroGeral(null)
    setCarregando(true)

    const r = await escolherLoja(companyId)

    if (r.estado !== 'pronto') {
      setErroGeral(r.estado === 'falhou' ? r.erro : 'Não deu para abrir esta loja.')
      setCarregando(false)
      return
    }

    entrarNoApp()
  }

  function entrarNoApp() {
    /* `entrar` e `escolherLoja` ja guardaram sessao e token. Chamar
       `abrirSessao` aqui sobrescreveria com dados incompletos. */
    /* replace e nao push: voltar do app para o login nao faz sentido. */
    router.replace('/inicio')
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top', 'bottom']}>
      {/* No iOS o teclado cobre o campo de senha sem isto. */}
      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          <View style={estilos.marca}>
            <Text style={estilos.marcaNome}>EiBuddy</Text>
          </View>

          <View style={estilos.cabecalho}>
            <Text style={estilos.titulo}>{escolhendo === null ? 'Entrar' : 'Qual loja?'}</Text>
            <Text style={estilos.subtitulo}>
              {escolhendo === null
                ? 'Acesse o balcão do seu negócio.'
                : `Olá, ${primeiroNome(nome)}. Você tem acesso a mais de uma.`}
            </Text>
          </View>

          {erroGeral ? (
            <View style={estilos.alerta} accessibilityRole="alert">
              <Text style={estilos.alertaTexto}>{erroGeral}</Text>
            </View>
          ) : null}

          {escolhendo === null ? (
            <>
              <View style={estilos.campos}>
                <Campo
                  rotulo="E-mail ou telefone"
                  valor={credencial}
                  onChange={(v) => {
                    setCredencial(v)
                    if (erroCredencial) setErroCredencial(validateCredential(v))
                  }}
                  erro={erroCredencial}
                  placeholder="voce@empresa.com.br"
                  tipoTeclado="email-address"
                  autoCap="none"
                  editavel={!carregando}
                />

                <Campo
                  rotulo="Senha"
                  valor={senha}
                  onChange={(v) => {
                    setSenha(v)
                    if (erroSenha) setErroSenha(validateLoginPassword(v))
                  }}
                  erro={erroSenha}
                  senha
                  autoCap="none"
                  editavel={!carregando}
                />
              </View>

              <Botao onPress={submeter} carregando={carregando} largura>
                {carregando ? 'Entrando...' : 'Entrar'}
              </Botao>

              <Botao variante="fantasma" onPress={() => router.push('/recuperar-senha')} largura>
                Esqueci a senha
              </Botao>

              <Botao variante="secundario" onPress={() => router.push('/criar-conta')} largura>
                Criar conta
              </Botao>
            </>
          ) : (
            <View style={estilos.lojas}>
              {escolhendo.map((loja) => (
                <Pressable
                  key={loja.companyId}
                  onPress={() => void selecionar(loja.companyId)}
                  disabled={carregando}
                  style={({ pressed }) => [estilos.loja, pressed && estilos.lojaPressionada]}
                  accessibilityRole="button"
                  accessibilityLabel={`Entrar em ${loja.companyName} como ${PAPEL[loja.role] ?? loja.role}`}
                >
                  <Text style={estilos.lojaNome}>{loja.companyName}</Text>
                  <Text style={estilos.lojaPapel}>{PAPEL[loja.role] ?? loja.role}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  flex: { flex: 1 },
  conteudo: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: espaco.xl,
    gap: espaco.xl,
  },

  marca: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  marcaNome: {
    fontSize: fonte.titulo,
    fontWeight: peso.pesado,
    color: cores.texto,
  },

  cabecalho: { gap: espaco.sm },
  titulo: {
    fontSize: fonte.display,
    fontWeight: peso.pesado,
    color: cores.texto,
  },
  subtitulo: { fontSize: fonte.corpo, color: cores.textoFraco },

  alerta: {
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.erro,
    borderRadius: raio.sm,
    backgroundColor: cores.erroFundo,
  },
  alertaTexto: { fontSize: fonte.pequeno, color: cores.erro },

  campos: { gap: espaco.lg },

  /*
   * A lista de lojas. Alvo de toque generoso (56 de altura minima): a pessoa
   * escolhe em pe, com uma mao — RNF-053.
   */
  lojas: { gap: espaco.sm, marginTop: espaco.md },
  loja: {
    minHeight: 56,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  lojaPressionada: { borderColor: cores.acento },
  lojaNome: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  lojaPapel: { fontSize: fonte.micro, color: cores.textoFraco },
})
