import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import {
  estadoDaNota,
  faltaPagarCentavos,
  fecharVenda,
  margemEmPontos,
  novaChaveDeVenda,
  pedirNota,
  reconciliarContingencia,
  situacaoCertificado,
  type Desconto,
  type EstadoEmissao,
  type NotaEmitida,
  type Pagamento,
  type SituacaoCertificado,
  type VendaRegistrada,
  FORMAS,
  PARCELAS_MAXIMAS,
  paraItemCarrinho,
  subtotalCarrinho,
  subtotalItem,
  valorDesconto,
  type ItemCarrinho,
} from '@/lib/vendas-api'
import { buscarEan, type ProdutoLido } from '@/lib/produtos-api'
import { vencidoDoCliente } from '@/lib/clientes-api'
import {
  carregarOrcamento,
  converterOrcamento,
  criarOrcamento,
  type Orcamento,
} from '@/lib/orcamentos-api'
import type { FormaPagamento } from '@/lib/types'
import { diaLocal, formatMoney } from '@/lib/format'
import { tocarConfirmacao } from '@/lib/som'
import { centavosDoTexto } from '@/lib/valor'
import Botao from '@/components/ui/Botao'
import { Vazio } from '@/components/ui/Cartao'
import LeitorCodigo from '@/components/LeitorCodigo'
import ConfirmarModal from '@/components/ConfirmarModal'
import { DescontoModal, SeletorCliente, SeletorProduto } from '@/components/SeletoresDoPdv'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/** Uma forma de pagamento quando a venda e dividida: o valor fica como digitado. */
type Parte = { id: string; forma: FormaPagamento; texto: string; parcelas: number }

type ClienteDaVenda = { id: string; nome: string; saldoFiado: number }

const rotuloDaForma = (forma: FormaPagamento) =>
  FORMAS.find((f) => f.valor === forma)?.rotulo ?? forma

const emTexto = (centavos: number) => (Math.max(centavos, 0) / 100).toFixed(2).replace('.', ',')

/**
 * PDV do celular — o mesmo balcao do web, na mao.
 *
 * Bipar ou buscar pelo nome, cliente (obrigatorio no fiado), desconto e
 * pagamento numa forma so ou dividido. O caminho curto continua o mesmo:
 * bipou, escolheu a forma, fechou — o resto so aparece para quem toca.
 */
