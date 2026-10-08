import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { buscarTudo, MINIMO_DA_BUSCA, type ResultadoDaBusca } from '@/lib/busca-api'
import { ACAO_TUTORIAL, GRUPOS } from '@/lib/navegacao'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** Tira acento e caixa: "orcamento" acha "Orçamentos". */
const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const ROTULO_DO_TIPO = { produto: 'Produtos', cliente: 'Clientes', venda: 'Vendas' } as const

/**
 * A busca global do app — NR-162, a mesma do web (NR-126): acha TELA, produto,
 * cliente e venda numa caixa so. As telas vem da mesma lista do menu.
 */
export default function BuscaGlobal({
  aberta,
  onFechar,
}: {
  aberta: boolean
  onFechar: () => void
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [termo, setTermo] = useState('')
  const [registros, setRegistros] = useState<ResultadoDaBusca[]>([])
  const [buscando, setBuscando] = useState(false)

  const curto = termo.trim().length < MINIMO_DA_BUSCA

  useEffect(() => {
    if (curto) return
    let cancelado = false
    const t = setTimeout(() => {
      setBuscando(true)
      void buscarTudo(termo).then((r) => {
        if (cancelado) return
        setRegistros(r)
        setBuscando(false)
      })
    }, 250)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [termo, curto])

  const telas = useMemo(() => {
    const q = normal(termo.trim())
    if (q === '') return []
    return GRUPOS.flatMap((g) =>
      g.itens
        .filter((i) => i.rota !== ACAO_TUTORIAL)
        .filter((i) => normal(i.rotulo).includes(q) || normal(g.grupo).includes(q))
        .map((i) => ({ ...i, grupo: g.grupo })),
    ).slice(0, 6)
  }, [termo])

  function fechar() {
    setTermo('')
    setRegistros([])
    onFechar()
  }

  function ir(destino: Parameters<typeof router.push>[0]) {
    fechar()
    router.push(destino)
  }

  const grupos = curto
    ? []
    : (['produto', 'cliente', 'venda'] as const)
        .map((tipo) => ({ tipo, itens: registros.filter((r) => r.tipo === tipo) }))
        .filter((g) => g.itens.length > 0)

  return (
    <Modal visible={aberta} transparent animationType="fade" onRequestClose={fechar}>
      <View style={[estilos.fundo, { paddingTop: insets.top + espaco.md }]}>
        <View style={estilos.painel}>
          <View style={estilos.linhaBusca}>
            <TextInput
              style={estilos.campo}
              value={termo}
              onChangeText={setTermo}
              placeholder="Buscar tela, cliente, produto ou venda"
              placeholderTextColor={cores.textoFraco}
              autoFocus
              autoCorrect={false}
              accessibilityLabel="Buscar tela, cliente, produto ou venda"
            />
            <Pressable onPress={fechar} accessibilityRole="button" hitSlop={10}>
              <Text style={estilos.fechar}>Fechar</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={estilos.resultados}>
            {telas.length > 0 ? (
              <View style={estilos.grupo}>
                <Text style={estilos.grupoTitulo}>Telas</Text>
                {telas.map((t) => (
                  <Pressable
                    key={t.rota}
                    onPress={() => ir(t.rota as Parameters<typeof router.push>[0])}
                    style={estilos.item}
                    accessibilityRole="link"
                  >
                    <Text style={estilos.itemTitulo}>{t.rotulo}</Text>
                    <Text style={estilos.itemApoio}>{t.grupo}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {grupos.map((g) => (
              <View key={g.tipo} style={estilos.grupo}>
                <Text style={estilos.grupoTitulo}>{ROTULO_DO_TIPO[g.tipo]}</Text>
                {g.itens.map((r) => (
                  <Pressable
                    key={`${r.tipo}:${r.id}`}
                    onPress={() => ir(r.rota as Parameters<typeof router.push>[0])}
                    style={estilos.item}
                    accessibilityRole="link"
                  >
                    <Text style={estilos.itemTitulo} numberOfLines={1}>
                      {r.titulo}
                    </Text>
                    <Text style={estilos.itemApoio} numberOfLines={1}>
                      {r.apoio}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}

            {termo.trim() === '' ? (
              <Text style={estilos.aviso}>
                Digite o nome de uma tela, cliente, produto ou venda.
              </Text>
            ) : curto && telas.length === 0 ? (
              <Text style={estilos.aviso}>Continue digitando...</Text>
            ) : !curto && !buscando && telas.length === 0 && grupos.length === 0 ? (
              <Text style={estilos.aviso}>Nada encontrado para “{termo.trim()}”.</Text>
            ) : buscando && grupos.length === 0 ? (
              <Text style={estilos.aviso}>Buscando...</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  fundo: {
    flex: 1,
    paddingHorizontal: espaco.md,
    backgroundColor: cores.veu,
  },
  painel: {
    ...vidro.painel,
    maxHeight: '85%',
    borderRadius: raio.lg,
    padding: espaco.md,
    gap: espaco.sm,
  },
  linhaBusca: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  campo: {
    ...vidro.campo,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: espaco.md,
    borderRadius: raio.sm,
    fontSize: fonte.corpo,
    color: cores.texto,
  },
  fechar: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  resultados: { flexGrow: 0 },
  grupo: { gap: 2, marginTop: espaco.sm },
  grupoTitulo: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingVertical: espaco.xs,
  },
  item: {
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.sm,
    borderRadius: raio.sm,
    minHeight: 44,
  },
  itemTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  itemApoio: { fontSize: fonte.micro, color: cores.textoFraco },
  aviso: { fontSize: fonte.pequeno, color: cores.textoFraco, paddingVertical: espaco.md },
}))
