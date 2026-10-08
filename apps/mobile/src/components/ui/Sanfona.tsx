import { useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** Duracao das transicoes, em ms. Curta: a sanfona e tocada o tempo todo. */
const DURACAO = 180

/**
 * Secao retratil.
 *
 * O painel web mostra tudo de uma vez porque tem tela larga. No celular
 * isso vira rolagem infinita: a sanfona deixa a pessoa abrir so a parte
 * que interessa e manter o resto fora do caminho.
 *
 * O resumo no cabecalho (`resumo`) existe para nao ser preciso abrir a
 * secao so para saber se ha algo relevante dentro dela.
 *
 * A animacao usa Reanimated, nao `LayoutAnimation`: esta ultima e no-op na
 * New Architecture, que o RN 0.86 liga por padrao. O Reanimated ainda roda
 * a transicao na thread de UI, entao a sanfona continua fluida enquanto a
 * thread de JS esta ocupada — que e o caso no balcao, com o carrinho sendo
 * recalculado a cada bipe.
 */
export default function Sanfona({
  titulo,
  resumo,
  etiqueta,
  inicialAberta = false,
  onAbrir,
  children,
}: {
  titulo: string
  /** Numero ou valor mostrado fechado — evita abrir so para conferir. */
  resumo?: string
  etiqueta?: ReactNode
  inicialAberta?: boolean
  /**
   * Disparado quando a secao ABRE por toque — nunca ao fechar, nunca na
   * montagem.
   *
   * Serve para carregar o conteudo so quando ele vai aparecer: no suporte, e a
   * abertura que busca a conversa do chamado e a marca como lida. Chamar isto
   * na montagem por causa de `inicialAberta` marcaria como lido um chamado que
   * ninguem abriu, e nao ha como desmarcar.
   *
   * Nao e "onToggle" de proposito: quem precisa saber do fechamento nao existe
   * ainda, e uma API que avisa dos dois convida a tratar fechar como recarregar.
   */
  onAbrir?: () => void
  children: ReactNode
}) {
  const [aberta, setAberta] = useState(inicialAberta)

  /* A rotacao acompanha o estado em vez de trocar de estilo de uma vez. */
  const estiloSeta = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(aberta ? '180deg' : '0deg', { duration: DURACAO }) }],
  }))

  return (
    /* `layout` anima a mudanca de altura do bloco quando o conteudo entra
       ou sai — e, como toda sanfona tem esta prop, as vizinhas deslizam
       junto em vez de saltarem para a nova posicao. */
    <Animated.View style={estilos.bloco} layout={LinearTransition.duration(DURACAO)}>
      <Pressable
        onPress={() => {
          /* O `onAbrir` sai daqui, do toque, e nao de um efeito sobre `aberta`:
             num efeito ele tambem dispararia na montagem quando
             `inicialAberta` fosse verdadeiro. */
          if (!aberta) onAbrir?.()
          setAberta((v) => !v)
        }}
        style={estilos.cabecalho}
        accessibilityRole="button"
        accessibilityState={{ expanded: aberta }}
        accessibilityLabel={titulo}
      >
        <View style={estilos.cabecalhoTexto}>
          <Text style={estilos.titulo}>{titulo}</Text>
          {resumo && !aberta ? <Text style={estilos.resumo}>{resumo}</Text> : null}
        </View>

        {etiqueta}

        {/* Seta em texto: sem dependencia de icone, e a rotacao e clara. */}
        <Animated.Text style={[estilos.seta, aberta && estilos.setaAberta, estiloSeta]}>
          ⌄
        </Animated.Text>
      </Pressable>

      {aberta ? (
        <Animated.View
          style={estilos.conteudo}
          entering={FadeIn.duration(DURACAO)}
          exiting={FadeOut.duration(DURACAO / 2)}
        >
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  )
}

const estilos = criarEstilos(() => ({
  bloco: {
    ...vidro.peca,
    borderRadius: raio.md,
    /* Segura o conteudo dentro do bloco enquanto a altura anima. */
    overflow: 'hidden',
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.lg,
    /* Alvo de toque confortavel — a sanfona e tocada o tempo todo. */
    minHeight: 56,
  },
  cabecalhoTexto: { flex: 1, gap: 2 },
  titulo: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  resumo: { fontSize: fonte.micro, color: cores.textoFraco },
  seta: { fontSize: 18, color: cores.textoFraco },
  /* So a cor: a rotacao vem do estilo animado, e dois `transform` na mesma
     pilha de estilos brigariam entre si. */
  setaAberta: { color: cores.acento },
  conteudo: {
    padding: espaco.lg,
    paddingTop: 0,
    gap: espaco.md,
  },
}))
