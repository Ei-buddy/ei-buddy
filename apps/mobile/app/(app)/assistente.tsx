import { useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  CONTEXTO_VAZIO,
  enviarMensagem,
  registrarUso,
  type BlocoResposta,
  type Contexto,
  type Mensagem,
} from '@/lib/assistente-api'
import { COMANDOS_DESTAQUE } from '@/lib/comandos'
import Cabecalho from '@/components/Cabecalho'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

const HOJE = '2026-08-24'

/**
 * Assistente.
 *
 * Mesma conversa do WhatsApp, dentro do app. A rolagem fica dentro da
 * caixa de mensagens — o mesmo cuidado que o web precisou, pelo mesmo
 * motivo: sem isso, cada mensagem empurra o campo de digitacao para
 * fora da tela.
 */
export default function Assistente() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [contexto, setContexto] = useState<Contexto>(CONTEXTO_VAZIO)
  const [entrada, setEntrada] = useState('')
  const [pensando, setPensando] = useState(false)

  const rolagem = useRef<ScrollView>(null)
  const proximoId = useRef(0)

  async function perguntar(texto: string) {
    const limpo = texto.trim()
    if (!limpo || pensando) return

    setMensagens((atual) => [
      ...atual,
      {
        id: `m-${++proximoId.current}`,
        autor: 'usuario',
        canal: 'app',
        texto: limpo,
        data: HOJE,
      },
    ])
    setEntrada('')
    setPensando(true)

    /* SUBSTITUIR POR: POST /assistente/mensagens — o contexto vai junto
       para o servidor resolver pronome ("o que ele comprou"). */
    const r = await enviarMensagem(limpo, contexto)
    registrarUso(r.intencao, limpo)

    setContexto(r.contexto)
    setMensagens((atual) => [
      ...atual,
      {
        id: `m-${++proximoId.current}`,
        autor: 'assistente',
        canal: 'app',
        texto: r.texto,
        blocos: r.blocos,
        data: HOJE,
      },
    ])
    setPensando(false)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Assistente" subtitulo="Pergunte em texto" />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          ref={rolagem}
          style={estilos.conversa}
          contentContainerStyle={estilos.conversaConteudo}
          onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: true })}
        >
          {mensagens.length === 0 ? (
            <View style={estilos.boasVindas}>
              <Text style={estilos.boasVindasTitulo}>Como posso ajudar?</Text>
              <Text style={estilos.boasVindasTexto}>
                Pergunte sobre vendas, clientes, produtos ou contas. Se citar um cliente, eu guardo
                o assunto — da para perguntar &ldquo;o que ele comprou&rdquo; logo depois.
              </Text>
            </View>
          ) : (
            mensagens.map((m) => (
              <View
                key={m.id}
                style={[
                  estilos.balaoWrap,
                  m.autor === 'usuario' ? estilos.daPessoa : estilos.doAssistente,
                ]}
              >
                <View
                  style={[
                    estilos.balao,
                    m.autor === 'usuario' ? estilos.balaoPessoa : estilos.balaoAssistente,
                  ]}
                >
                  <Text
                    style={[estilos.balaoTexto, m.autor === 'usuario' && estilos.balaoTextoPessoa]}
                  >
                    {m.texto}
                  </Text>

                  {m.blocos?.map((b, i) => (
                    <Bloco key={i} bloco={b} />
                  ))}
                </View>
              </View>
            ))
          )}

          {pensando ? (
            <View style={[estilos.balaoWrap, estilos.doAssistente]}>
              <View style={[estilos.balao, estilos.balaoAssistente]}>
                <Text style={estilos.digitando}>digitando...</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Sugestoes em faixa horizontal: nao roubam altura da conversa. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={estilos.sugestoes}
          contentContainerStyle={estilos.sugestoesConteudo}
        >
          {COMANDOS_DESTAQUE.map((c) => (
            <Pressable key={c} onPress={() => perguntar(c)} style={estilos.chip}>
              <Text style={estilos.chipTexto}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={estilos.entrada}>
          <TextInput
            style={estilos.entradaCampo}
            value={entrada}
            onChangeText={setEntrada}
            placeholder="Pergunte alguma coisa..."
            placeholderTextColor={cores.textoFraco}
            multiline
            accessibilityLabel="Mensagem"
          />
          <Pressable
            onPress={() => perguntar(entrada)}
            disabled={!entrada.trim() || pensando}
            style={[estilos.enviar, (!entrada.trim() || pensando) && estilos.enviarInativo]}
            accessibilityRole="button"
            accessibilityLabel="Enviar"
          >
            <Text style={estilos.enviarTexto}>→</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** Resposta rica: tabela, lista ou indicador dentro da conversa. */
function Bloco({ bloco }: { bloco: BlocoResposta }) {
  if (bloco.tipo === 'texto') {
    return <Text style={estilos.blocoTexto}>{bloco.texto}</Text>
  }

  if (bloco.tipo === 'indicador') {
    return (
      <View style={estilos.indicador}>
        <Text style={estilos.indicadorRotulo}>{bloco.rotulo}</Text>
        <Text style={estilos.indicadorValor}>{bloco.valor}</Text>
        {bloco.apoio ? <Text style={estilos.indicadorApoio}>{bloco.apoio}</Text> : null}
      </View>
    )
  }

  if (bloco.tipo === 'lista') {
    if (bloco.itens.length === 0) return null
    return (
      <View style={estilos.blocoCard}>
        <Text style={estilos.blocoTitulo}>{bloco.titulo}</Text>
        {bloco.itens.map((i) => (
          <View key={i.rotulo} style={estilos.blocoLinha}>
            <Text style={estilos.blocoRotulo} numberOfLines={1}>
              {i.rotulo}
            </Text>
            <Text style={[estilos.blocoValor, i.destaque && estilos.blocoDestaque]}>{i.valor}</Text>
          </View>
        ))}
      </View>
    )
  }

  if (bloco.tipo === 'tabela') {
    return (
      <View style={estilos.blocoCard}>
        <Text style={estilos.blocoTitulo}>{bloco.titulo}</Text>
        {bloco.linhas.map((linha, i) => (
          <View key={i} style={estilos.blocoLinha}>
            <Text style={estilos.blocoRotulo} numberOfLines={1}>
              {linha[0]}
            </Text>
            <Text style={estilos.blocoValor}>{linha[linha.length - 1]}</Text>
          </View>
        ))}
      </View>
    )
  }

  /* confirmacao — acao so acontece com aceite explicito */
  return (
    <View style={estilos.confirmacao}>
      <Text style={estilos.confirmacaoTexto}>{bloco.pergunta}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  flex: { flex: 1 },

  conversa: { flex: 1 },
  conversaConteudo: { padding: espaco.lg, gap: espaco.md },

  boasVindas: { paddingVertical: espaco.xxl, gap: espaco.sm, alignItems: 'center' },
  boasVindasTitulo: {
    fontSize: fonte.titulo,
    fontWeight: peso.pesado,
    color: cores.texto,
  },
  boasVindasTexto: {
    fontSize: fonte.pequeno,
    color: cores.textoFraco,
    textAlign: 'center',
    lineHeight: 21,
  },

  balaoWrap: { flexDirection: 'row' },
  daPessoa: { justifyContent: 'flex-end' },
  doAssistente: { justifyContent: 'flex-start' },
  balao: { maxWidth: '86%', padding: espaco.md, gap: espaco.sm },
  balaoPessoa: {
    ...vidro.ativo,
    borderRadius: raio.md,
    borderBottomRightRadius: 4,
  },
  balaoAssistente: {
    ...vidro.peca,
    borderRadius: raio.md,
    borderBottomLeftRadius: 4,
  },
  balaoTexto: { fontSize: fonte.pequeno, lineHeight: 21, color: cores.texto },
  balaoTextoPessoa: { color: cores.textoSobreAtivo },
  digitando: { fontSize: fonte.pequeno, color: cores.textoFraco },

  blocoTexto: { fontSize: fonte.micro, color: cores.textoFraco, lineHeight: 19 },
  blocoCard: {
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    gap: espaco.xs,
  },
  blocoTitulo: {
    fontSize: 11,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: espaco.xs,
  },
  blocoLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaco.md,
  },
  blocoRotulo: { flex: 1, fontSize: fonte.micro, color: cores.texto },
  blocoValor: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
  blocoDestaque: { color: cores.atencao },

  indicador: {
    padding: espaco.md,
    borderRadius: raio.sm,
    backgroundColor: cores.sucessoFundo,
    gap: 1,
  },
  indicadorRotulo: { fontSize: fonte.micro, color: cores.acento },
  indicadorValor: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.acento },
  indicadorApoio: { fontSize: 11, color: cores.textoFraco },

  confirmacao: {
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.atencao,
    borderRadius: raio.sm,
    backgroundColor: cores.atencaoFundo,
  },
  confirmacaoTexto: { fontSize: fonte.micro, color: cores.texto, lineHeight: 19 },

  sugestoes: { flexGrow: 0, maxHeight: 56 },
  sugestoesConteudo: {
    paddingHorizontal: espaco.lg,
    gap: espaco.sm,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipTexto: { fontSize: fonte.micro, color: cores.textoFraco },

  entrada: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: espaco.sm,
    padding: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  entradaCampo: {
    flex: 1,
    maxHeight: 110,
    minHeight: 46,
    paddingHorizontal: espaco.lg,
    paddingTop: espaco.md,
    paddingBottom: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
    color: cores.texto,
    fontSize: fonte.corpo,
  },
  enviar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    ...vidro.ativo,
  },
  enviarInativo: { opacity: 0.4 },
  enviarTexto: { fontSize: 20, color: cores.textoSobreAtivo, fontWeight: peso.pesado },
})
