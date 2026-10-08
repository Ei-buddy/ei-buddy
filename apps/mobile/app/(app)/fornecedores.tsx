import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  buscarFornecedores,
  buscarSugestoes,
  formatarDistancia,
  pedirConexao,
  type Fornecedor,
  type SugestaoDeFornecedor,
} from '@/lib/conexoes-api'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Buscar fornecedores por proximidade — ADR-0008, DEC-021, a mesma tela do web.
 *
 * Precisa de um insumo? Ve quem vende perto e pede conexao. O contato so
 * aparece depois que o outro lado aceita.
 */
export default function Fornecedores() {
  const router = useRouter()
  const [termo, setTermo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Fornecedor[]>([])
  const [sugestoes, setSugestoes] = useState<SugestaoDeFornecedor[]>([])
  /* Pedir pela sugestao ou pela busca e a MESMA acao: a mesma empresa nos dois
     lugares mostra o mesmo estado. */
  const [pedidos, setPedidos] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await buscarSugestoes()
      if (!cancelado && r.ok) setSugestoes(r.dados.suggestions)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function buscar() {
    if (termo.trim().length < 2) return
    setBuscando(true)
    setErro(null)
    const r = await buscarFornecedores(termo.trim())
    setBuscando(false)
    setBuscou(true)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setResultados(r.dados.results)
  }

  async function pedir(companyId: string) {
    setPedidos((p) => ({ ...p, [companyId]: 'enviando' }))
    const r = await pedirConexao(companyId)
    setPedidos((p) => ({ ...p, [companyId]: r.ok ? 'enviado' : r.erro }))
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Fornecedores"
        subtitulo="Quem vende perto de você"
        acao={
          <Botao variante="secundario" onPress={() => router.push('/conexoes')}>
            Conexões
          </Botao>
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <View style={estilos.busca}>
          <TextInput
            style={estilos.campo}
            value={termo}
            onChangeText={setTermo}
            onSubmitEditing={() => void buscar()}
            returnKeyType="search"
            placeholder="O que você precisa? Ex.: farinha"
            placeholderTextColor={cores.textoFraco}
            accessibilityLabel="O que você precisa?"
          />
          <Botao
            onPress={() => void buscar()}
            carregando={buscando}
            desabilitado={termo.trim().length < 2}
          >
            Buscar
          </Botao>
        </View>

        {erro !== null ? <Vazio titulo="Não deu para buscar" descricao={erro} /> : null}

        {buscou && erro === null ? (
          resultados.length === 0 ? (
            <Vazio
              titulo="Nenhum fornecedor encontrado"
              descricao="Ninguém cadastrado por aqui vende isso ainda. Tente outro termo."
            />
          ) : (
            <Cartao titulo="Resultados">
              {resultados.map((f) => (
                <Linha
                  key={f.companyId}
                  nome={f.companyName}
                  local={[f.neighborhood, f.city].filter(Boolean).join(', ')}
                  distancia={formatarDistancia(f.distanceKm)}
                  detalhe={f.products.join(', ')}
                  estado={pedidos[f.companyId]}
                  onPedir={() => void pedir(f.companyId)}
                />
              ))}
            </Cartao>
          )
        ) : null}

        {sugestoes.length > 0 ? (
          <Cartao titulo="Sugestões para você">
            {sugestoes.map((s) => (
              <Linha
                key={s.companyId}
                nome={s.companyName}
                local={[s.neighborhood, s.city].filter(Boolean).join(', ')}
                distancia={formatarDistancia(s.distanceKm)}
                detalhe={
                  s.peerCount === 1
                    ? '1 empresa do seu ramo já se conectou'
                    : `${s.peerCount} empresas do seu ramo já se conectaram`
                }
                estado={pedidos[s.companyId]}
                onPedir={() => void pedir(s.companyId)}
              />
            ))}
          </Cartao>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Linha({
  nome,
  local,
  distancia,
  detalhe,
  estado,
  onPedir,
}: {
  nome: string
  local: string
  distancia: string | null
  detalhe: string
  estado: string | undefined
  onPedir: () => void
}) {
  return (
    <View style={estilos.linha}>
      <View style={estilos.flex}>
        <Text style={estilos.nome}>
          {nome}
          {distancia !== null ? <Text style={estilos.apoio}> · {distancia}</Text> : null}
        </Text>
        <Text style={estilos.apoio}>{local || 'Localização não informada'}</Text>
        <Text style={estilos.detalhe} numberOfLines={2}>
          {detalhe}
        </Text>
        {estado !== undefined && estado !== 'enviando' && estado !== 'enviado' ? (
          <Text style={estilos.erro}>{estado}</Text>
        ) : null}
      </View>
      {estado === 'enviado' ? (
        <Text style={estilos.enviado}>Pedido enviado</Text>
      ) : (
        <Botao variante="secundario" onPress={onPedir} carregando={estado === 'enviando'}>
          Conectar
        </Botao>
      )}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1, gap: 2 },
  busca: { flexDirection: 'row', gap: espaco.sm, alignItems: 'center' },
  campo: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
    backgroundColor: cores.campo,
    color: cores.texto,
    fontSize: fonte.corpo,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco, fontWeight: peso.normal },
  detalhe: { fontSize: fonte.micro, color: cores.texto },
  erro: { fontSize: fonte.micro, color: cores.erro },
  enviado: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.acento },
}))
