import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ComandosWhatsApp from '@/components/ComandosWhatsApp'
import { COMANDOS_PRODUTOS } from '@/lib/comandos'
import Cabecalho from '@/components/Cabecalho'
import {
  buscarEan,
  carregarResumoDoCatalogo,
  confirmarImportacaoProdutos,
  listarCatalogo,
  nivelEstoque,
  type FiltroDeEstoque,
  type ProdutoDoCatalogo,
} from '@/lib/produtos-api'
import { formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import LeitorCodigo from '@/components/LeitorCodigo'
import ImportarCsvModal from '@/components/ImportarCsvModal'
import { CAMPOS_PRODUTOS, validarProduto } from '@/lib/campos-de-importacao'
import BotoesExportar from '@/components/BotoesExportar'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** Espera a pessoa parar de digitar antes de ir ao servidor. */
const ESPERA_DA_BUSCA_MS = 400

/* Inativos e filtro a parte (NR-151): por padrao a lista so mostra o que esta
   a venda. */
type FiltroDoCatalogo = FiltroDeEstoque | 'inativos'

const FILTROS: { valor: FiltroDoCatalogo; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'baixo', rotulo: 'Estoque baixo' },
  { valor: 'esgotado', rotulo: 'Esgotados' },
  { valor: 'inativos', rotulo: 'Inativos' },
]

