import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import { dataDoTexto, diaLocal, formatDate, formatMoney, hoje, mascaraData } from '@/lib/format'
import {
  cancelarOrcamento,
  carregarOrcamentos,
  compartilharOrcamento,
  criarOrcamento,
  mandarPeloWhatsApp,
  ROTULO_SITUACAO,
  vencido,
  type Orcamento,
} from '@/lib/orcamentos-api'
import { listarCatalogo, type ProdutoDoCatalogo } from '@/lib/produtos-api'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

const reais = (cents: number) => formatMoney(cents / 100)
const emTexto = (v: number) => v.toFixed(2).replace('.', ',')
const daquiA = (dias: number) => formatDate(diaLocal(new Date(Date.now() + dias * 86_400_000)))

type Linha = { produto: ProdutoDoCatalogo; quantidade: string; preco: string }

/**
 * Orcamentos — NR-159, o par da tela do web: proposta ao cliente sem baixar
 * estoque, compartilhavel pelo WhatsApp, que vira venda no PDV com o carrinho
 * montado.
 */
export default function OrcamentosScreen() {
  const router = useRouter()
  const [orcamentos, setOrcamentos] = useState<Orcamento[] | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarOrcamentos()
    if (r.ok) {
      setOrcamentos(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void carregar()
    }, [carregar]),
  )

  async function cancelar(o: Orcamento) {
    Alert.alert('Cancelar orçamento', `Cancelar o orçamento nº ${o.number}?`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar orçamento',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const r = await cancelarOrcamento(o.id)
            if (!r.ok) return Alert.alert('Não deu para cancelar', r.erro)
            await carregar()
          })(),
      },
    ])
  }

  const dia = hoje()

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Orçamentos" subtitulo="Proposta ao cliente" />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <NovoOrcamento aoCriar={carregar} />

        <Cartao titulo="Orçamentos">
          {erro !== null ? (
            <Vazio titulo="Não deu para carregar" descricao={erro} />
          ) : orcamentos === undefined ? (
            <Text style={estilos.apoio}>Carregando...</Text>
          ) : orcamentos.length === 0 ? (
            <Text style={estilos.apoio}>Nenhum orçamento ainda.</Text>
          ) : (
            orcamentos.map((o) => {
              const venceu = vencido(o, dia)
              const expandido = aberto === o.id
              return (
                <View key={o.id} style={estilos.orcamento}>
                  <Pressable
                    onPress={() => setAberto(expandido ? null : o.id)}
                    style={estilos.linha}
                    accessibilityRole="button"
                    accessibilityLabel={`Orçamento ${o.number}`}
                  >
                    <View style={estilos.flex}>
                      <Text style={estilos.nome}>
                        Nº {o.number}
                        {o.customerName ? ` · ${o.customerName}` : ''}
                      </Text>
                      <Text style={estilos.apoio}>
                        {venceu ? 'Vencido' : ROTULO_SITUACAO[o.status]} · válido até{' '}
                        {formatDate(o.validUntil)}
                      </Text>
                    </View>
                    <Text style={estilos.nome}>{reais(o.totalCents)}</Text>
                  </Pressable>
                  {expandido ? (
                    <View style={estilos.detalhe}>
                      {o.items.map((i) => (
                        <Text key={i.productId} style={estilos.apoio}>
                          {i.quantity} × {i.description} — {reais(i.unitPriceCents)}
                        </Text>
                      ))}
                      {o.discountCents > 0 ? (
                        <Text style={estilos.apoio}>Desconto {reais(o.discountCents)}</Text>
                      ) : null}
                      {o.notes ? <Text style={estilos.apoio}>Obs.: {o.notes}</Text> : null}
                      <View style={estilos.acoes}>
                        <Botao
                          variante="secundario"
                          onPress={() =>
                            void compartilharOrcamento(o).then(
                              (r) => !r.ok && Alert.alert('Orçamento', r.erro),
                            )
                          }
                        >
                          Compartilhar
                        </Botao>
                        <Botao
                          variante="secundario"
                          onPress={() =>
                            void mandarPeloWhatsApp(o).then(
                              (r) => !r.ok && Alert.alert('Orçamento', r.erro),
                            )
                          }
                        >
                          WhatsApp
                        </Botao>
                      </View>
                      {o.status === 'open' ? (
                        <View style={estilos.acoes}>
                          <Botao variante="secundario" onPress={() => void cancelar(o)}>
                            Cancelar
                          </Botao>
                          <Botao
                            onPress={() =>
                              router.push({ pathname: '/pdv', params: { orcamento: o.id } })
                            }
                          >
                            Converter em venda
                          </Botao>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              )
            })
          )}
        </Cartao>
      </ScrollView>
    </SafeAreaView>
  )
}

function NovoOrcamento({ aoCriar }: { aoCriar: () => Promise<void> }) {
  const [cliente, setCliente] = useState('')
  const [validade, setValidade] = useState(daquiA(7))
  const [desconto, setDesconto] = useState('')
  const [obs, setObs] = useState('')
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
        : [...atual, { produto: p, quantidade: '1', preco: emTexto(p.precoVenda) }],
    )
    setBusca('')
    setAchados([])
  }

  const mudar = (id: string, campo: 'quantidade' | 'preco', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produto.id === id ? { ...l, [campo]: valor } : l)))

  const subtotal = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.preco)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)
  const descontoCents = desconto.trim() === '' ? 0 : (centavosDoTexto(desconto) ?? 0)

  async function criar() {
    if (linhas.length === 0) return Alert.alert('Orçamento', 'Inclua pelo menos um produto.')
    const data = dataDoTexto(validade)
    if (data === null) return Alert.alert('Orçamento', 'Validade inválida. Use DD/MM/AAAA.')
    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitPriceCents = centavosDoTexto(l.preco)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return Alert.alert('Orçamento', `Quantidade inválida em "${l.produto.descricao}".`)
      }
      if (unitPriceCents === null || unitPriceCents < 0) {
        return Alert.alert('Orçamento', `Preço inválido em "${l.produto.descricao}".`)
      }
      itens.push({ productId: l.produto.id, quantity, unitPriceCents })
    }
    if (desconto.trim() !== '' && centavosDoTexto(desconto) === null) {
      return Alert.alert('Orçamento', 'Desconto inválido.')
    }
    if (descontoCents > subtotal) {
      return Alert.alert('Orçamento', 'O desconto não pode passar do total.')
    }

    setSalvando(true)
    const r = await criarOrcamento({
      ...(cliente.trim() ? { customerName: cliente.trim() } : {}),
      items: itens,
      validUntil: data,
      ...(descontoCents > 0 ? { discountCents: descontoCents } : {}),
      ...(obs.trim() ? { notes: obs.trim() } : {}),
    })
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para criar', r.erro)

    Alert.alert(
      'Orçamento criado',
      `Orçamento nº ${r.dados.number} — ${reais(r.dados.totalCents)}.`,
    )
    setCliente('')
    setDesconto('')
    setObs('')
    setLinhas([])
    setValidade(daquiA(7))
    await aoCriar()
  }

  return (
    <Cartao titulo="Novo orçamento">
      <View style={estilos.form}>
        <Campo
          rotulo="Cliente"
          valor={cliente}
          onChange={setCliente}
          dica="opcional"
          placeholder="Nome de quem pediu"
        />
        <Campo
          rotulo="Válido até *"
          valor={validade}
          onChange={(v) => setValidade(mascaraData(v))}
          tipoTeclado="numeric"
          placeholder="DD/MM/AAAA"
        />
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
              {formatMoney(p.precoVenda)} · estoque {p.estoque}
            </Text>
          </Pressable>
        ))}

        {linhas.length === 0 ? (
          <Text style={estilos.apoio}>Nenhum produto incluído.</Text>
        ) : (
          linhas.map((l) => (
            <View key={l.produto.id} style={estilos.item}>
              <View style={estilos.linha}>
                <Text style={[estilos.flex, estilos.nome]}>{l.produto.descricao}</Text>
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
                    rotulo="Preço un. (R$)"
                    valor={l.preco}
                    onChange={(v) => mudar(l.produto.id, 'preco', v)}
                    tipoTeclado="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))
        )}

        <Campo
          rotulo="Desconto (R$)"
          valor={desconto}
          onChange={setDesconto}
          tipoTeclado="decimal-pad"
          dica="opcional"
          placeholder="0,00"
        />
        <Campo
          rotulo="Observações"
          valor={obs}
          onChange={setObs}
          dica="opcional"
          placeholder="Prazo de entrega, condições..."
        />

        <View style={estilos.linha}>
          <Text style={[estilos.flex, estilos.apoio]}>Total</Text>
          <Text style={estilos.total}>{reais(Math.max(subtotal - descontoCents, 0))}</Text>
        </View>
        <Botao onPress={() => void criar()} carregando={salvando} largura>
          Criar orçamento
        </Botao>
      </View>
    </Cartao>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  form: { gap: espaco.md },
  flex: { flex: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
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
  orcamento: {
    paddingVertical: espaco.sm,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  detalhe: { gap: espaco.xs, paddingTop: espaco.sm },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: espaco.sm },
})
