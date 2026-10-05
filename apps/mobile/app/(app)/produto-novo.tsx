import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import LeitorCodigo from '@/components/LeitorCodigo'
import { buscarProduto, calcularMargem, carregarSugestoes, salvarProduto } from '@/lib/produtos-api'
import { carregarCustosVariaveis } from '@/lib/custos-api'
import { formatMoney, formatPercent } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

const emTexto = (reais: number) => reais.toFixed(2).replace('.', ',')

/**
 * Cadastro e edicao de produto — RF-017, RF-019, os mesmos campos do web.
 *
 * Chega aqui pelo leitor (codigo nao cadastrado, `ean` na rota), pelo
 * catalogo ou pela ficha (`id` na rota = edicao). O basico — descricao e
 * preco — fica no topo; categoria, fornecedor e classificacao fiscal vem
 * abaixo, para quem tem tempo. Produto sem NCM vende normalmente; a nota diz
 * o que falta quando for emitida (RF-046).
 */
export default function ProdutoNovoScreen() {
  const router = useRouter()
  const { ean: eanDaRota, id } = useLocalSearchParams<{ ean?: string; id?: string }>()
  const editando = typeof id === 'string' && id !== ''

  const [descricao, setDescricao] = useState('')
  const [ean, setEan] = useState(eanDaRota ?? '')
  const [precoVenda, setPrecoVenda] = useState('')
  const [precoCusto, setPrecoCusto] = useState('')
  const [estoque, setEstoque] = useState('')
  const [estoqueMinimo, setEstoqueMinimo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [ncm, setNcm] = useState('')
  const [cfop, setCfop] = useState('')
  const [cst, setCst] = useState('')
  const [sugestoes, setSugestoes] = useState<{ categorias: string[]; fornecedores: string[] }>({
    categorias: [],
    fornecedores: [],
  })
  /* Soma dos custos variaveis da loja, em pontos percentuais. */
  const [percentualVariavel, setPercentualVariavel] = useState(0)
  const [lendo, setLendo] = useState(false)
  const [carregando, setCarregando] = useState(editando)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const [s, v] = await Promise.all([carregarSugestoes(), carregarCustosVariaveis()])
      if (cancelado) return
      setSugestoes(s)
      if (v.ok) setPercentualVariavel(v.dados.reduce((acc, c) => acc + c.percentual, 0))
      if (!editando) return
      const r = await buscarProduto(id)
      if (cancelado) return
      setCarregando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      const p = r.dados
      setDescricao(p.descricao)
      setEan(p.ean ?? '')
      setPrecoVenda(emTexto(p.precoVenda))
      setPrecoCusto(emTexto(p.precoCusto))
      setEstoqueMinimo(String(p.estoqueMinimo))
      setCategoria(p.categoria ?? '')
      setFornecedor(p.fornecedor ?? '')
      setNcm(p.ncm ?? '')
      setCfop(p.cfop ?? '')
      setCst(p.cst ?? '')
    })()
    return () => {
      cancelado = true
    }
  }, [editando, id])

  const venda = centavosDoTexto(precoVenda)
  const custo = centavosDoTexto(precoCusto)
  const margem = venda !== null && custo !== null ? calcularMargem(custo / 100, venda / 100) : null
  /* O que sobra depois de tarifa, imposto e comissao — os custos que crescem com
     a venda. E a margem que o lojista de fato leva para casa. */
  const variavel = venda === null ? 0 : (venda / 100) * (percentualVariavel / 100)
  const sobra = venda === null ? null : venda / 100 - (custo ?? 0) / 100 - variavel

  async function salvar() {
    if (descricao.trim().length < 2) {
      setErro('Descreva o produto para poder cadastrar.')
      return
    }
    if (venda === null || venda <= 0) {
      setErro('Informe o preço de venda.')
      return
    }
    const inteiro = (t: string) => (t.trim() === '' ? 0 : Number.parseInt(t, 10))
    const saldo = inteiro(estoque)
    const minimo = inteiro(estoqueMinimo)
    if (!Number.isFinite(saldo) || saldo < 0 || !Number.isFinite(minimo) || minimo < 0) {
      setErro('Estoque e estoque mínimo são números inteiros, zero ou mais.')
      return
    }

    setErro(null)
    setSalvando(true)
    const r = await salvarProduto(
      {
        descricao,
        ean,
        ncm,
        cfop,
        situacaoTributaria: cst,
        categoria,
        fornecedor,
        precoVenda: venda / 100,
        /* Custo em branco vira zero: o lojista nem sempre sabe na hora, e travar
           o cadastro por isso e travar a venda. */
        precoCusto: (custo ?? 0) / 100,
        estoque: saldo,
        estoqueMinimo: minimo,
      },
      editando ? id : undefined,
    )
    setSalvando(false)

    if (!r.ok) {
      setErro(r.error)
      return
    }

    if (editando) {
      router.back()
      return
    }
    Alert.alert('Produto cadastrado', descricao.trim(), [
      { text: 'OK', onPress: () => router.back() },
    ])
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={editando ? 'Editar produto' : 'Novo produto'}
        subtitulo={ean ? `Código ${ean}` : undefined}
      />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          {carregando ? <Text style={estilos.nota}>Carregando o cadastro...</Text> : null}

          <Campo
            rotulo="Descrição"
            valor={descricao}
            onChange={setDescricao}
            placeholder="Café torrado 500g"
          />

          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Campo
                rotulo="Código de barras (EAN)"
                valor={ean}
                onChange={(v) => setEan(v.replace(/\D/g, ''))}
                tipoTeclado="numeric"
              />
            </View>
            <View style={estilos.bipar}>
              <Botao variante="secundario" onPress={() => setLendo(true)}>
                Bipar
              </Botao>
            </View>
          </View>

          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Campo
                rotulo="Preço de venda"
                valor={precoVenda}
                onChange={setPrecoVenda}
                placeholder="19,90"
                tipoTeclado="decimal-pad"
              />
            </View>
            <View style={estilos.flex}>
              <Campo
                rotulo="Preço de custo"
                valor={precoCusto}
                onChange={setPrecoCusto}
                placeholder="12,00"
                tipoTeclado="decimal-pad"
                dica={margem === null ? undefined : `Margem ${formatPercent(margem)}`}
              />
            </View>
          </View>

          {percentualVariavel > 0 && sobra !== null ? (
            <Text style={[estilos.nota, sobra < 0 && estilos.erro]}>
              Depois dos custos variáveis ({formatPercent(percentualVariavel)}): sobram{' '}
              {formatMoney(sobra)} por unidade.
            </Text>
          ) : null}

          <View style={estilos.linha}>
            {!editando ? (
              <View style={estilos.flex}>
                <Campo
                  rotulo="Estoque inicial"
                  valor={estoque}
                  onChange={(v) => setEstoque(v.replace(/\D/g, ''))}
                  placeholder="0"
                  tipoTeclado="numeric"
                />
              </View>
            ) : null}
            <View style={estilos.flex}>
              <Campo
                rotulo="Estoque mínimo"
                valor={estoqueMinimo}
                onChange={(v) => setEstoqueMinimo(v.replace(/\D/g, ''))}
                placeholder="0"
                tipoTeclado="numeric"
                dica="Abaixo disso, avisa para repor."
              />
            </View>
          </View>

          <Campo rotulo="Categoria" valor={categoria} onChange={setCategoria} />
          <Sugestoes opcoes={sugestoes.categorias} atual={categoria} onEscolher={setCategoria} />

          <Campo rotulo="Fornecedor" valor={fornecedor} onChange={setFornecedor} />
          <Sugestoes
            opcoes={sugestoes.fornecedores}
            atual={fornecedor}
            onEscolher={setFornecedor}
          />

          <Text style={estilos.secao}>Fiscal (para a NFC-e)</Text>
          <Campo
            rotulo="NCM"
            valor={ncm}
            onChange={(v) => setNcm(v.replace(/\D/g, '').slice(0, 8))}
            tipoTeclado="numeric"
            placeholder="8 dígitos"
          />
          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Campo
                rotulo="CFOP"
                valor={cfop}
                onChange={(v) => setCfop(v.replace(/\D/g, '').slice(0, 4))}
                tipoTeclado="numeric"
                placeholder="5102"
              />
            </View>
            <View style={estilos.flex}>
              <Campo
                rotulo="CSOSN"
                valor={cst}
                onChange={(v) => setCst(v.replace(/\D/g, '').slice(0, 3))}
                tipoTeclado="numeric"
                placeholder="102"
              />
            </View>
          </View>
          <Text style={estilos.nota}>
            Sem NCM, o produto vende normalmente; só a nota fiscal dele espera a classificação.
          </Text>

          {erro !== null ? (
            <Text style={estilos.erro} accessibilityRole="alert">
              {erro}
            </Text>
          ) : null}

          <Botao
            onPress={() => void salvar()}
            carregando={salvando}
            desabilitado={carregando}
            largura
          >
            {salvando ? 'Salvando...' : editando ? 'Salvar' : 'Cadastrar'}
          </Botao>
        </ScrollView>
      </KeyboardAvoidingView>

      <LeitorCodigo
        aberto={lendo}
        onLer={(codigo) => {
          setLendo(false)
          setEan(codigo.replace(/\D/g, ''))
        }}
        onFechar={() => setLendo(false)}
      />
    </SafeAreaView>
  )
}

/** O que a loja ja usou, para nao virar "Bebidas" e "bebida" no mesmo catalogo. */
function Sugestoes({
  opcoes,
  atual,
  onEscolher,
}: {
  opcoes: string[]
  atual: string
  onEscolher: (v: string) => void
}) {
  const termo = atual.trim().toLowerCase()
  const visiveis = opcoes
    .filter((o) => o.toLowerCase() !== termo && o.toLowerCase().includes(termo))
    .slice(0, 6)
  if (visiveis.length === 0) return null
  return (
    <View style={estilos.sugestoes}>
      {visiveis.map((o) => (
        <Pressable key={o} onPress={() => onEscolher(o)} style={estilos.sugestao}>
          <Text style={estilos.sugestaoTexto}>{o}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  flex: { flex: 1 },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  linha: { flexDirection: 'row', gap: espaco.md, alignItems: 'flex-start' },
  bipar: { paddingTop: 26 },
  secao: {
    marginTop: espaco.sm,
    fontSize: fonte.corpo,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  sugestoes: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: -espaco.xs },
  sugestao: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.xs,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  sugestaoTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: {
    color: cores.erro,
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
  },
  nota: { color: cores.textoFraco, fontSize: fonte.micro },
})
