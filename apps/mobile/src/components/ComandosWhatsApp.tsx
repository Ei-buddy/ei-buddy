import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { Cartao } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * O bloco "Via WhatsApp" das telas — NR-165, o mesmo do web: as perguntas que
 * funcionam por mensagem, sem abrir o sistema. Tocar abre o assistente com a
 * pergunta ja escrita, como no web.
 */
export default function ComandosWhatsApp({
  comandos,
  descricao = 'Estas perguntas funcionam por mensagem, sem abrir o sistema. Toque para abrir no assistente.',
}: {
  comandos: readonly string[]
  descricao?: string
}) {
  const router = useRouter()

  return (
    <Cartao titulo="Via WhatsApp">
      <Text style={estilos.descricao}>{descricao}</Text>
      <View style={estilos.chips}>
        {comandos.map((c) => (
          <Pressable
            key={c}
            onPress={() => router.push({ pathname: '/assistente', params: { pergunta: c } })}
            style={({ pressed }) => [estilos.chip, pressed && estilos.chipPressionado]}
            accessibilityRole="link"
            accessibilityLabel={`Perguntar ao assistente: ${c}`}
          >
            <Text style={estilos.chipTexto}>“{c}”</Text>
          </Pressable>
        ))}
      </View>
    </Cartao>
  )
}

const estilos = criarEstilos(() => ({
  descricao: { fontSize: fonte.pequeno, color: cores.textoFraco, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  chip: {
    ...vidro.peca,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    minHeight: 40,
    /* Frase longa quebra dentro da peca, em vez de vazar do cartao (NR-176). */
    maxWidth: '100%',
    justifyContent: 'center',
  },
  chipPressionado: { opacity: 0.85 },
  chipTexto: { flexShrink: 1, fontSize: fonte.micro, fontWeight: peso.medio, color: cores.texto },
}))
