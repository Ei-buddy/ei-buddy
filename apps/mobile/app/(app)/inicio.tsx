import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { describeDueDate, formatMoney } from '@/lib/format'
import {
  carregarAReceber,
  carregarContasAPagar,
  carregarParaRepor,
  carregarSemana,
  carregarTotaisDoCadastro,
  carregarResumoDoDia,
  carregarSaudacao,
  carregarVendasRecentes,
  type ContaAPagar,
  type DiaDaSemana,
  type ProdutoParaRepor,
  type ResumoDoDia,
  type Saudacao,
  type VendaRecente,
} from '@/lib/inicio-api'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import Botao from '@/components/ui/Botao'
import { Cartao, Etiqueta } from '@/components/ui/Cartao'
import { checklistDispensado, definirMeta, dispensarChecklist, lerMeta } from '@/lib/preferencias'
import { iniciarTutorial, tutorialJaVisto } from '@/lib/tutorial'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Tela principal — NR-013.
 *
 * ## O que esta tela era
 *
 * Tinha `const HOJE = '2026-08-24'` escrito no codigo, abria com "Bom dia,
 * Marina" as onze da noite e somava `lib/mock-data`. Ou seja: data congelada,
 * nome de uma pessoa inventada, saudacao que ignorava a hora, e numeros de uma
 * loja que nao existe. Quem instalasse e vendesse veria exatamente os mesmos
 * valores.
 *
 * ## O desenho
 *
 * No web isto e um painel de mesas lado a lado. No celular vira uma pilha: os
 * numeros do dia sempre a vista no topo, e cada assunto abre so quando
 * interessa.
 *
 * Enquanto carrega, os numeros ficam como ESQUELETO e nao como zero. Zero e uma
 * resposta — "voce nao vendeu nada hoje" — e mostra-la antes de saber faria o
 * lojista abrir o app de manha e levar um susto que nao era verdade.
 *
 * E cada bloco cai sozinho. Sao leituras independentes; se a de contas a pagar
 * falhar, nao ha motivo para esconder o faturamento. Numa rede de balcao isso e
 * o caso comum, e tela que some inteira por causa de um bloco e tela que
 * ninguem confia.
 */

const emReais = (centavos: number) => centavos / 100

type Estado = {
  saudacao: Saudacao | null
  resumo: ResumoDoDia | null
  contas: readonly ContaAPagar[] | null
  totalAPagarCents: number
  vencidas: number
  repor: readonly ProdutoParaRepor[] | null
  vendas: readonly VendaRecente[] | null
  /* O que o painel do web tambem mostra — NR-161. */
  semana: Awaited<ReturnType<typeof carregarSemana>>
  aReceberCents: number | null
  totais: { produtos: number | null; clientes: number | null }
}

const VAZIO: Estado = {
  saudacao: null,
  resumo: null,
  contas: null,
  totalAPagarCents: 0,
  vencidas: 0,
  repor: null,
  vendas: null,
  semana: null,
  aReceberCents: null,
  totais: { produtos: null, clientes: null },
}

