import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { conferirCupom, criarConta, type ResultadoDoCupom } from '@/lib/auth-api'
import { buscarCnpj } from '@/lib/empresa-api'
import {
  maskCNPJ,
  maskPhone,
  validateCNPJ,
  validateEmail,
  validateName,
  validatePassword,
} from '@/lib/validation'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3100'

/**
 * Criar conta — RF-001, a mesma rota do web.
 *
 * Voce, a loja (CNPJ com preenchimento pela Receita) e o cupom de indicacao,
 * opcional e conferido antes de enviar. A conta nasce logada e cai na tela
 * principal.
 */
export default function CriarConta() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [celular, setCelular] = useState('')
  const [senha, setSenha] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cupom, setCupom] = useState('')
  const [cupomConferido, setCupomConferido] = useState<ResultadoDoCupom | null>(null)
  const [aceitou, setAceitou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const [conferindo, setConferindo] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function preencherPeloCnpj(valor: string) {
    if (valor.replace(/\D/g, '').length !== 14) return
    setBuscandoCnpj(true)
    const r = await buscarCnpj(valor)
    setBuscandoCnpj(false)
    if (r.ok && razaoSocial.trim() === '') setRazaoSocial(r.dados.razaoSocial)
  }

  async function conferir() {
    setConferindo(true)
    setCupomConferido(await conferirCupom(cupom))
    setConferindo(false)
  }

  async function enviar() {
    const problema =
      validateName(nome) ??
      validateEmail(email) ??
      validatePassword(senha) ??
      validateCNPJ(cnpj) ??
      (razaoSocial.trim().length < 2 ? 'Informe a razão social.' : null) ??
      (cupom.trim() !== '' && cupomConferido?.valido !== true
        ? 'Confira o cupom ou deixe o campo vazio.'
        : null) ??
      (aceitou ? null : 'É preciso aceitar os Termos de Uso e a Política de Privacidade.')
    if (problema !== null) {
      setErro(problema)
      return
    }
    setErro(null)
    setEnviando(true)
    const r = await criarConta({
      nome,
      email,
      celular,
      senha,
      razaoSocial,
      cnpj,
      cupom: cupomConferido?.valido === true ? cupomConferido.codigo : null,
    })
    setEnviando(false)
    if (r.estado === 'falhou') {
      setErro(r.erro)
      return
    }
    router.replace('/inicio')
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <KeyboardAvoidingView
        style={estilos.tela}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          <Text style={estilos.titulo}>Criar conta</Text>

          <Text style={estilos.secao}>Você</Text>
          <Campo rotulo="Seu nome" valor={nome} onChange={setNome} autoCap="words" />
          <Campo
            rotulo="E-mail"
            valor={email}
            onChange={setEmail}
            tipoTeclado="email-address"
            autoCap="none"
          />
          <Campo
            rotulo="Celular com DDD (opcional)"
            valor={celular}
            onChange={(v) => setCelular(maskPhone(v))}
            tipoTeclado="phone-pad"
          />
          <Campo
            rotulo="Senha"
            valor={senha}
            onChange={setSenha}
            senha
            autoCap="none"
            dica="Ao menos 8 caracteres."
          />

          <Text style={estilos.secao}>Sua loja</Text>
          <Campo
            rotulo="CNPJ"
            valor={cnpj}
            onChange={(v) => {
              const m = maskCNPJ(v)
              setCnpj(m)
              void preencherPeloCnpj(m)
            }}
            tipoTeclado="numeric"
            dica={buscandoCnpj ? 'Buscando na Receita...' : undefined}
          />
          <Campo rotulo="Razão social" valor={razaoSocial} onChange={setRazaoSocial} />

          <Text style={estilos.secao}>Cupom de indicação (opcional)</Text>
          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Campo
                rotulo="Cupom"
                valor={cupom}
                onChange={(v) => {
                  setCupom(v.toUpperCase())
                  setCupomConferido(null)
                }}
                autoCap="characters"
              />
            </View>
            <View style={estilos.botaoCupom}>
              <Botao
                variante="secundario"
                onPress={() => void conferir()}
                carregando={conferindo}
                desabilitado={cupom.trim() === ''}
              >
                Conferir
              </Botao>
            </View>
          </View>
          {cupomConferido !== null ? (
            <Text style={cupomConferido.valido ? estilos.ok : estilos.erro}>
              {cupomConferido.valido
                ? `Indicação de ${cupomConferido.parceiro}: ${cupomConferido.beneficio}.`
                : cupomConferido.mensagem}
            </Text>
          ) : null}

          <Pressable
            style={estilos.termos}
            onPress={() => setAceitou((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: aceitou }}
          >
            <View style={[estilos.caixa, aceitou && estilos.caixaMarcada]}>
              {aceitou ? <Text style={estilos.marca}>✓</Text> : null}
            </View>
            <Text style={estilos.termosTexto}>
              Li e aceito os{' '}
              <Text
                style={estilos.link}
                onPress={() => void Linking.openURL(`${WEB_URL}/termos-de-uso`)}
              >
                Termos de Uso
              </Text>{' '}
              e a{' '}
              <Text
                style={estilos.link}
                onPress={() => void Linking.openURL(`${WEB_URL}/politica-de-privacidade`)}
              >
                Política de Privacidade
              </Text>
              .
            </Text>
          </Pressable>

          {erro !== null ? (
            <Text style={estilos.erro} accessibilityRole="alert">
              {erro}
            </Text>
          ) : null}

          <Botao onPress={() => void enviar()} carregando={enviando} largura>
            {enviando ? 'Criando...' : 'Criar conta'}
          </Botao>
          <Botao variante="fantasma" onPress={() => router.back()} largura>
            Já tenho conta
          </Botao>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.xl, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.display, fontWeight: peso.pesado, color: cores.texto },
  secao: {
    marginTop: espaco.sm,
    fontSize: fonte.corpo,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  linha: { flexDirection: 'row', gap: espaco.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
  botaoCupom: { paddingTop: 26 },
  ok: { fontSize: fonte.pequeno, color: cores.sucesso },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  termos: { flexDirection: 'row', gap: espaco.md, alignItems: 'center' },
  caixa: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  caixaMarcada: { backgroundColor: cores.acento, borderColor: cores.acento },
  marca: { color: cores.textoSobreAcento, fontWeight: peso.pesado },
  termosTexto: { flex: 1, fontSize: fonte.pequeno, color: cores.textoFraco },
  link: { color: cores.acento, fontWeight: peso.forte },
})
