import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  carregarCompras,
  estornarCompra,
  parcelasIguais,
  registrarCompra,
  type Compra,
} from '@/lib/compras-api'
import { type FornecedorCadastrado, listarFornecedores } from '@/lib/cadastro-fornecedores-api'
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
  /* Estorno — achado do QA ("poder estornar a compra"). */
  const [estornando, setEstornando] = useState<Compra | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)

  async function confirmarEstorno() {
    if (estornando === null) return
    if (motivo.trim().length < 3) return Alert.alert('Estorno', 'Diga por que está estornando.')
    setProcessando(true)
    const r = await estornarCompra(estornando.id, motivo.trim())
    setProcessando(false)
    if (!r.ok) return Alert.alert('Não deu para estornar', r.erro)
    setEstornando(null)
    setMotivo('')
    Alert.alert('Compra estornada', 'O estoque voltou e as contas a pagar foram canceladas.')
    void carregar()
  }

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
        {estornando !== null ? (
          <Cartao titulo={`Estornar a compra de ${estornando.supplier}`}>
            <View style={estilos.form}>
              <Text style={estilos.apoio}>
                O estoque volta ao que era e as contas a pagar desta compra são canceladas. Conta já
                paga precisa ter o pagamento estornado antes.
              </Text>
              <Campo
                rotulo="Motivo *"
                valor={motivo}
                onChange={setMotivo}
                placeholder="Ex.: nota lançada em dobro"
              />
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={() => setEstornando(null)} largura>
                    Voltar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao
                    variante="perigo"
                    onPress={() => void confirmarEstorno()}
                    carregando={processando}
                    largura
                  >
                    Estornar
                  </Botao>
                </View>
              </View>
            </View>
          </Cartao>
        ) : null}
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
                    <Text style={estilos.nome}>
                      {c.supplier}
                      {c.status === 'cancelled' ? ' · estornada' : ''}
                    </Text>
                    <Text style={estilos.apoio}>
                      {formatDateTime(c.createdAt)}
                      {c.invoiceNumber ? ` · NF ${c.invoiceNumber}` : ''}
                      {c.status === 'cancelled' && c.cancelReason ? ` · ${c.cancelReason}` : ''}
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
                {c.status === 'active' ? (
                  <Pressable
                    onPress={() => setEstornando(c)}
                    accessibilityRole="button"
                    style={estilos.estornar}
                  >
                    <Text style={estilos.remover}>Estornar</Text>
                  </Pressable>
                ) : null}
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
  /* O fornecedor do cadastro (NR-191) — achado do QA. O texto livre vale. */
  const [fornecedorId, setFornecedorId] = useState<string | null>(null)
  const [fornecedores, setFornecedores] = useState<FornecedorCadastrado[] | null>(null)
  const [nota, setNota] = useState('')
  const [vencimento, setVencimento] = useState(formatDate(hoje()))
  const [quantas, setQuantas] = useState(1)
  /* Parcelas uma a uma — achado do QA: vencimento e valor de cada uma. */
  const [parcelas, setParcelas] = useState<{ data: string; valor: string }[]>([])
  const [editadas, setEditadas] = useState(false)
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

  /** O "Enter" do teclado no produto mostra a lista — como no PDV. */
  async function listarProdutos() {
    if (achados.length === 1) return incluir(achados[0]!)
    const r = await listarCatalogo({ termo: busca.trim() })
    setAchados(r.ok ? r.dados.produtos.slice(0, 12) : [])
  }

  async function mostrarFornecedores(termo: string) {
    const r = await listarFornecedores({ termo })
    setFornecedores(r.ok ? r.dados : [])
  }

  function escolherFornecedor(f: FornecedorCadastrado) {
    setFornecedor(f.tradeName ?? f.name)
    setFornecedorId(f.id)
    setFornecedores(null)
  }

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

  const recalcular = useCallback(() => {
    const primeiro = dataDoTexto(vencimento)
    if (primeiro === null) return
    setParcelas(
      parcelasIguais(Math.max(total, quantas), quantas, primeiro).map((p) => ({
        data: formatDate(p.dueDate),
        valor: (p.amountCents / 100).toFixed(2).replace('.', ','),
      })),
    )
    setEditadas(false)
  }, [quantas, total, vencimento])

  useEffect(() => {
    if (editadas) return
    const t = setTimeout(recalcular, 0)
    return () => clearTimeout(t)
  }, [recalcular, editadas])

  const soma = parcelas.reduce((s, p) => s + (centavosDoTexto(p.valor) ?? 0), 0)
  const diferenca = total - soma

  function mudarParcela(i: number, campo: 'data' | 'valor', v: string) {
    setEditadas(true)
    setParcelas((ps) =>
      ps.map((p, j) => (j === i ? { ...p, [campo]: campo === 'data' ? mascaraData(v) : v } : p)),
    )
  }

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

    const parcels = parcelas.map((p) => ({
      dueDate: dataDoTexto(p.data) ?? '',
      amountCents: centavosDoTexto(p.valor) ?? 0,
    }))
    if (total > 0) {
      if (parcels.some((p) => p.dueDate === '' || p.amountCents <= 0)) {
        return Alert.alert('Entrada', 'Cada parcela precisa de vencimento (DD/MM/AAAA) e valor.')
      }
      if (diferenca !== 0) {
        return Alert.alert(
          'Entrada',
          `As parcelas somam ${reais(soma)}; a compra é de ${reais(total)}.`,
        )
      }
    }

    setSalvando(true)
    const r = await registrarCompra({
      supplier: fornecedor.trim(),
      ...(fornecedorId !== null ? { supplierId: fornecedorId } : {}),
      ...(nota.trim() ? { invoiceNumber: nota.trim() } : {}),
      items: itens,
      ...(total > 0 ? { parcels } : { dueDate: data }),
    })
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para registrar', r.erro)

    Alert.alert(
      'Entrada registrada',
      `${reais(r.dados.totalCents)}${r.dados.totalCents > 0 ? ' lançado em contas a pagar' : ''}.`,
    )
    setFornecedor('')
    setFornecedorId(null)
    setNota('')
    setQuantas(1)
    setEditadas(false)
    setLinhas([])
    await aoRegistrar()
  }

  return (
    <Cartao titulo="Nova entrada">
      <View style={estilos.form}>
        <Campo
          rotulo="Fornecedor *"
          valor={fornecedor}
          onChange={(v) => {
            setFornecedor(v)
            setFornecedorId(null)
            if (v.trim().length >= 2) void mostrarFornecedores(v)
          }}
          placeholder="Busque ou digite o nome"
          dica={fornecedorId !== null ? 'Fornecedor do cadastro' : 'Enter mostra os cadastrados'}
          aoConfirmar={() => void mostrarFornecedores(fornecedor)}
        />
        {fornecedores !== null && fornecedorId === null
          ? fornecedores.slice(0, 6).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => escolherFornecedor(f)}
                style={estilos.achado}
                accessibilityRole="button"
              >
                <Text style={estilos.nome}>{f.tradeName ?? f.name}</Text>
                {f.tradeName ? <Text style={estilos.apoio}>{f.name}</Text> : null}
              </Pressable>
            ))
          : null}
        {fornecedores !== null && fornecedores.length === 0 && fornecedorId === null ? (
          <Text style={estilos.apoio}>
            Nenhum fornecedor cadastrado com esse nome. Pode seguir com o nome digitado.
          </Text>
        ) : null}
        <Campo rotulo="Número da nota" valor={nota} onChange={setNota} dica="opcional" />
        <Campo
          rotulo="Adicionar produto"
          valor={busca}
          onChange={(v) => {
            setBusca(v)
            if (v.trim().length < 2) setAchados([])
          }}
          placeholder="Nome, código ou código de barras"
          dica="Enter mostra a lista"
          aoConfirmar={() => void listarProdutos()}
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

        <Text style={estilos.rotulo}>Parcelas</Text>
        <View style={estilos.parcelas}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <Pressable
              key={n}
              onPress={() => {
                setQuantas(n)
                setEditadas(false)
              }}
              style={[estilos.parcela, quantas === n && estilos.parcelaAtiva]}
              accessibilityRole="button"
              accessibilityState={{ selected: quantas === n }}
            >
              <Text style={estilos.parcelaTexto}>{n === 1 ? 'Única' : `${n}x`}</Text>
            </Pressable>
          ))}
        </View>
        <Campo
          rotulo="Primeiro vencimento *"
          valor={vencimento}
          onChange={(v) => {
            setVencimento(mascaraData(v))
            setEditadas(false)
          }}
          tipoTeclado="numeric"
          placeholder="DD/MM/AAAA"
        />
        {total > 0
          ? parcelas.map((p, i) => (
              <View key={i} style={estilos.linha}>
                <Text style={estilos.apoio}>{i + 1}ª</Text>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Vencimento"
                    valor={p.data}
                    onChange={(v) => mudarParcela(i, 'data', v)}
                    tipoTeclado="numeric"
                  />
                </View>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Valor (R$)"
                    valor={p.valor}
                    onChange={(v) => mudarParcela(i, 'valor', v)}
                    tipoTeclado="decimal-pad"
                  />
                </View>
              </View>
            ))
          : null}
        {total > 0 && diferenca !== 0 ? (
          <Text style={estilos.diferenca}>
            {diferenca > 0 ? 'Faltam' : 'Sobram'} {reais(Math.abs(diferenca))} para fechar com o
            total.
          </Text>
        ) : null}
        {editadas ? (
          <Pressable onPress={recalcular} accessibilityRole="button">
            <Text style={estilos.recalcular}>Recalcular parcelas iguais</Text>
          </Pressable>
        ) : null}

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
  diferenca: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.erro },
  recalcular: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  estornar: { alignSelf: 'flex-end', paddingVertical: espaco.xs },
}))
