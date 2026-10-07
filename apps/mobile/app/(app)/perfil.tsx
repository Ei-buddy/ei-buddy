import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import { CelularDoCanal } from '@/components/EmpresaSecoes'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  carregarMinhaConta,
  type MinhaConta,
  trocarEmail,
  trocarNome,
  trocarSenha,
} from '@/lib/minha-conta-api'
import { cores, espaco, fonte } from '@/theme/tokens'

type Mensagem = { tom: 'ok' | 'erro'; texto: string } | null

/**
 * Meu perfil — NR-153, o par da tela do web. Os dados da PESSOA logada, que
 * valem para todas as lojas dela. E-mail e senha pedem a senha atual.
 */
export default function PerfilScreen() {
  const [conta, setConta] = useState<MinhaConta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await carregarMinhaConta()
      if (r.ok) setConta(r.dados)
      else setErro(r.erro)
    })()
  }, [])

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Meu perfil" subtitulo="Vale para todas as suas lojas" />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {erro !== null ? (
          <Vazio titulo="Não deu para carregar" descricao={erro} />
        ) : conta === null ? (
          <Vazio titulo="Carregando" descricao="Buscando os seus dados." />
        ) : (
          <>
            <SeusDados conta={conta} aoSalvar={setConta} />
            <SuaSenha />
            <CelularDoCanal />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Aviso({ mensagem }: { mensagem: Mensagem }) {
  if (mensagem === null) return null
  return (
    <Text
      style={mensagem.tom === 'erro' ? estilos.erro : estilos.ok}
      accessibilityRole={mensagem.tom === 'erro' ? 'alert' : 'text'}
    >
      {mensagem.texto}
    </Text>
  )
}

function SeusDados({ conta, aoSalvar }: { conta: MinhaConta; aoSalvar: (c: MinhaConta) => void }) {
  const [nome, setNome] = useState(conta.name)
  const [email, setEmail] = useState(conta.email ?? '')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<Mensagem>(null)

  const mudouEmail = email.trim().toLowerCase() !== (conta.email ?? '').toLowerCase()

  async function salvar() {
    setMensagem(null)
    if (nome.trim().length < 2) return setMensagem({ tom: 'erro', texto: 'Informe o seu nome.' })
    if (mudouEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return setMensagem({ tom: 'erro', texto: 'Confira o e-mail.' })
    }
    if (mudouEmail && !senha) {
      return setMensagem({
        tom: 'erro',
        texto: 'Para trocar o e-mail, informe a sua senha atual.',
      })
    }

    setSalvando(true)
    let atual = conta
    if (nome.trim() !== conta.name) {
      const r = await trocarNome(nome)
      if (!r.ok) {
        setSalvando(false)
        return setMensagem({ tom: 'erro', texto: r.erro })
      }
      atual = r.dados
    }
    if (mudouEmail) {
      const r = await trocarEmail(email, senha)
      if (!r.ok) {
        setSalvando(false)
        aoSalvar(atual)
        return setMensagem({ tom: 'erro', texto: r.erro })
      }
      atual = r.dados
    }
    setSalvando(false)
    setSenha('')
    aoSalvar(atual)
    setMensagem({
      tom: 'ok',
      texto: mudouEmail
        ? 'Dados salvos. A partir de agora, entre com o e-mail novo.'
        : 'Dados salvos.',
    })
  }

  return (
    <Cartao titulo="Seus dados">
      <View style={estilos.formulario}>
        <Campo rotulo="Nome *" valor={nome} onChange={setNome} autoCap="words" />
        <Campo
          rotulo="E-mail *"
          valor={email}
          onChange={setEmail}
          tipoTeclado="email-address"
          autoCap="none"
          dica="É com ele que você entra."
        />
        {mudouEmail ? (
          <Campo rotulo="Sua senha atual *" valor={senha} onChange={setSenha} senha />
        ) : null}
        <Aviso mensagem={mensagem} />
        <Botao onPress={() => void salvar()} carregando={salvando} largura>
          Salvar dados
        </Botao>
      </View>
    </Cartao>
  )
}

function SuaSenha() {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<Mensagem>(null)

  async function salvar() {
    setMensagem(null)
    if (!atual) return setMensagem({ tom: 'erro', texto: 'Informe a sua senha atual.' })
    if (nova.length < 8) {
      return setMensagem({ tom: 'erro', texto: 'A nova senha precisa de ao menos 8 caracteres.' })
    }
    if (nova !== confirmacao) {
      return setMensagem({ tom: 'erro', texto: 'A confirmação não bate com a nova senha.' })
    }
    setSalvando(true)
    const r = await trocarSenha(atual, nova)
    setSalvando(false)
    if (!r.ok) return setMensagem({ tom: 'erro', texto: r.erro })
    setAtual('')
    setNova('')
    setConfirmacao('')
    setMensagem({ tom: 'ok', texto: 'Senha trocada.' })
  }

  return (
    <Cartao titulo="Senha">
      <View style={estilos.formulario}>
        <Campo rotulo="Senha atual *" valor={atual} onChange={setAtual} senha />
        <Campo rotulo="Nova senha *" valor={nova} onChange={setNova} senha dica="Mínimo 8." />
        <Campo
          rotulo="Confirme a nova senha *"
          valor={confirmacao}
          onChange={setConfirmacao}
          senha
        />
        <Aviso mensagem={mensagem} />
        <Botao onPress={() => void salvar()} carregando={salvando} largura>
          Trocar senha
        </Botao>
      </View>
    </Cartao>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  formulario: { gap: espaco.md },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  ok: { fontSize: fonte.pequeno, color: cores.sucesso },
})
