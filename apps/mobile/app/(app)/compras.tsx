import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import { carregarCompras, registrarCompra, type Compra } from '@/lib/compras-api'
import {
  dataDoTexto,
  formatDate,
  formatDateTime,
  formatMoney,
  hoje,
  mascaraData,
} from '@/lib/format'
import { listarCatalogo, type ProdutoDoCatalogo } from '@/lib/produtos-api'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const reais = (cents: number) => formatMoney(cents / 100)

type Linha = { produto: ProdutoDoCatalogo; quantidade: string; custo: string }

const custoInicial = (p: ProdutoDoCatalogo) =>
  p.precoCusto > 0 ? p.precoCusto.toFixed(2).replace('.', ',') : ''

/**
 * Entrada de mercadoria — NR-158, o par da tela do web: compra de fornecedor
 * que soma ao estoque, atualiza o custo e lanca a conta a pagar.
 */
export default function ComprasScreen() {
  const [compras, setCompras] = useState<Compra[] | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarCompras()
    if (r.ok) {
      setCompras(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void carregar()
    }, [carregar]),
  )

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Entrada de mercadoria" subtitulo="Compra de fornecedor" />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <NovaEntrada aoRegistrar={carregar} />

        <Cartao titulo="Entradas registradas">
          {erro !== null ? (
            <Vazio titulo="Não deu para carregar" descricao={erro} />
          ) : compras === undefined ? (
            <Text style={estilos.apoio}>Carregando...</Text>
          ) : compras.length === 0 ? (
            <Text style={estilos.apoio}>Nenhuma entrada registrada ainda.</Text>
          ) : (
            compras.map((c) => (
              <View key={c.id} style={estilos.compra}>
                <View style={estilos.linha}>
                  <View style={estilos.flex}>
                    <Text style={estilos.nome}>{c.supplier}</Text>
                    <Text style={estilos.apoio}>
                      {formatDateTime(c.createdAt)}
                      {c.invoiceNumber ? ` · NF ${c.invoiceNumber}` : ''}
                    </Text>
                  </View>
                  <View style={estilos.direita}>
                    <Text style={estilos.nome}>{reais(c.totalCents)}</Text>
                    <Text style={estilos.apoio}>
                      {c.installments > 1 ? `em ${c.installments} parcelas` : 'parcela única'}
                    </Text>
                  </View>
                </View>
                {c.items.map((i) => (
                  <Text key={i.productId} style={estilos.apoio}>
                    {i.quantity} × {i.description} — {reais(i.unitCostCents)} cada
                  </Text>
                ))}
              </View>
            ))
          )}
        </Cartao>
      </ScrollView>
    </SafeAreaView>
  )
}