export default function Catalogo() {
  const [busca, setBusca] = useState('')
  /* `?estoque=`: o sino (NR-162) abre o catalogo ja em esgotados ou baixo. */
  const { estoque: estoqueDaRota } = useLocalSearchParams<{ estoque?: FiltroDoCatalogo }>()
  const [estoque, setEstoque] = useState<FiltroDoCatalogo>(estoqueDaRota ?? 'todos')
  useEffect(() => {
    if (estoqueDaRota !== undefined) setEstoque(estoqueDaRota)
  }, [estoqueDaRota])
  const [lendo, setLendo] = useState(false)
  const router = useRouter()
  const [consultando, setConsultando] = useState(false)
  const [avisoLeitura, setAvisoLeitura] = useState<{
    tom: 'novo' | 'erro'
    texto: string
    ean?: string
  } | null>(null)
  const [lista, setLista] = useState<ProdutoDoCatalogo[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [importando, setImportando] = useState(false)
  const [resumo, setResumo] = useState<Awaited<ReturnType<typeof carregarResumoDoCatalogo>>>(null)

  /* Voltar da ficha ou do cadastro recarrega: preco e saldo podem ter mudado. */
  useFocusEffect(
    useCallback(() => {
      setTentativa((n) => n + 1)
      void (async () => {
        setResumo(await carregarResumoDoCatalogo())
      })()
    }, []),
  )

  /* Busca e filtro no SERVIDOR: o catalogo da loja pode ter centenas de itens. */
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const r = await listarCatalogo({
        termo: busca.trim(),
        ...(estoque === 'inativos' ? { situacao: 'inativos' as const } : { estoque }),
      })
      if (cancelado) return
      setCarregando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      setErro(null)
      setLista(r.dados.produtos)
      setTotal(r.dados.total)
    }
    const t = setTimeout(() => void carregar(), ESPERA_DA_BUSCA_MS)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [busca, estoque, tentativa])

  /**
   * O que fazer com o codigo lido — RF-018.
   *
   * A consulta vai a api, e nao ao catalogo em memoria: o balcao precisa saber
   * se o produto existe NA LOJA, e a lista carregada na tela pode estar
   * desatualizada em relacao ao que outro operador acabou de cadastrar.
   *
   * Fecha o leitor ANTES de consultar. A camera continuar aberta enquanto a
   * rede responde faz o leitor bipar de novo no mesmo codigo, e a tela recebe
   * duas leituras.
   */
  async function aoLerCodigo(codigo: string) {
    setLendo(false)
    setConsultando(true)
    setAvisoLeitura(null)

    const r = await buscarEan(codigo)
    setConsultando(false)

    if (r.situacao === 'cadastrado') {
      /* Abre a ficha do produto bipado: e la que se confere preco e saldo. */
      router.push({ pathname: '/produto', params: { id: r.produto.id } })
      return
    }

    if (r.situacao === 'novo') {
      /* Nao e erro: e o caminho de cadastrar. A tela oferece a acao em vez de
         so dizer que nao achou. */
      setAvisoLeitura({
        tom: 'novo',
        texto: `Código ${r.ean} ainda não está cadastrado.`,
        ean: r.ean,
      })
      return
    }

    setAvisoLeitura({ tom: 'erro', texto: r.mensagem })
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Catálogo"
        subtitulo={carregando ? 'Carregando...' : `${total} produtos`}
        acao={
          <View style={estilos.acoesTopo}>
            <Botao variante="secundario" onPress={() => setImportando(true)}>
              Importar
            </Botao>
            <Botao onPress={() => router.push('/produto-novo')}>Novo</Botao>
          </View>
        }
      />

      {resumo !== null ? (
        <View style={estilos.resumo}>
          <Text style={estilos.resumoTexto}>
            {resumo.abaixoDoMinimo} abaixo do mínimo · {resumo.esgotados} esgotado(s) ·{' '}
            {formatMoney(resumo.valorEmEstoque)} em estoque
          </Text>
        </View>
      ) : null}

      <View style={estilos.barra}>
        <TextInput
          style={estilos.busca}
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar produto"
          placeholderTextColor={cores.textoFraco}
          accessibilityLabel="Buscar produto"
        />
        <Botao onPress={() => setLendo(true)}>{consultando ? '...' : 'Bipar'}</Botao>
      </View>
      <View style={estilos.exportarLinha}>
        {/* Exportar — NR-155, com a busca e o filtro aplicados. */}
        <BotoesExportar
          lista="produtos"
          filtros={
            estoque === 'inativos'
              ? { q: busca.trim(), situacao: 'inativos' }
              : { q: busca.trim(), stock: estoque }
          }
        />
      </View>

      <View style={estilos.filtros}>
        {FILTROS.map((f) => (
          <Pressable
            key={f.valor}
            onPress={() => setEstoque(f.valor)}
            style={[estilos.chip, estoque === f.valor && estilos.chipAtivo]}
          >
            <Text style={[estilos.chipTexto, estoque === f.valor && estilos.chipTextoAtivo]}>
              {f.rotulo}
            </Text>
          </Pressable>
        ))}
      </View>

      {avisoLeitura !== null ? (
        <View style={avisoLeitura.tom === 'novo' ? estilos.avisoNovo : estilos.avisoErro}>
          <Text style={estilos.avisoTexto}>{avisoLeitura.texto}</Text>
          {avisoLeitura.ean !== undefined ? (
            <Botao
              onPress={() =>
                router.push({ pathname: '/produto-novo', params: { ean: avisoLeitura.ean } })
              }
            >
              Cadastrar
            </Botao>
          ) : null}
        </View>
      ) : null}

      {erro ? (
        <Vazio
          titulo="Não deu para carregar"
          descricao={erro}
          acao={
            <Botao variante="secundario" onPress={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </Botao>
          }
        />
      ) : carregando && lista.length === 0 ? (
        <ActivityIndicator style={estilos.carregando} color={cores.acento} />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(p) => p.id}
          contentContainerStyle={estilos.lista}
          /* Via WhatsApp, como no web — NR-165. */
          ListFooterComponent={<ComandosWhatsApp comandos={COMANDOS_PRODUTOS} />}
          renderItem={({ item }) => (
            <LinhaProduto
              produto={item}
              onAbrir={() => router.push({ pathname: '/produto', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <Vazio
              titulo="Produto não encontrado"
              descricao="Nenhum item com esse termo, código ou filtro."
              acao={
                <Botao
                  variante="secundario"
                  onPress={() => {
                    setBusca('')
                    setEstoque('todos')
                  }}
                >
                  Limpar
                </Botao>
              }
            />
          }
        />
      )}

      <LeitorCodigo
        aberto={lendo}
        onLer={(codigo) => void aoLerCodigo(codigo)}
        onFechar={() => setLendo(false)}
      />

      {importando ? (
        <ImportarCsvModal
          titulo="Importar produtos"
          campos={CAMPOS_PRODUTOS}
          validar={validarProduto}
          onConfirmar={confirmarImportacaoProdutos}
          onFechar={() => {
            setImportando(false)
            setTentativa((n) => n + 1)
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

function LinhaProduto({ produto, onAbrir }: { produto: ProdutoDoCatalogo; onAbrir: () => void }) {
  const nivel = nivelEstoque(produto)

  return (
    <Pressable style={estilos.produto} onPress={onAbrir} accessibilityRole="button">
      <View style={estilos.produtoInfo}>
        <Text style={estilos.produtoCodigo}>{produto.codigo}</Text>
        <Text style={estilos.produtoNome} numberOfLines={2}>
          {produto.descricao}
        </Text>
        {produto.categoria ? (
          <Text style={estilos.produtoCategoria}>{produto.categoria}</Text>
        ) : null}
      </View>

      <View style={estilos.produtoNumeros}>
        <Text style={estilos.produtoPreco}>{formatMoney(produto.precoVenda)}</Text>
        {!produto.ativo ? (
          <Etiqueta tom="neutro">Inativo</Etiqueta>
        ) : nivel === 'esgotado' ? (
          <Etiqueta tom="erro">Esgotado</Etiqueta>
        ) : nivel === 'baixo' ? (
          <Etiqueta tom="atencao">{produto.estoque} un</Etiqueta>
        ) : (
          <Etiqueta tom="sucesso">{produto.estoque} un</Etiqueta>
        )}
      </View>
    </Pressable>
  )
}

const estilos = criarEstilos(() => ({
  /* Leitura de codigo — RF-018. Dois tons porque as acoes sao opostas:
     "nao cadastrado" convida a cadastrar, "erro" convida a tentar de novo. */
  avisoNovo: {
    ...vidro.painel,
    marginHorizontal: espaco.lg,
    marginBottom: espaco.md,
    padding: espaco.md,
    borderRadius: raio.md,
    gap: espaco.sm,
  },
  avisoErro: {
    marginHorizontal: espaco.lg,
    marginBottom: espaco.md,
    padding: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.erroFundo,
    gap: espaco.sm,
  },
  avisoTexto: { color: cores.texto, fontSize: fonte.pequeno },
  resumo: { paddingHorizontal: espaco.lg },
  resumoTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  tela: { flex: 1, backgroundColor: cores.fundo },
  acoesTopo: { flexDirection: 'row', gap: espaco.sm },
  exportarLinha: { paddingHorizontal: espaco.lg, alignItems: 'flex-end' },

  cabecalho: { paddingHorizontal: espaco.lg, paddingTop: espaco.md, gap: 2 },
  titulo: { fontSize: fonte.display, fontWeight: peso.pesado, color: cores.texto },
  subtitulo: { fontSize: fonte.pequeno, color: cores.textoFraco },

  barra: {
    flexDirection: 'row',
    gap: espaco.sm,
    padding: espaco.lg,
    alignItems: 'center',
  },
  busca: {
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

  filtros: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    marginBottom: espaco.sm,
  },
  carregando: { marginTop: espaco.xl },
  chip: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  chipTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  chipTextoAtivo: { color: cores.acento, fontWeight: peso.forte },

  lista: { padding: espaco.lg, gap: espaco.sm },
  produto: {
    ...vidro.peca,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.lg,
    borderRadius: raio.md,
  },
  produtoInfo: { flex: 1, gap: 2 },
  produtoCodigo: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.acento,
  },
  produtoNome: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  produtoCategoria: { fontSize: fonte.micro, color: cores.textoFraco },
  produtoNumeros: { alignItems: 'flex-end', gap: espaco.sm },
  produtoPreco: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.texto },
}))
