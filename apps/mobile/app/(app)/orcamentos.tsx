import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, type TextInput, View } from 'react-native'
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
  editarOrcamento,
  mandarPeloWhatsApp,
  ROTULO_SITUACAO,
  vencido,
  type NovoOrcamento as NovoOrcamentoDados,
  type Orcamento,
} from '@/lib/orcamentos-api'
import { listarClientes, type ClienteDaLista } from '@/lib/clientes-api'
import { listarCatalogo, type ProdutoDoCatalogo } from '@/lib/produtos-api'
import { centavosDoTexto } from '@/lib/valor'
import { maskDocumento } from '@/lib/validation'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const reais = (cents: number) => formatMoney(cents / 100)
const emTexto = (v: number) => v.toFixed(2).replace('.', ',')
const daquiA = (dias: number) => formatDate(diaLocal(new Date(Date.now() + dias * 86_400_000)))

type Linha = {
  produtoId: string
  descricao: string
  estoque: number
  quantidade: string
  preco: string
}

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
  /* Achado do QA: "o abrir do orcamento deveria permitir o editar". */
  const [editando, setEditando] = useState<Orcamento | null>(null)
  const rolagem = useRef<ScrollView>(null)

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
      <ScrollView
        ref={rolagem}
        contentContainerStyle={estilos.conteudo}
        keyboardShouldPersistTaps="handled"
      >
        {editando ? (
          <FormOrcamento
            key={editando.id}
            orcamento={editando}
            aoSalvar={async () => {
              setEditando(null)
              await carregar()
            }}
            aoCancelar={() => setEditando(null)}
          />
        ) : (
          <FormOrcamento aoSalvar={carregar} />
        )}

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
                      {/* A venda que nasceu do orcamento, como o "Ver venda" do web — NR-172. */}
                      {o.saleNumber !== null ? (
                        <View style={estilos.acoes}>
                          <Botao
                            variante="secundario"
                            onPress={() =>
                              router.push({
                                pathname: '/vendas',
                                params: { q: String(o.saleNumber) },
                              })
                            }
                          >
                            {`Ver venda #${o.saleNumber}`}
                          </Botao>
                        </View>
                      ) : null}
                      {o.status === 'open' ? (
                        <View style={estilos.acoes}>
                          <Botao variante="secundario" onPress={() => void cancelar(o)}>
                            Cancelar
                          </Botao>
                          <Botao
                            variante="secundario"
                            onPress={() => {
                              setEditando(o)
                              rolagem.current?.scrollTo({ y: 0, animated: true })
                            }}
                          >
                            Editar
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

function FormOrcamento({
  orcamento,
  aoSalvar,
  aoCancelar,
}: {
  orcamento?: Orcamento
  aoSalvar: () => Promise<void>
  aoCancelar?: () => void
}) {
  const editando = orcamento !== undefined
  /* O cliente e obrigatorio e vem do cadastro — achado do QA. */
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(
    orcamento?.customerId ? { id: orcamento.customerId, nome: orcamento.customerName ?? '' } : null,
  )
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clientes, setClientes] = useState<ClienteDaLista[] | null>(null)
  const [listaAberta, setListaAberta] = useState(false)
  const [validade, setValidade] = useState(orcamento ? formatDate(orcamento.validUntil) : daquiA(7))
  const [desconto, setDesconto] = useState(
    orcamento && orcamento.discountCents > 0 ? emTexto(orcamento.discountCents / 100) : '',
  )
  const [obs, setObs] = useState(orcamento?.notes ?? '')
  const [linhas, setLinhas] = useState<Linha[]>(
    orcamento
      ? orcamento.items.map((i) => ({
          produtoId: i.productId,
          descricao: i.description,
          estoque: i.stock,
          quantidade: String(i.quantity),
          preco: emTexto(i.unitPriceCents / 100),
        }))
      : [],
  )
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoDoCatalogo[]>([])
  const buscaRef = useRef<TextInput>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) return
    const t = setTimeout(() => {
      void listarCatalogo({ termo }).then((r) =>
        setAchados(r.ok ? r.dados.produtos.filter((p) => p.ativo).slice(0, 8) : []),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  /* A lista de clientes abre com Enter ou digitacao, e segue a digitacao
     depois de ela parar, como no PDV. */
  useEffect(() => {
    if (!listaAberta) return
    const t = setTimeout(() => {
      void listarClientes({ termo: buscaCliente.trim() }).then((r) =>
        setClientes(r.ok ? r.dados.clientes.slice(0, 6) : []),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [buscaCliente, listaAberta])

  /** Enter no cliente mostra os cadastrados; com um so, ele ja e o escolhido. */
  function mostrarClientes() {
    if (listaAberta && clientes?.length === 1) return escolherCliente(clientes[0]!)
    setListaAberta(true)
  }

  function escolherCliente(c: ClienteDaLista) {
    setCliente({ id: c.id, nome: c.nome })
    setBuscaCliente('')
    setListaAberta(false)
    setClientes(null)
  }

  /** Enter no produto mostra a lista; com um achado so, ele ja entra. */
  async function listarProdutos() {
    if (achados.length === 1) return incluir(achados[0]!)
    const r = await listarCatalogo({ termo: busca.trim() })
    setAchados(r.ok ? r.dados.produtos.filter((p) => p.ativo).slice(0, 12) : [])
  }

  function incluir(p: ProdutoDoCatalogo) {
    setLinhas((atual) =>
      atual.some((l) => l.produtoId === p.id)
        ? atual
        : [
            ...atual,
            {
              produtoId: p.id,
              descricao: p.descricao,
              estoque: p.estoque,
              quantidade: '1',
              preco: emTexto(p.precoVenda),
            },
          ],
    )
    setBusca('')
    setAchados([])
    /* Lancou, volta para a busca do proximo — achado do QA, o par do web. */
    buscaRef.current?.focus()
  }

  const mudar = (id: string, campo: 'quantidade' | 'preco', valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.produtoId === id ? { ...l, [campo]: valor } : l)))

  const subtotal = linhas.reduce((soma, l) => {
    const q = Number.parseInt(l.quantidade, 10)
    const c = centavosDoTexto(l.preco)
    return soma + (Number.isFinite(q) && q > 0 && c !== null ? q * c : 0)
  }, 0)
  const descontoCents = desconto.trim() === '' ? 0 : (centavosDoTexto(desconto) ?? 0)

  async function salvar() {
    if (cliente === null) return Alert.alert('Orçamento', 'Escolha o cliente do orçamento.')
    if (linhas.length === 0) return Alert.alert('Orçamento', 'Inclua pelo menos um produto.')
    const data = dataDoTexto(validade)
    if (data === null) return Alert.alert('Orçamento', 'Validade inválida. Use DD/MM/AAAA.')
    const itens = []
    for (const l of linhas) {
      const quantity = Number.parseInt(l.quantidade, 10)
      const unitPriceCents = centavosDoTexto(l.preco)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return Alert.alert('Orçamento', `Quantidade inválida em "${l.descricao}".`)
      }
      if (unitPriceCents === null || unitPriceCents < 0) {
        return Alert.alert('Orçamento', `Preço inválido em "${l.descricao}".`)
      }
      itens.push({ productId: l.produtoId, quantity, unitPriceCents })
    }
    if (desconto.trim() !== '' && centavosDoTexto(desconto) === null) {
      return Alert.alert('Orçamento', 'Desconto inválido.')
    }
    if (descontoCents > subtotal) {
      return Alert.alert('Orçamento', 'O desconto não pode passar do total.')
    }

    const dados: NovoOrcamentoDados = {
      customerId: cliente.id,
      items: itens,
      validUntil: data,
      ...(descontoCents > 0 ? { discountCents: descontoCents } : {}),
      ...(obs.trim() ? { notes: obs.trim() } : {}),
    }
    setSalvando(true)
    const r = editando ? await editarOrcamento(orcamento.id, dados) : await criarOrcamento(dados)
    setSalvando(false)
    if (!r.ok) return Alert.alert(editando ? 'Não deu para salvar' : 'Não deu para criar', r.erro)

    Alert.alert(
      editando ? 'Orçamento atualizado' : 'Orçamento criado',
      `Orçamento nº ${r.dados.number} — ${reais(r.dados.totalCents)}.`,
    )
    if (!editando) {
      setCliente(null)
      setDesconto('')
      setObs('')
      setLinhas([])
      setValidade(daquiA(7))
    }
    await aoSalvar()
  }

  return (
    <Cartao titulo={editando ? `Editar orçamento nº ${orcamento.number}` : 'Novo orçamento'}>
      <View style={estilos.form}>
        {cliente ? (
          <View style={estilos.escolhido}>
            <View style={estilos.flex}>
              <Text style={estilos.apoio}>Cliente *</Text>
              <Text style={estilos.nome}>{cliente.nome}</Text>
            </View>
            <Pressable
              onPress={() => {
                setCliente(null)
                setListaAberta(true)
              }}
              accessibilityRole="button"
            >
              <Text style={estilos.trocar}>Trocar</Text>
            </Pressable>
          </View>
        ) : (
          <Campo
            rotulo="Cliente *"
            valor={buscaCliente}
            onChange={(v) => {
              setBuscaCliente(v)
              setListaAberta(true)
            }}
            placeholder="Nome ou CPF/CNPJ"
            dica="Enter mostra os cadastrados"
            aoConfirmar={mostrarClientes}
          />
        )}
        {cliente === null && listaAberta && clientes !== null
          ? clientes.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => escolherCliente(c)}
                style={estilos.achado}
                accessibilityRole="button"
              >
                <Text style={estilos.nome}>{c.nome}</Text>
                <Text style={estilos.apoio}>
                  {c.documento
                    ? maskDocumento(c.documento, c.documento.length > 11 ? 'juridica' : 'fisica')
                    : (c.celular ?? 'sem documento')}
                </Text>
              </Pressable>
            ))
          : null}
        {cliente === null && listaAberta && clientes?.length === 0 ? (
          <Text style={estilos.apoio}>
            Nenhum cliente com esse nome. Cadastre em Clientes e busque de novo.
          </Text>
        ) : null}
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
          dica="Enter mostra a lista"
          aoConfirmar={() => void listarProdutos()}
          refDaEntrada={buscaRef}
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
            <View key={l.produtoId} style={estilos.item}>
              <View style={estilos.linha}>
                <Text style={[estilos.flex, estilos.nome]}>{l.descricao}</Text>
                <Pressable
                  onPress={() => setLinhas((a) => a.filter((x) => x.produtoId !== l.produtoId))}
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
                    onChange={(v) => mudar(l.produtoId, 'quantidade', v)}
                    tipoTeclado="numeric"
                  />
                </View>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Preço un. (R$)"
                    valor={l.preco}
                    onChange={(v) => mudar(l.produtoId, 'preco', v)}
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
        <Botao onPress={() => void salvar()} carregando={salvando} largura>
          {editando ? 'Salvar alterações' : 'Criar orçamento'}
        </Botao>
        {aoCancelar ? (
          <Botao variante="secundario" onPress={aoCancelar} largura>
            Descartar alterações
          </Botao>
        ) : null}
      </View>
    </Cartao>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  form: { gap: espaco.md },
  flex: { flex: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  total: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },
  remover: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
  trocar: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  escolhido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
  },
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
}))