function NovaEntrada({ aoRegistrar }: { aoRegistrar: () => Promise<void> }) {
  const [fornecedor, setFornecedor] = useState('')
  const [nota, setNota] = useState('')
  const [vencimento, setVencimento] = useState(formatDate(hoje()))
  const [parcelas, setParcelas] = useState(1)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoDoCatalogo[]>([])
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) return
    const t = setTimeout(() => {
      void listarCatalogo({ termo }).then((r) =>
        setAchados(r.ok ? r.dados.produtos.slice(0, 8) : []),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  function incluir(p: ProdutoDoCatalogo) {
    setLinhas((atual) =>
      atual.some((l) => l.produto.id === p.id)
        ? atual
        : [...atual, { produto: p, quantidade: '1', custo: custoInicial(p) }],
    )
    setBusca('')
    setAchados([])
  }

  const mudar = (id: string, campo: 'quantidade' | 'custo', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produto.id === id ? { ...l, [campo]: valor } : l)))

  const total = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.custo)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)

  async function registrar() {
    if (fornecedor.trim().length < 2) return Alert.alert('Entrada', 'Informe o fornecedor.')
    if (linhas.length === 0) return Alert.alert('Entrada', 'Inclua pelo menos um produto.')
    const data = dataDoTexto(vencimento)
    if (data === null) return Alert.alert('Entrada', 'Vencimento inválido. Use DD/MM/AAAA.')

    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitCostCents = centavosDoTexto(l.custo)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return Alert.alert('Entrada', `Quantidade inválida em "${l.produto.descricao}".`)
      }
      if (unitCostCents === null || unitCostCents < 0) {
        return Alert.alert('Entrada', `Custo inválido em "${l.produto.descricao}".`)
      }
      itens.push({ productId: l.produto.id, quantity, unitCostCents })
    }

    setSalvando(true)
    const r = await registrarCompra({
      supplier: fornecedor.trim(),
      ...(nota.trim() ? { invoiceNumber: nota.trim() } : {}),
      items: itens,
      dueDate: data,
      installments: parcelas,
    })
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para registrar', r.erro)

    Alert.alert(
      'Entrada registrada',
      `${reais(r.dados.totalCents)}${r.dados.totalCents > 0 ? ' lançado em contas a pagar' : ''}.`,
    )
    setFornecedor('')
    setNota('')
    setParcelas(1)
    setLinhas([])
    await aoRegistrar()
  }

  return (
    <Cartao titulo="Nova entrada">
      <View style={estilos.form}>
        <Campo
          rotulo="Fornecedor *"
          valor={fornecedor}
          onChange={setFornecedor}
          placeholder="Ex.: Distribuidora Boa Vista"
        />
        <Campo rotulo="Número da nota" valor={nota} onChange={setNota} dica="opcional" />
        <Campo
          rotulo="Adicionar produto"
          valor={busca}
          onChange={(v) => {
            setBusca(v)
            if (v.trim().length < 2) setAchados([])
          }}
          placeholder="Nome, código ou código de barras"
        />
        {achados.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => incluir(p)}
            style={estilos.achado}
            accessibilityRole="button"
          >
            <Text style={estilos.nome}>{p.descricao}</Text>
            <Text style={estilos.apoio}>
              estoque {p.estoque} · custo atual {formatMoney(p.precoCusto)}
            </Text>
          </Pressable>
        ))}

        {linhas.length === 0 ? (
          <Text style={estilos.apoio}>Nenhum produto incluído.</Text>
        ) : (
          linhas.map((l) => (
            <View key={l.produto.id} style={estilos.item}>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Text style={estilos.nome}>{l.produto.descricao}</Text>
                  <Text style={estilos.apoio}>estoque atual {l.produto.estoque}</Text>
                </View>
                <Pressable
                  onPress={() => setLinhas((a) => a.filter((x) => x.produto.id !== l.produto.id))}
                  accessibilityRole="button"
                >
                  <Text style={estilos.remover}>Remover</Text>
                </Pressable>
              </View>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Qtd."
                    valor={l.quantidade}
                    onChange={(v) => mudar(l.produto.id, 'quantidade', v)}
                    tipoTeclado="numeric"
                  />
                </View>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Custo un. (R$)"
                    valor={l.custo}
                    onChange={(v) => mudar(l.produto.id, 'custo', v)}
                    tipoTeclado="decimal-pad"
                    placeholder="0,00"
                  />
                </View>
              </View>
            </View>
          ))
        )}

        <Campo
          rotulo="Vencimento da 1ª parcela *"
          valor={vencimento}
          onChange={(v) => setVencimento(mascaraData(v))}
          tipoTeclado="numeric"
          placeholder="DD/MM/AAAA"
        />
        <Text style={estilos.rotulo}>Parcelas</Text>
        <View style={estilos.parcelas}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <Pressable
              key={n}
              onPress={() => setParcelas(n)}
              style={[estilos.parcela, parcelas === n && estilos.parcelaAtiva]}
              accessibilityRole="button"
              accessibilityState={{ selected: parcelas === n }}
            >
              <Text style={estilos.parcelaTexto}>{n === 1 ? 'Única' : `${n}x`}</Text>
            </Pressable>
          ))}
        </View>

        <View style={estilos.linha}>
          <Text style={[estilos.flex, estilos.apoio]}>Total</Text>
          <Text style={estilos.total}>{reais(total)}</Text>
        </View>
        <Botao onPress={() => void registrar()} carregando={salvando} largura>
          Registrar entrada
        </Botao>
      </View>
    </Cartao>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  form: { gap: espaco.md },
  flex: { flex: 1 },
  direita: { alignItems: 'flex-end' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  rotulo: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.textoFraco },
  total: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },
  remover: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
  achado: {
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
    gap: 2,
  },
  item: {
    gap: espaco.sm,
    paddingBottom: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  compra: {
    gap: espaco.xs,
    paddingVertical: espaco.sm,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  parcelas: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  parcela: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  parcelaAtiva: { borderColor: cores.acento, backgroundColor: cores.campo },
  parcelaTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
}))