export default function Pdv() {
  const router = useRouter()
  /* `?orcamento=<id>`: o carrinho chega montado com os precos prometidos — NR-159. */
  const { orcamento: orcamentoId } = useLocalSearchParams<{ orcamento?: string }>()
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null)
  const [salvandoOrcamento, setSalvandoOrcamento] = useState(false)
  const [itens, setItens] = useState<ItemCarrinho[]>([])
  const [lendo, setLendo] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [escolhendoCliente, setEscolhendoCliente] = useState(false)
  const [editandoDesconto, setEditandoDesconto] = useState(false)
  const [cliente, setCliente] = useState<ClienteDaVenda | null>(null)
  /** Quanto o cliente tem vencido — o aviso de RF-072 antes do fiado. */
  const [vencido, setVencido] = useState<number | null>(null)
  const [desconto, setDesconto] = useState<Desconto | null>(null)
  const [forma, setForma] = useState<FormaPagamento>('dinheiro')
  /* So vale no credito; 1 = a vista. */
  const [parcelas, setParcelas] = useState(1)
  /** Nulo = uma forma so, pelo total. Com partes, a venda e dividida. */
  const [partes, setPartes] = useState<Parte[] | null>(null)
  const [fechando, setFechando] = useState(false)
  /** O texto da confirmacao do fechamento; nulo = janela fechada. */
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  /** A ultima venda fechada, com a decomposicao — US-020. */
  const [resumo, setResumo] = useState<VendaRegistrada | null>(null)
  /**
   * A chave do fechamento em andamento — RNF-043.
   *
   * Guardada em `ref` e nao em estado: ela nao muda o que a tela desenha. O que
   * importa e que ela SOBREVIVA entre tentativas — gerar uma nova a cada toque
   * faria o reenvio virar uma segunda venda.
   */
  const chaveDoFechamento = useRef<string | null>(null)
  const proximaParte = useRef(1)

  const subtotal = subtotalCarrinho(itens)
  /* Centavos inteiros: o servidor confere a soma dos pagamentos contra
     itens menos desconto, e um arredondamento diferente aqui recusaria a venda. */
  const descontoCentavos = Math.round(valorDesconto(subtotal, desconto) * 100)
  const totalCentavos = Math.round(subtotal * 100) - descontoCentavos
  const total = totalCentavos / 100
  const quantidade = itens.reduce((acc, i) => acc + i.quantidade, 0)

  const pagamentos: Pagamento[] =
    partes === null
      ? [
          {
            id: 'p1',
            forma,
            valor: total,
            status: 'confirmado',
            ...(forma === 'credito' && parcelas > 1 ? { parcelas } : {}),
          },
        ]
      : partes.map((p) => ({
          id: p.id,
          forma: p.forma,
          valor: (centavosDoTexto(p.texto) ?? 0) / 100,
          status: 'confirmado',
          ...(p.forma === 'credito' && p.parcelas > 1 ? { parcelas: p.parcelas } : {}),
        }))
  const falta = faltaPagarCentavos(totalCentavos, pagamentos)
  const temFiado = pagamentos.some((p) => p.forma === 'carteira')

  useEffect(() => {
    if (!orcamentoId) return
    let cancelado = false
    void carregarOrcamento(orcamentoId).then((r) => {
      if (cancelado) return
      if (!r.ok) return Alert.alert('Orçamento', r.erro)
      if (r.dados.status !== 'open') {
        return Alert.alert('Orçamento', `O orçamento nº ${r.dados.number} não está mais em aberto.`)
      }
      const ativos = r.dados.items.filter((i) => i.isActive)
      setItens(
        ativos.map((i) => ({
          produtoId: i.productId,
          codigo: i.code,
          descricao: i.description,
          precoUnitario: i.unitPriceCents / 100,
          precoCusto: i.costPriceCents / 100,
          quantidade: i.quantity,
          estoqueDisponivel: i.stock,
        })),
      )
      setDesconto(
        r.dados.discountCents > 0 ? { tipo: 'valor', quantia: r.dados.discountCents / 100 } : null,
      )
      setOrcamento(r.dados)
      if (ativos.length < r.dados.items.length) {
        Alert.alert('Orçamento', 'Produtos que foram inativados ficaram fora do carrinho.')
      }
    })
    return () => {
      cancelado = true
    }
  }, [orcamentoId])

  /* O aviso de divida vem do servidor quando o cliente muda. */
  useEffect(() => {
    if (cliente === null) return
    let cancelado = false
    void (async () => {
      const v = await vencidoDoCliente(cliente.id)
      if (!cancelado) setVencido(v)
    })()
    return () => {
      cancelado = true
    }
  }, [cliente])

  function adicionarAoCarrinho(
    produto: Pick<
      ProdutoLido,
      'id' | 'codigo' | 'descricao' | 'precoVenda' | 'precoCusto' | 'estoque'
    >,
  ) {
    setItens((atual) => {
      const existe = atual.find((i) => i.produtoId === produto.id)
      if (existe) {
        return atual.map((i) =>
          i.produtoId === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i,
        )
      }
      return [...atual, paraItemCarrinho(produto)]
    })
  }

  /**
   * Bipou: procura na api, nao no catalogo em memoria.
   *
   * A lista carregada na tela pode estar velha em relacao ao que outro operador
   * acabou de cadastrar — e no balcao isso significa dizer "nao existe" para um
   * produto que existe.
   */
  async function adicionarPorCodigo(codigo: string) {
    setLendo(false)

    const r = await buscarEan(codigo)

    if (r.situacao === 'erro') {
      Alert.alert('Não deu para ler', r.mensagem)
      return
    }

    if (r.situacao === 'novo') {
      Alert.alert('Produto não cadastrado', `O código ${r.ean} não está no catálogo desta loja.`, [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Cadastrar',
          onPress: () => router.push({ pathname: '/produto-novo', params: { ean: r.ean } }),
        },
      ])
      return
    }

    adicionarAoCarrinho(r.produto)
  }

  function mudarQuantidade(produtoId: string, delta: number) {
    setItens((atual) =>
      atual
        .map((i) => (i.produtoId === produtoId ? { ...i, quantidade: i.quantidade + delta } : i))
        .filter((i) => i.quantidade > 0),
    )
  }

  function limparVenda() {
    setItens([])
    setCliente(null)
    setVencido(null)
    setDesconto(null)
    setPartes(null)
    setParcelas(1)
    setOrcamento(null)
  }

  /**
   * O carrinho vira um orcamento numerado (NR-159) com os mesmos precos e
   * desconto, e a lista de orcamentos abre para compartilhar — NR-164.
   */
  async function salvarComoOrcamento() {
    setSalvandoOrcamento(true)
    const r = await criarOrcamento({
      ...(cliente === null ? {} : { customerName: cliente.nome }),
      items: itens.map((i) => ({
        productId: i.produtoId,
        quantity: i.quantidade,
        unitPriceCents: Math.round(i.precoUnitario * 100),
      })),
      validUntil: diaLocal(new Date(Date.now() + 7 * 86_400_000)),
      ...(descontoCentavos > 0 ? { discountCents: descontoCentavos } : {}),
    })
    setSalvandoOrcamento(false)
    if (!r.ok) return Alert.alert('Não deu para salvar o orçamento', r.erro)
    limparVenda()
    Alert.alert('Orçamento salvo', `Orçamento nº ${r.dados.number} — compartilhe pela lista.`)
    router.push('/orcamentos')
  }

  function cancelar() {
    Alert.alert('Cancelar a venda', 'O carrinho será esvaziado.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar venda', style: 'destructive', onPress: limparVenda },
    ])
  }

  /** Divide: a forma escolhida vira a primeira parte, com o total. */
  function dividir() {
    proximaParte.current = 2
    setPartes([{ id: 'p1', forma, texto: emTexto(totalCentavos), parcelas }])
  }

  function adicionarParte() {
    const id = `p${proximaParte.current}`
    proximaParte.current += 1
    setPartes((atual) => [
      ...(atual ?? []),
      { id, forma: 'pix', texto: emTexto(falta), parcelas: 1 },
    ])
  }

  function mudarParte(id: string, mudanca: Partial<Parte>) {
    setPartes((atual) => (atual ?? []).map((p) => (p.id === id ? { ...p, ...mudanca } : p)))
  }

  function tirarParte(id: string) {
    setPartes((atual) => {
      const resto = (atual ?? []).filter((p) => p.id !== id)
      return resto.length === 0 ? null : resto
    })
  }

  /** O que impede fechar, dito do jeito que o operador resolve. Nulo = pode. */
  function impedimento(): string | null {
    if (partes !== null && pagamentos.some((p) => p.valor <= 0)) {
      return 'Preencha o valor de cada forma de pagamento.'
    }
    if (falta > 0) return `Falta ${formatMoney(falta / 100)} para fechar.`
    /* So dinheiro vira troco (RF-035); a mais no cartao e erro de digitacao. */
    if (falta < 0 && !pagamentos.some((p) => p.forma === 'dinheiro')) {
      return `Os pagamentos passam do total em ${formatMoney(-falta / 100)}.`
    }
    if (temFiado && cliente === null) return 'Venda no fiado precisa de cliente. Escolha o cliente.'
    return null
  }

  /**
   * Fecha a venda — RF-036, RNF-043.
   *
   * A chave de idempotencia e gerada UMA VEZ, quando o operador confirma, e
   * reusada em toda tentativa deste fechamento. So e descartada quando a venda
   * entra — a partir dai, o proximo fechamento e outra venda.
   */
  async function confirmar() {
    setConfirmacao(null)
    chaveDoFechamento.current ??= novaChaveDeVenda()
    setFechando(true)

    const r = await fecharVenda(itens, pagamentos, chaveDoFechamento.current, {
      ...(cliente === null ? {} : { clienteId: cliente.id }),
      ...(descontoCentavos > 0 ? { descontoCentavos } : {}),
    })

    setFechando(false)

    if (!r.ok) {
      /* NAO limpa a chave: a proxima tentativa e do MESMO fechamento. */
      Alert.alert('Não deu para fechar', `${r.erro}\n\nO carrinho continua aqui. Tente de novo.`)
      return
    }

    if (orcamento !== null) {
      /* A venda ja entrou; marcar o orcamento e consequencia. */
      const c = await converterOrcamento(orcamento.id, r.venda.id)
      if (!c.ok) Alert.alert('Venda feita', `Mas o orçamento não foi marcado: ${c.erro}`)
    }

    chaveDoFechamento.current = null
    /* O "pronto" da venda fechada, como no web — NR-163. */
    tocarConfirmacao()
    limparVenda()
    setResumo(r.venda)
  }

  function fechar() {
    const motivo = impedimento()
    if (motivo !== null) {
      if (temFiado && cliente === null) setEscolhendoCliente(true)
      else Alert.alert('Ainda não dá para fechar', motivo)
      return
    }

    const formas = pagamentos
      .map(
        (p) =>
          `${rotuloDaForma(p.forma)}${p.parcelas ? ` em ${p.parcelas}x` : ''}` +
          (pagamentos.length > 1 ? ` ${formatMoney(p.valor)}` : ''),
      )
      .join(' + ')

    const linhas = [
      `${quantidade} item(ns) · ${formatMoney(total)}`,
      descontoCentavos > 0 ? `Desconto de ${formatMoney(descontoCentavos / 100)}.` : null,
      cliente ? `Cliente: ${cliente.nome}.` : null,
      `Pagamento em ${formas}.`,
      falta < 0 ? `Troco: ${formatMoney(-falta / 100)}.` : null,
      /* RF-072: vender fiado para quem esta vencido e decisao do lojista —
         o app avisa, nao proibe. */
      temFiado && vencido !== null && vencido > 0
        ? `\nAtenção: ${cliente?.nome} tem ${formatMoney(vencido)} vencido.`
        : null,
    ].filter((l) => l !== null)

    setConfirmacao(linhas.join('\n'))
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Venda"
        subtitulo={
          quantidade === 0
            ? 'Carrinho vazio'
            : `${quantidade} item(ns)${orcamento ? ` · orçamento nº ${orcamento.number}` : ''}`
        }
        acao={
          <View style={estilos.cabecalhoAcoes}>
            <Botao variante="secundario" onPress={() => setBuscando(true)}>
              Buscar
            </Botao>
            <Botao onPress={() => setLendo(true)}>Bipar</Botao>
          </View>
        }
      />

      {resumo !== null ? <ResumoDaVenda venda={resumo} onFechar={() => setResumo(null)} /> : null}

      {itens.length === 0 ? (
        <Vazio
          titulo="Nada no carrinho"
          descricao="Bipe o código de barras ou busque o produto pelo nome."
          acao={<Botao onPress={() => setLendo(true)}>Bipar produto</Botao>}
        />
      ) : (
        <FlatList
          data={itens}
          keyExtractor={(i) => i.produtoId}
          contentContainerStyle={estilos.lista}
          renderItem={({ item }) => (
            <View style={estilos.item}>
              <View style={estilos.itemInfo}>
                <Text style={estilos.itemNome} numberOfLines={2}>
                  {item.descricao}
                </Text>
                <Text style={estilos.itemUnitario}>{formatMoney(item.precoUnitario)} un</Text>
              </View>

              <View style={estilos.contador}>
                <Pressable
                  onPress={() => mudarQuantidade(item.produtoId, -1)}
                  style={estilos.contadorBotao}
                  accessibilityLabel={`Diminuir ${item.descricao}`}
                >
                  <Text style={estilos.contadorSinal}>−</Text>
                </Pressable>

                <Text style={estilos.contadorValor}>{item.quantidade}</Text>

                <Pressable
                  onPress={() => mudarQuantidade(item.produtoId, 1)}
                  style={estilos.contadorBotao}
                  accessibilityLabel={`Aumentar ${item.descricao}`}
                >
                  <Text style={estilos.contadorSinal}>+</Text>
                </Pressable>
              </View>

              <Text style={estilos.itemSubtotal}>{formatMoney(subtotalItem(item))}</Text>
            </View>
          )}
        />
      )}

      {itens.length > 0 ? (
        <ScrollView
          style={estilos.rodape}
          contentContainerStyle={estilos.rodapeConteudo}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            style={estilos.ajuste}
            onPress={() => setEscolhendoCliente(true)}
            accessibilityRole="button"
            accessibilityLabel="Escolher cliente"
          >
            <Text style={estilos.ajusteRotulo}>Cliente</Text>
            <Text style={estilos.ajusteValor} numberOfLines={1}>
              {cliente?.nome ?? 'Sem cliente'}
            </Text>
            {cliente !== null ? (
              <Pressable
                onPress={() => {
                  setCliente(null)
                  setVencido(null)
                }}
                hitSlop={8}
                accessibilityLabel="Tirar cliente"
              >
                <Text style={estilos.ajusteTirar}>×</Text>
              </Pressable>
            ) : null}
          </Pressable>

          {vencido !== null && vencido > 0 ? (
            <Text style={estilos.aviso}>
              {cliente?.nome} tem {formatMoney(vencido)} vencido.
            </Text>
          ) : null}

          <Pressable
            style={estilos.ajuste}
            onPress={() => setEditandoDesconto(true)}
            accessibilityRole="button"
            accessibilityLabel="Dar desconto"
          >
            <Text style={estilos.ajusteRotulo}>Desconto</Text>
            <Text style={estilos.ajusteValor}>
              {descontoCentavos > 0
                ? `− ${formatMoney(descontoCentavos / 100)}${desconto?.tipo === 'percentual' ? ` (${String(desconto.quantia).replace('.', ',')}%)` : ''}`
                : 'Nenhum'}
            </Text>
          </Pressable>

          {partes === null ? (
            <>
              {/* No balcao todas as formas sao registradas e fecham na hora
                  (ADR-0004). As que um dia abrirem cobranca com QR ficam de fora
                  ate a cobranca existir no app. */}
              <SeletorDeForma valor={forma} onChange={setForma} />

              {forma === 'credito' ? <Parcelas valor={parcelas} onChange={setParcelas} /> : null}

              <Pressable onPress={dividir} accessibilityRole="button">
                <Text style={estilos.link}>Dividir em mais de uma forma</Text>
              </Pressable>
            </>
          ) : (
            <>
              {partes.map((p) => (
                <View key={p.id} style={estilos.parte}>
                  <SeletorDeForma
                    valor={p.forma}
                    onChange={(f) => mudarParte(p.id, { forma: f })}
                  />
                  <View style={estilos.parteLinha}>
                    <TextInput
                      style={estilos.parteValor}
                      value={p.texto}
                      onChangeText={(t) => mudarParte(p.id, { texto: t })}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`Valor em ${rotuloDaForma(p.forma)}`}
                    />
                    {p.forma === 'credito' ? (
                      <Parcelas
                        valor={p.parcelas}
                        onChange={(n) => mudarParte(p.id, { parcelas: n })}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => tirarParte(p.id)}
                      hitSlop={8}
                      accessibilityLabel="Tirar esta forma"
                    >
                      <Text style={estilos.ajusteTirar}>×</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              {falta > 0 ? (
                <Pressable onPress={adicionarParte} accessibilityRole="button">
                  <Text style={estilos.link}>
                    + Outra forma ({formatMoney(falta / 100)} restante)
                  </Text>
                </Pressable>
              ) : falta < 0 ? (
                <Text style={estilos.ajusteRotulo}>
                  {pagamentos.some((p) => p.forma === 'dinheiro')
                    ? `Troco: ${formatMoney(-falta / 100)}`
                    : `Passou do total em ${formatMoney(-falta / 100)}`}
                </Text>
              ) : null}
            </>
          )}

          <View style={estilos.totalLinha}>
            <Text style={estilos.totalRotulo}>Total</Text>
            <Text style={estilos.totalValor}>{formatMoney(total)}</Text>
          </View>

          {/* Salvar o carrinho como orcamento, como no PDV do web — NR-164. */}
          <Botao
            variante="secundario"
            onPress={() => void salvarComoOrcamento()}
            carregando={salvandoOrcamento}
            largura
          >
            Salvar como orçamento
          </Botao>

          <View style={estilos.acoes}>
            <Botao variante="perigo" onPress={cancelar}>
              Cancelar
            </Botao>
            <View style={estilos.acaoPrincipal}>
              {/* O toque duplo aqui e SEGURO por causa da chave de
                  idempotencia — a segunda requisicao devolve a mesma venda. */}
              <Botao onPress={fechar} carregando={fechando} largura>
                {fechando ? 'Fechando...' : 'Fechar venda'}
              </Botao>
            </View>
          </View>
        </ScrollView>
      ) : null}

      {confirmacao !== null ? (
        <ConfirmarModal
          titulo="Fechar a venda"
          mensagem={confirmacao}
          rotuloConfirmar="Fechar"
          onConfirmar={() => void confirmar()}
          onFechar={() => setConfirmacao(null)}
        />
      ) : null}

      <LeitorCodigo
        aberto={lendo}
        onLer={(codigo) => void adicionarPorCodigo(codigo)}
        onFechar={() => setLendo(false)}
      />

      {buscando ? (
        <SeletorProduto
          onEscolher={(p) => {
            adicionarAoCarrinho(p)
            setBuscando(false)
          }}
          onFechar={() => setBuscando(false)}
        />
      ) : null}

      {escolhendoCliente ? (
        <SeletorCliente
          onEscolher={(c) => {
            setVencido(null)
            setCliente({ id: c.id, nome: c.nome, saldoFiado: c.saldoFiado })
            setEscolhendoCliente(false)
          }}
          onFechar={() => setEscolhendoCliente(false)}
        />
      ) : null}

      {editandoDesconto ? (
        <DescontoModal
          atual={desconto}
          subtotal={subtotal}
          onAplicar={(d) => {
            setDesconto(d)
            /* O total mudou: a divisao feita antes nao fecha mais. */
            setPartes(null)
            setEditandoDesconto(false)
          }}
          onFechar={() => setEditandoDesconto(false)}
        />
      ) : null}
    </SafeAreaView>
  )
}

function SeletorDeForma({
  valor,
  onChange,
}: {
  valor: FormaPagamento
  onChange: (forma: FormaPagamento) => void
}) {
  return (
    <View style={estilos.formas}>
      {FORMAS.filter((f) => !f.online).map((f) => (
        <Pressable
          key={f.valor}
          onPress={() => onChange(f.valor)}
          style={[estilos.forma, valor === f.valor && estilos.formaAtiva]}
          accessibilityRole="button"
          accessibilityState={{ selected: valor === f.valor }}
        >
          <Text
            style={[estilos.formaTexto, valor === f.valor && estilos.formaTextoAtivo]}
            numberOfLines={1}
          >
            {f.valor === 'carteira' ? 'Fiado' : f.rotulo}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function Parcelas({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  return (
    <View style={estilos.parcelas}>
      <Text style={estilos.totalRotulo}>Parcelas</Text>
      <View style={estilos.parcelasControle}>
        <Pressable
          onPress={() => onChange(Math.max(1, valor - 1))}
          style={estilos.parcelasBotao}
          accessibilityLabel="Menos parcelas"
        >
          <Text style={estilos.formaTexto}>−</Text>
        </Pressable>
        <Text style={estilos.parcelasValor}>{valor === 1 ? 'À vista' : `${valor}x`}</Text>
        <Pressable
          onPress={() => onChange(Math.min(PARCELAS_MAXIMAS, valor + 1))}
          style={estilos.parcelasBotao}
          accessibilityLabel="Mais parcelas"
        >
          <Text style={estilos.formaTexto}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  /* Resumo da venda — US-020. */
  resumo: {
    ...vidro.painel,
    margin: espaco.lg,
    padding: espaco.lg,
    borderRadius: raio.md,
    gap: espaco.sm,
  },
  resumoTitulo: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },
  resumoAviso: { fontSize: fonte.micro, color: cores.textoFraco },
  resumoLinha: { flexDirection: 'row', justifyContent: 'space-between' },
  resumoRotulo: { fontSize: fonte.pequeno, color: cores.textoFraco },
  resumoValor: { fontSize: fonte.pequeno, color: cores.texto },
  resumoDestaque: { fontWeight: peso.pesado, color: cores.texto },
  resumoMargem: {
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
    color: cores.acento,
    marginTop: espaco.sm,
  },

  /* Etapa fiscal, dentro do resumo — NR-042. */
  fiscalBloco: { gap: espaco.sm, marginTop: espaco.md },
  fiscalTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  fiscalTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  fiscalOk: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  fiscalChave: { fontSize: fonte.micro, color: cores.textoFraco },
  fiscalErro: { fontSize: fonte.micro, color: cores.erro },

  tela: { flex: 1, backgroundColor: cores.fundo },

  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: espaco.lg,
  },
  titulo: { fontSize: fonte.display, fontWeight: peso.pesado, color: cores.texto },
  subtitulo: { fontSize: fonte.pequeno, color: cores.textoFraco },

  lista: {
    paddingHorizontal: espaco.lg,
    gap: espaco.sm,
    paddingBottom: espaco.lg,
  },
  item: {
    ...vidro.peca,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.md,
    borderRadius: raio.md,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  itemUnitario: { fontSize: fonte.micro, color: cores.textoFraco },

  contador: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  contadorBotao: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  contadorSinal: { fontSize: 20, color: cores.texto },
  contadorValor: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  itemSubtotal: {
    minWidth: 72,
    textAlign: 'right',
    fontSize: fonte.corpo,
    fontWeight: peso.forte,
    color: cores.texto,
  },

  cabecalhoAcoes: { flexDirection: 'row', gap: espaco.sm },

  rodape: {
    ...vidro.peca,
    flexGrow: 0,
    maxHeight: '62%',
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  rodapeConteudo: { padding: espaco.lg, gap: espaco.md },
  ajuste: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  ajusteRotulo: { fontSize: fonte.pequeno, color: cores.textoFraco },
  ajusteValor: {
    flex: 1,
    textAlign: 'right',
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  ajusteTirar: { fontSize: 22, color: cores.textoFraco, paddingHorizontal: espaco.xs },
  aviso: {
    padding: espaco.sm,
    borderRadius: raio.sm,
    backgroundColor: cores.atencaoFundo,
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.atencao,
  },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  parte: {
    gap: espaco.sm,
    padding: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  parteLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  parteValor: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    fontSize: fonte.corpo,
    color: cores.texto,
  },
  formas: { flexDirection: 'row', gap: espaco.sm },
  forma: {
    flex: 1,
    paddingVertical: espaco.md,
    paddingHorizontal: 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  formaAtiva: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  formaTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  formaTextoAtivo: { color: cores.acento, fontWeight: peso.forte },

  parcelas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  parcelasControle: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  parcelasBotao: {
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  parcelasValor: {
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
    minWidth: 56,
    textAlign: 'center',
  },

  totalLinha: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  totalRotulo: { fontSize: fonte.corpo, color: cores.textoFraco },
  totalValor: { fontSize: 30, fontWeight: peso.pesado, color: cores.texto },

  acoes: { flexDirection: 'row', gap: espaco.sm },
  acaoPrincipal: { flex: 1 },
})

/**
 * O resumo da venda fechada — US-020, RF-040 a RF-042.
 *
 * Bruto, custo, imposto, tarifa, liquido e margem. Todos vem do SERVIDOR: o
 * imposto usa a aliquota da empresa e a tarifa usa a tabela do cadastro.
 * Recalcular aqui daria dois numeros para a mesma venda, e o que o lojista
 * veria dependeria de qual tela ele abriu.
 *
 * Fica na tela ate ele dispensar. Um alerta que se fecha sozinho nao cumpre
 * "quero ver quanto sobra" — ninguem le liquido de passagem.
 */
function ResumoDaVenda({ venda, onFechar }: { venda: VendaRegistrada; onFechar: () => void }) {
  const margem = margemEmPontos(venda)

  return (
    <View style={estilos.resumo}>
      <Text style={estilos.resumoTitulo}>
        {venda.reenvio ? `Venda ${venda.numero} — já registrada` : `Venda ${venda.numero}`}
      </Text>

      {venda.reenvio ? (
        <Text style={estilos.resumoAviso}>Esta venda já tinha entrado. Nada foi duplicado.</Text>
      ) : null}

      <LinhaResumo rotulo="Bruto" centavos={venda.brutoCentavos} />
      <LinhaResumo rotulo="Custo" centavos={venda.custoCentavos} />
      <LinhaResumo rotulo="Imposto" centavos={venda.impostoCentavos} />
      <LinhaResumo rotulo="Tarifa de cartão" centavos={venda.tarifaCentavos} />
      <LinhaResumo rotulo="Líquido" centavos={venda.liquidoCentavos} destaque />

      <Text style={estilos.resumoMargem}>
        {/* Ponto e virgula na margem: 12,4% e 12,6% sao diferentes na conta do
            mes, e arredondar para inteiro apagaria isso. */}
        Margem: {margem === null ? '—' : `${margem.toString().replace('.', ',')}%`}
      </Text>

      {venda.trocoCentavos > 0 ? (
        <LinhaResumo rotulo="Troco" centavos={venda.trocoCentavos} destaque />
      ) : null}

      <EmissaoFiscal vendaId={venda.id} onConcluir={onFechar} />
    </View>
  )
}

/**
 * A etapa fiscal, dentro do resumo — NR-042, RF-004, RF-045, RF-054.
 *
 * Nao existia NENHUMA tela no celular que oferecesse emitir nota: as funcoes
 * que fariam isso (`emitirNota`, `situacaoCertificado`) eram mock e nenhuma
 * tela as chamava — a venda ficava registrada, e a nota nunca era pedida por
 * aqui, so pelo computador.
 *
 * Mesmo fluxo do web (`EtapaFiscal.tsx`): confere certificado, pede a nota,
 * acompanha ate a SEFAZ responder ou desistir sem tratar isso como erro — a
 * venda ja esta registrada de qualquer jeito.
 */
function EmissaoFiscal({ vendaId, onConcluir }: { vendaId: string; onConcluir: () => void }) {
  const [certificado, setCertificado] = useState<SituacaoCertificado | null>(null)
  const [estado, setEstado] = useState<EstadoEmissao>('ocioso')
  const [nota, setNota] = useState<NotaEmitida | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      /* Reconcilia antes de perguntar o certificado — RF-053. Custa nada
         quando nao ha contingencia: o caso de uso volta sem consultar o
         provedor. */
      await reconciliarContingencia()
      const s = await situacaoCertificado()
      if (!cancelado) setCertificado(s)
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [])

  async function emitir() {
    setEstado('processando')
    setErro(null)

    const pedido = await pedirNota(vendaId)
    if (!pedido.ok) {
      setErro(pedido.erro)
      setEstado('erro')
      return
    }

    /* NFC-e e sincrona no provedor, entao a resposta costuma vir logo — doze
       tentativas de um segundo cobrem uma fila ocupada sem prender a tela.
       Desistir nao e erro: a nota pode sair depois, e a venda ja esta
       registrada. */
    for (let tentativa = 0; tentativa < 12; tentativa += 1) {
      const atual = await estadoDaNota(vendaId)

      if (atual !== null && atual.status !== 'pending') {
        if (atual.status === 'rejected') {
          setErro(atual.rejection.message)
          setEstado('erro')
          return
        }

        setNota({
          tipo: 'nfce',
          numero: String(atual.number),
          chave: atual.accessKey,
          url: atual.status === 'authorized' ? atual.danfeUrl : '',
        })
        setEstado('emitida')
        return
      }

      await new Promise((r) => setTimeout(r, 1000))
    }

    setErro('A nota ainda está sendo processada. Confira o estado dela em Vendas daqui a pouco.')
    setEstado('erro')
  }

  const podeEmitir = certificado === 'valido'

  if (certificado === null) {
    return <Text style={estilos.fiscalTexto}>Verificando certificado digital...</Text>
  }

  if (!podeEmitir) {
    return (
      <View style={estilos.fiscalBloco}>
        <Text style={estilos.fiscalTitulo}>
          {certificado === 'expirado'
            ? 'Certificado digital expirado'
            : 'Nenhum certificado digital cadastrado'}
        </Text>
        <Text style={estilos.fiscalTexto}>
          A venda já está registrada. Cadastre o certificado A1 pelo computador para emitir a nota.
        </Text>
        <Botao variante="secundario" onPress={onConcluir} largura>
          Nova venda
        </Botao>
      </View>
    )
  }

  if (estado === 'emitida' && nota) {
    return (
      <View style={estilos.fiscalBloco}>
        <Text style={estilos.fiscalOk}>NFC-e {nota.numero} emitida</Text>
        <Text style={estilos.fiscalChave}>{nota.chave}</Text>
        <Botao onPress={onConcluir} largura>
          Nova venda
        </Botao>
      </View>
    )
  }

  return (
    <View style={estilos.fiscalBloco}>
      {estado === 'erro' ? (
        <Text style={estilos.fiscalErro}>{erro ?? 'Não foi possível emitir a nota.'}</Text>
      ) : null}

      <Botao onPress={() => void emitir()} carregando={estado === 'processando'} largura>
        {estado === 'processando' ? 'Emitindo...' : 'Emitir NFC-e'}
      </Botao>
      <Botao variante="secundario" onPress={onConcluir} largura>
        Concluir sem nota
      </Botao>
    </View>
  )
}

function LinhaResumo({
  rotulo,
  centavos,
  destaque = false,
}: {
  rotulo: string
  centavos: number
  destaque?: boolean
}) {
  return (
    <View style={estilos.resumoLinha}>
      <Text style={[estilos.resumoRotulo, destaque && estilos.resumoDestaque]}>{rotulo}</Text>
      <Text style={[estilos.resumoValor, destaque && estilos.resumoDestaque]}>
        {formatMoney(centavos / 100)}
      </Text>
    </View>
  )
}
