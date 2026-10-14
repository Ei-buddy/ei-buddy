import { useRouter } from 'expo-router'
import { Modal, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Aviso } from '@/lib/avisos-api'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * O painel do sino — NR-162, o mesmo do web: cada aviso leva a tela que
 * resolve o assunto, ja filtrada.
 */
export default function Avisos({
  avisos,
  aberto,
  onFechar,
}: {
  avisos: readonly Aviso[] | null
  aberto: boolean
  onFechar: () => void
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={aberto} transparent animationType="fade" onRequestClose={onFechar}>
      <Pressable
        style={[estilos.fundo, { paddingTop: insets.top + espaco.xxl }]}
        onPress={onFechar}
        accessibilityLabel="Fechar notificações"
      >
        <View style={estilos.painel} accessibilityRole="none">
          <Text style={estilos.titulo}>Notificações</Text>
          {avisos === null ? (
            <Text style={estilos.vazio}>Carregando...</Text>
          ) : avisos.length === 0 ? (
            <Text style={estilos.vazio}>Tudo em dia. Nenhum aviso agora.</Text>
          ) : (
            avisos.map((a) => (
              <Pressable
                key={`${a.rota.pathname}${JSON.stringify(a.rota.params ?? {})}`}
                onPress={() => {
                  onFechar()
                  router.push(a.rota as Parameters<typeof router.push>[0])
                }}
                style={estilos.aviso}
                accessibilityRole="link"
              >
                <View style={[estilos.ponto, a.tom === 'perigo' && estilos.pontoPerigo]} />
                <Text style={estilos.avisoTexto}>{a.texto}</Text>
                <Text style={estilos.seta}>›</Text>
              </Pressable>
            ))
          )}
        </View>
      </Pressable>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  fundo: {
    flex: 1,
    alignItems: 'flex-end',
    paddingHorizontal: espaco.md,
    backgroundColor: cores.veu,
  },
  painel: {
    ...vidro.painel,
    width: '100%',
    maxWidth: 380,
    borderRadius: raio.lg,
    padding: espaco.lg,
    gap: espaco.sm,
  },
  titulo: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.texto },
  vazio: { fontSize: fonte.pequeno, color: cores.textoFraco, paddingVertical: espaco.sm },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    minHeight: 48,
    paddingHorizontal: espaco.sm,
    borderRadius: raio.sm,
  },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: cores.atencao },
  pontoPerigo: { backgroundColor: cores.erro },
  avisoTexto: { flex: 1, fontSize: fonte.pequeno, color: cores.texto },
  seta: { fontSize: fonte.medio, color: cores.textoFraco },
}))