export default function Inicio() {
  const router = useRouter()

  const [estado, setEstado] = useState<Estado>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)

  const buscar = useCallback(async () => {
    /* Tudo em paralelo: sao cinco perguntas independentes, e encadea-las
       multiplicaria a espera numa rede de celular por nada. */
    const [saudacao, resumo, aPagar, repor, vendas, semana, aReceberCents, totais] =
      await Promise.all([
        carregarSaudacao(),
        carregarResumoDoDia(),
        carregarContasAPagar(),
        carregarParaRepor(),
        carregarVendasRecentes(),
        carregarSemana(),
        carregarAReceber(),
        carregarTotaisDoCadastro(),
      ])

    setEstado({
      saudacao,
      resumo,
      contas: aPagar.contas,
      totalAPagarCents: aPagar.totalCents,
      vencidas: aPagar.vencidas,
      repor,
      vendas,
      semana,
      aReceberCents,
      totais,
    })
    setCarregando(false)
    setAtualizando(false)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  /* Primeira abertura: o tutorial guiado comeca sozinho, como no web — NR-166. */
  useEffect(() => {
    let cancelado = false
    void tutorialJaVisto().then((visto) => {
      if (!visto && !cancelado) setTimeout(() => iniciarTutorial(), 700)
    })
    return () => {
      cancelado = true
    }
  }, [])

  const recarregar = () => {
    setAtualizando(true)
    void buscar()
  }

  const s = estado.saudacao
  const r = estado.resumo

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={s === null ? 'Olá' : s.nome === null ? s.texto : `${s.texto}, ${s.nome}`}
        subtitulo={s === null ? 'Carregando...' : s.data}
      />

      <ScrollView
        contentContainerStyle={estilos.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={recarregar}
            tintColor={cores.acento}
          />
        }
      >
        {/* Numeros do dia: sempre visiveis, os mesmos quatro do painel do web. */}
        <View style={estilos.indicadores}>
          <View style={estilos.indicadoresLinha}>
            <Indicador
              rotulo="Faturamento hoje"
              valor={r?.faturamentoCents ?? null}
              apoio={
                r?.vendasHoje === null
                  ? undefined
                  : `${r?.vendasHoje ?? 0} vendas${
                      r?.liquidoCents == null
                        ? ''
                        : ` · líquido ${formatMoney(emReais(r.liquidoCents))}`
                    }`
              }
              carregando={carregando}
              destaque
            />
            <Indicador
              rotulo="Ticket médio (bruto)"
              valor={estado.semana?.hoje.averageTicketCents ?? null}
              apoio={
                estado.semana === null
                  ? 'não carregou'
                  : estado.semana.hoje.averageTicketCents === null
                    ? 'sem vendas hoje'
                    : 'por venda'
              }
              carregando={carregando}
            />
          </View>
          <View style={estilos.indicadoresLinha}>
            <Indicador
              rotulo="A receber"
              valor={estado.aReceberCents}
              apoio="em aberto"
              carregando={carregando}
            />
            <Indicador
              rotulo="A pagar"
              valor={r?.aPagarCents ?? null}
              apoio={
                r === null || r.contasVencidas === null
                  ? undefined
                  : r.contasVencidas > 0
                    ? `${r.contasVencidas} vencida(s)`
                    : 'nada vencido'
              }
              alerta={(r?.contasVencidas ?? 0) > 0}
              carregando={carregando}
            />
          </View>
        </View>

        {carregando ? null : (
          <PrimeirosPassos
            totalProdutos={estado.totais.produtos}
            totalClientes={estado.totais.clientes}
            temVenda={(estado.vendas?.length ?? 0) > 0}
          />
        )}

        <MetaDiaria faturamentoHojeCents={carregando ? null : (r?.faturamentoCents ?? null)} />

        {/*
          O atalho principal, com area de toque generosa.
          E o que a pessoa vem fazer: abrir o balcao e vender. Um botao de 40px
          num aplicativo usado com uma mao so, em pe atras do caixa, erra.
        */}
        <Pressable
          style={({ pressed }) => [estilos.atalho, pressed && estilos.atalhoPressionado]}
          onPress={() => router.push('/pdv')}
          accessibilityRole="button"
          accessibilityLabel="Abrir o balcão para bipar produto e fechar venda"
        >
          <Text style={estilos.atalhoTexto}>Abrir o balcão</Text>
          <Text style={estilos.atalhoApoio}>Bipar produto e fechar venda</Text>
        </Pressable>

        <Sanfona
          titulo="Vendas na semana"
          resumo={
            estado.semana === null
              ? '—'
              : formatMoney(emReais(estado.semana.dias.reduce((t, d) => t + d.grossCents, 0)))
          }
          inicialAberta
        >
          {carregando ? null : estado.semana === null ? (
            <Text style={estilos.aviso}>Não deu para carregar o gráfico da semana.</Text>
          ) : (
            <Grafico dias={estado.semana.dias} />
          )}
          <Text style={estilos.subtitulo}>Últimas vendas</Text>
          <Lista
            itens={estado.vendas}
            carregando={carregando}
            vazio="Nenhuma venda ainda. A primeira aparece aqui."
            erro="Não deu para carregar as vendas."
            chave={(v) => v.id}
          >
            {(v) => (
              <View style={estilos.linha}>
                <Text style={estilos.linhaId}>#{v.number}</Text>
                <Text style={estilos.linhaTexto} numberOfLines={1}>
                  {v.customerName ?? 'Venda de balcão'}
                </Text>
                <Text style={estilos.linhaValor}>
                  {formatMoney(emReais(v.grossAmountCents - v.discountCents))}
                </Text>
              </View>
            )}
          </Lista>
          <VerMais rotulo="Ver todas as vendas" onPress={() => router.push('/vendas')} />
        </Sanfona>

        <Sanfona
          titulo="Próximos vencimentos"
          resumo={estado.contas === null ? '—' : formatMoney(emReais(estado.totalAPagarCents))}
          etiqueta={
            estado.vencidas > 0 ? (
              <Etiqueta tom="atencao">{estado.vencidas} vencida</Etiqueta>
            ) : undefined
          }
        >
          <Lista
            itens={estado.contas}
            carregando={carregando}
            vazio="Nenhuma conta em aberto."
            erro="Não deu para carregar as contas."
            chave={(c) => c.id}
            limite={4}
          >
            {(c) => (
              <View style={estilos.linha}>
                <View style={estilos.linhaInfo}>
                  <Text style={estilos.linhaTexto} numberOfLines={1}>
                    {c.supplier}
                  </Text>
                  <Text style={estilos.linhaApoio}>{describeDueDate(c.dueDate)}</Text>
                </View>
                <Text style={estilos.linhaValor}>
                  {formatMoney(emReais(c.amountCents - c.settledAmountCents))}
                </Text>
              </View>
            )}
          </Lista>
          <VerMais rotulo="Ver todas as contas" onPress={() => router.push('/contas-a-pagar')} />
        </Sanfona>

        <Sanfona
          titulo="Precisa de reposição"
          resumo={estado.repor === null ? '—' : `${estado.repor.length} produto(s)`}
          etiqueta={
            (r?.produtosEsgotados ?? 0) > 0 ? (
              <Etiqueta tom="erro">{r?.produtosEsgotados} esgotado(s)</Etiqueta>
            ) : (estado.repor?.length ?? 0) > 0 ? (
              <Etiqueta tom="atencao">estoque baixo</Etiqueta>
            ) : undefined
          }
        >
          <Lista
            itens={estado.repor}
            carregando={carregando}
            vazio="Nada abaixo do mínimo. Estoque em ordem."
            erro="Não deu para carregar o estoque."
            chave={(p) => p.id}
          >
            {(p) => (
              <View style={estilos.linha}>
                <View style={estilos.linhaInfo}>
                  <Text style={estilos.linhaTexto} numberOfLines={1}>
                    {p.description}
                  </Text>
                  <Text style={estilos.linhaApoio}>mínimo {p.minStock} un</Text>
                </View>
                <Text style={[estilos.linhaValor, estilos.alerta]}>{p.stock} un</Text>
              </View>
            )}
          </Lista>
          <VerMais rotulo="Ver catálogo" onPress={() => router.push('/catalogo')} />
        </Sanfona>
      </ScrollView>
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */

function VerMais({ rotulo, onPress }: { rotulo: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={estilos.verMais}>
      <Text style={estilos.verMaisTexto}>{rotulo} →</Text>
    </Pressable>
  )
}

/**
 * As barras da semana — o mesmo grafico do painel do web.
 *
 * A altura e relativa ao MAIOR dia, como no web: o que se quer ver de relance
 * e qual dia vendeu mais. Semana sem venda deixa todas as barras no chao.
 */
function Grafico({ dias }: { dias: readonly DiaDaSemana[] }) {
  const maior = Math.max(...dias.map((d) => d.grossCents), 0)
  return (
    <View style={estilos.grafico}>
      {dias.map((d) => (
        <View
          key={d.dia}
          style={estilos.graficoColuna}
          accessible
          accessibilityLabel={`${d.rotulo}: ${formatMoney(emReais(d.grossCents))} em ${d.salesCount} vendas`}
        >
          <View style={estilos.graficoTrilho}>
            <View
              style={[
                estilos.graficoBarra,
                { height: maior === 0 ? 0 : `${(d.grossCents / maior) * 100}%` },
              ]}
            />
          </View>
          <Text style={estilos.graficoDia}>{d.rotulo}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * "Primeiros passos" — o mesmo checklist do web (NR-104). Some quando os tres
 * passos estao feitos ou quando a pessoa dispensa.
 */
function PrimeirosPassos({
  totalProdutos,
  totalClientes,
  temVenda,
}: {
  totalProdutos: number | null
  totalClientes: number | null
  temVenda: boolean
}) {
  const router = useRouter()
  const [dispensado, setDispensado] = useState(true)

  useEffect(() => {
    void checklistDispensado().then(setDispensado)
  }, [])

  const itens = [
    {
      titulo: 'Cadastre seu primeiro produto',
      feito: (totalProdutos ?? 0) > 0,
      rota: '/produto-novo',
    },
    {
      titulo: 'Cadastre seu primeiro cliente',
      feito: (totalClientes ?? 0) > 0,
      rota: '/cliente-form',
    },
    { titulo: 'Registre sua primeira venda', feito: temVenda, rota: '/pdv' },
  ] as const
  const feitos = itens.filter((i) => i.feito).length
  if (dispensado || feitos === itens.length) return null

  return (
    <Cartao
      titulo="Primeiros passos"
      acao={
        <Pressable
          onPress={() => {
            setDispensado(true)
            void dispensarChecklist()
          }}
          accessibilityRole="button"
          accessibilityLabel="Dispensar primeiros passos"
          hitSlop={10}
        >
          <Text style={estilos.fechar}>✕</Text>
        </Pressable>
      }
    >
      <Text style={estilos.apoio}>
        {feitos} de {itens.length} concluídos
      </Text>
      {itens.map((i) =>
        i.feito ? (
          <View key={i.titulo} style={estilos.passo}>
            <Text style={estilos.passoFeito}>✓ {i.titulo}</Text>
          </View>
        ) : (
          <Pressable
            key={i.titulo}
            onPress={() => router.push(i.rota)}
            accessibilityRole="link"
            style={estilos.passo}
          >
            <View style={estilos.bolinha} />
            <Text style={estilos.passoTexto}>{i.titulo}</Text>
          </Pressable>
        ),
      )}
    </Cartao>
  )
}

/**
 * A meta diaria de faturamento — a mesma do web (NR-104), guardada no
 * aparelho. Sem meta, um convite; com meta, a barra de progresso.
 */
function MetaDiaria({ faturamentoHojeCents }: { faturamentoHojeCents: number | null }) {
  const [meta, setMeta] = useState<number | null>(null)
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')

  useEffect(() => {
    void lerMeta().then(setMeta)
  }, [])

  function editar() {
    setValor(meta === null ? '' : (meta / 100).toFixed(2).replace('.', ','))
    setEditando(true)
  }

  async function salvar() {
    const centavos = centavosDoTexto(valor)
    const nova = centavos !== null && centavos > 0 ? centavos : null
    await definirMeta(nova)
    setMeta(nova)
    setEditando(false)
  }

  if (editando) {
    return (
      <Cartao titulo="Meta diária de faturamento">
        <View style={estilos.metaLinha}>
          <Text style={estilos.apoio}>R$</Text>
          <TextInput
            style={estilos.metaInput}
            value={valor}
            onChangeText={setValor}
            keyboardType="decimal-pad"
            placeholder="0,00"
            placeholderTextColor={cores.textoFraco}
            accessibilityLabel="Meta diária de faturamento"
            autoFocus
          />
        </View>
        <View style={estilos.metaAcoes}>
          <Botao variante="secundario" onPress={() => setEditando(false)}>
            Cancelar
          </Botao>
          <Botao onPress={() => void salvar()}>Salvar</Botao>
        </View>
      </Cartao>
    )
  }

  if (meta === null) {
    return (
      <Pressable onPress={editar} accessibilityRole="button" style={estilos.metaConvite}>
        <Text style={estilos.apoio}>
          Defina uma meta diária de faturamento para acompanhar seu progresso aqui.
        </Text>
        <Text style={estilos.verMaisTexto}>Definir meta</Text>
      </Pressable>
    )
  }

  const bateu = faturamentoHojeCents !== null && faturamentoHojeCents >= meta
  const progresso =
    faturamentoHojeCents === null ? 0 : Math.min(100, (faturamentoHojeCents / meta) * 100)
  const faltam = faturamentoHojeCents === null ? null : Math.max(0, meta - faturamentoHojeCents)

  return (
    <Cartao
      titulo={bateu ? 'Meta do dia batida! 🎉' : 'Meta do dia'}
      acao={
        <Pressable onPress={editar} accessibilityRole="button" hitSlop={10}>
          <Text style={estilos.verMaisTexto}>Editar meta</Text>
        </Pressable>
      }
    >
      <View style={estilos.metaTrilho}>
        <View
          style={[
            estilos.metaBarra,
            bateu && estilos.metaBarraCompleta,
            { width: `${progresso}%` },
          ]}
        />
      </View>
      <Text style={estilos.apoio}>
        {faturamentoHojeCents === null
          ? `Meta: ${formatMoney(emReais(meta))} · ainda não deu para saber quanto você já vendeu hoje`
          : bateu
            ? `${formatMoney(emReais(faturamentoHojeCents))} de ${formatMoney(emReais(meta))}`
            : `${formatMoney(emReais(faturamentoHojeCents))} de ${formatMoney(emReais(meta))} · faltam ${formatMoney(emReais(faltam ?? 0))}`}
      </Text>
    </Cartao>
  )
}

/**
 * Uma lista com os tres desfechos que ela pode ter.
 *
 * Carregando, vazia e quebrada sao coisas DIFERENTES, e a maioria dos apps
 * mostra a mesma coisa nas tres — normalmente nada. "Nenhuma conta em aberto" e
 * uma boa noticia; "nao deu para carregar" e um problema. Trocar uma pela outra
 * faz o lojista tomar decisao com base numa lista que nao carregou.
 */
function Lista<T>({
  itens,
  carregando,
  vazio,
  erro,
  chave,
  limite,
  children,
}: {
  itens: readonly T[] | null
  carregando: boolean
  vazio: string
  erro: string
  chave: (item: T) => string
  limite?: number
  children: (item: T) => React.ReactElement
}) {
  if (carregando) {
    return (
      <View>
        {[0, 1, 2].map((i) => (
          <View key={i} style={estilos.linha}>
            <View style={estilos.esqueleto} />
          </View>
        ))}
      </View>
    )
  }

  if (itens === null) return <Text style={estilos.aviso}>{erro}</Text>
  if (itens.length === 0) return <Text style={estilos.aviso}>{vazio}</Text>

  const mostrar = limite === undefined ? itens : itens.slice(0, limite)

  return (
    <View>
      {mostrar.map((item) => (
        <View key={chave(item)}>{children(item)}</View>
      ))}
    </View>
  )
}

/**
 * Um numero do dia.
 *
 * Enquanto carrega mostra um esqueleto, e nao zero. Zero e uma resposta — "voce
 * nao vendeu nada" — e mostra-la antes de saber daria um susto falso a quem
 * abre o app de manha.
 *
 * Quando a leitura falha mostra um travessao. Nao inventar numero e mais util
 * que inventar: o travessao diz "nao sei", e a pessoa recarrega.
 */
function Indicador({
  rotulo,
  valor,
  contagem,
  apoio,
  destaque = false,
  alerta = false,
  carregando = false,
}: {
  rotulo: string
  /** Em centavos. */
  valor?: number | null
  /** Numero puro, quando o indicador nao e dinheiro. */
  contagem?: number | null
  apoio?: string | undefined
  destaque?: boolean
  alerta?: boolean
  carregando?: boolean
}) {
  const texto =
    valor !== undefined
      ? valor === null
        ? '—'
        : formatMoney(emReais(valor))
      : contagem === null || contagem === undefined
        ? '—'
        : String(contagem)

  return (
    <View style={[estilos.indicador, destaque && estilos.indicadorDestaque]}>
      <Text style={estilos.indicadorRotulo}>{rotulo}</Text>

      {carregando ? (
        <View style={[estilos.esqueleto, estilos.esqueletoValor]} />
      ) : (
        <Text
          style={[
            estilos.indicadorValor,
            destaque && estilos.indicadorValorDestaque,
            alerta && estilos.alerta,
          ]}
          /* O numero encolhe em vez de quebrar linha: um faturamento de sete
             digitos nao pode desalinhar o cartao ao lado. */
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {texto}
        </Text>
      )}

      {apoio !== undefined && !carregando ? (
        <Text style={estilos.indicadorApoio}>{apoio}</Text>
      ) : null}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.md, gap: espaco.md, paddingBottom: espaco.xxl },

  indicadores: { gap: espaco.sm },
  indicadoresLinha: { flexDirection: 'row', gap: espaco.sm },
  indicador: {
    ...vidro.peca,
    flex: 1,
    minWidth: 0,
    padding: espaco.md,
    borderRadius: raio.md,
  },
  /*
   * `acento` e nao `primaria`: `primaria` fica a 1,2:1 da superficie do
   * cartao, entao a borda que deveria DESTACAR era invisivel — o indicador em
   * destaque nao se distinguia dos outros.
   */
  indicadorDestaque: { borderColor: cores.acento },
  indicadorRotulo: { fontSize: fonte.micro, color: cores.textoFraco },
  indicadorValor: {
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
    marginTop: espaco.xs,
  },
  /*
   * O numero mais importante da tela inicial estava a 1,2:1 do proprio cartao:
   * ilegivel. `primaria` e cor de tema claro e nao serve como texto no escuro
   * — ha teste em `packages/ui` que impede a tentativa.
   */
  indicadorValorDestaque: { fontSize: fonte.titulo, color: cores.acento },
  indicadorApoio: { fontSize: fonte.micro, color: cores.textoFraco, marginTop: espaco.xs },
  alerta: { color: cores.erro },

  atalho: {
    padding: espaco.lg,
    /* Area de toque generosa: e o que a pessoa vem fazer, e ela faz em pe,
       com uma mao, atras do caixa. */
    minHeight: 72,
    justifyContent: 'center',
    borderRadius: raio.md,
    /*
     * O azul de vidro, como no `Botao` primario (NR-160), com texto BRANCO.
     *
     * Ja houve divergencia aqui: com `primaria` e o texto quase preto do
     * acento, o rotulo ficava a 1,12:1 e a acao principal da tela inicial era
     * ilegivel. Fundo e texto vem sempre em par — `vidro.ativo` com
     * `textoSobreAtivo`, medido em `packages/ui`.
     */
    ...vidro.ativo,
  },
  atalhoPressionado: { opacity: 0.85 },
  atalhoTexto: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.textoSobreAtivo },
  atalhoApoio: { fontSize: fonte.pequeno, color: cores.textoSobreAtivo, opacity: 0.85 },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  linhaId: { fontSize: fonte.micro, color: cores.textoFraco, minWidth: 34 },
  linhaInfo: { flex: 1, minWidth: 0 },
  linhaTexto: { flex: 1, minWidth: 0, fontSize: fonte.pequeno, color: cores.texto },
  linhaApoio: { fontSize: fonte.micro, color: cores.textoFraco },
  linhaValor: { fontSize: fonte.pequeno, color: cores.texto },

  esqueleto: {
    height: 12,
    flex: 1,
    borderRadius: raio.sm,
    backgroundColor: cores.borda,
  },
  esqueletoValor: { height: 22, marginTop: espaco.xs, flex: 0, width: '70%' },

  aviso: { fontSize: fonte.pequeno, color: cores.textoFraco, paddingVertical: espaco.sm },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  subtitulo: {
    marginTop: espaco.md,
    marginBottom: espaco.xs,
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  verMais: {
    alignSelf: 'flex-end',
    paddingTop: espaco.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  verMaisTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },

  grafico: { flexDirection: 'row', alignItems: 'flex-end', gap: espaco.sm, height: 132 },
  graficoColuna: { flex: 1, alignItems: 'center', gap: espaco.xs, height: '100%' },
  graficoTrilho: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    overflow: 'hidden',
  },
  graficoBarra: { width: '100%', borderRadius: raio.sm, backgroundColor: cores.acento },
  graficoDia: { fontSize: fonte.micro, color: cores.textoFraco },

  fechar: { fontSize: fonte.corpo, color: cores.textoFraco },
  passo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, minHeight: 40 },
  bolinha: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: cores.acento,
  },
  passoTexto: { fontSize: fonte.pequeno, color: cores.texto },
  passoFeito: { fontSize: fonte.pequeno, color: cores.sucesso },

  metaConvite: {
    ...vidro.peca,
    gap: espaco.xs,
    padding: espaco.lg,
    borderRadius: raio.lg,
  },
  metaLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  metaInput: {
    ...vidro.campo,
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: espaco.md,
    borderRadius: raio.sm,
    fontSize: fonte.corpo,
    color: cores.texto,
  },
  metaAcoes: { flexDirection: 'row', justifyContent: 'flex-end', gap: espaco.sm },
  metaTrilho: {
    height: 10,
    borderRadius: raio.pill,
    backgroundColor: cores.campo,
    overflow: 'hidden',
  },
  metaBarra: { height: '100%', borderRadius: raio.pill, backgroundColor: cores.ativo },
  metaBarraCompleta: { backgroundColor: cores.acento },
}))
