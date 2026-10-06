import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  carregarFaturamento,
  carregarRankingDeClientes,
  carregarRankingDeProdutos,
  type Faturamento,
  type RankingDeClientes,
  type RankingDeProdutos,
} from '@/lib/relatorios-api'
import { ultimosMeses } from '@/lib/periodo'
import { formatMoney } from '@/lib/format'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Faturamento e rankings — NR-077, US-041.
 *
 * ## O celular escolhe entre dois recortes, e nao entre infinitos
 *
 * "Ultimos 6 meses" ou "ultimos 12". Dois seletores de data num telefone, para
 * uma pergunta que quase sempre e "como o negocio vem indo", trocam um toque
 * por seis. Quem precisar de recorte fino abre o web — o mesmo criterio da tela
 * de Resultado, e esta dito aqui para nao parecer esquecimento.
 *
 * ## A tela nao soma nada
 *
 * Ticket medio, meses zerados e a ordem dos rankings chegam prontos da api. Sao
 * os mesmos numeros do web e do assistente; repetir a conta aqui apareceria
 * como o celular e o computador discordando sobre o mesmo mes.
 */

const emReais = (centavos: number) => centavos / 100

const NOME_DO_MES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

/** '2026-03' vira 'mar/26'. Sem `Date`: aqui nao existe instante nenhum. */
function rotuloDoMes(month: string): string {
  const [ano, mes] = month.split('-')
  const indice = Number(mes) - 1
  return `${NOME_DO_MES[indice] ?? mes}/${(ano ?? '').slice(2)}`
}

type Recorte = 6 | 12

type Dados = {
  readonly faturamento: Faturamento
  readonly clientes: RankingDeClientes
  readonly produtos: RankingDeProdutos
}

export default function Relatorios() {
  const [recorte, setRecorte] = useState<Recorte>(6)
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(async (meses: Recorte) => {
    const { de, ate } = ultimosMeses(meses)

    /* As tres em paralelo: sao leituras independentes do mesmo periodo, e
       encadea-las triplicaria a espera numa rede de celular. */
    const [f, c, p] = await Promise.all([
      carregarFaturamento(de, ate),
      carregarRankingDeClientes(de, ate),
      carregarRankingDeProdutos(de, ate),
    ])

    setCarregando(false)
    setAtualizando(false)

    /* Uma que falhe derruba a tela inteira: mostrar um ranking ao lado de um
       faturamento que nao carregou faria o lojista concluir que os numeros nao
       batem. */
    if (!f.ok) {
      setErro(f.erro)
      return
    }
    if (!c.ok) {
      setErro(c.erro)
      return
    }
    if (!p.ok) {
      setErro(p.erro)
      return
    }

    setErro(null)
    setDados({ faturamento: f.dados, clientes: c.dados, produtos: p.dados })
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar(recorte)
    })()
  }, [recorte, buscar])

  const trocar = (meses: Recorte) => {
    if (meses === recorte) return
    setCarregando(true)
    setRecorte(meses)
  }

  const recarregar = () => {
    setAtualizando(true)
    void buscar(recorte)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Relatórios" subtitulo="Quanto entrou, e por conta de quem" />

      <View style={estilos.abas}>
        {([6, 12] as const).map((meses) => (
          <Pressable
            key={meses}
            onPress={() => trocar(meses)}
            style={[estilos.aba, recorte === meses && estilos.abaAtiva]}
            accessibilityRole="tab"
            accessibilityState={{ selected: recorte === meses }}
          >
            <Text style={[estilos.abaTexto, recorte === meses && estilos.abaTextoAtivo]}>
              {meses} meses
            </Text>
          </Pressable>
        ))}
      </View>

      {carregando ? (
        <View style={estilos.centro}>
          <ActivityIndicator color={cores.acento} />
        </View>
      ) : erro !== null ? (
        <View style={estilos.centro}>
          <Vazio
            titulo="Não deu para montar os relatórios"
            descricao={erro}
            acao={
              <Botao
                variante="secundario"
                onPress={() => {
                  setCarregando(true)
                  setErro(null)
                  void buscar(recorte)
                }}
              >
                Tentar de novo
              </Botao>
            }
          />
        </View>
      ) : dados === null ? null : (
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
          <Cartao>
            <Text style={estilos.totalRotulo}>Faturamento líquido do período</Text>
            <Text style={estilos.totalValor}>
              {formatMoney(emReais(dados.faturamento.totalNetCents))}
            </Text>
            <Text style={estilos.totalBruto}>
              Bruto{' '}
              {formatMoney(
                emReais(dados.faturamento.months.reduce((acc, m) => acc + m.grossCents, 0)),
              )}
            </Text>
            <Text style={estilos.legenda}>
              Bruto é o valor das vendas antes do desconto. Líquido é o que sobra depois do
              desconto, do imposto e da taxa de cartão.
            </Text>
          </Cartao>

          <MesAMes meses={dados.faturamento.months} />
          <Clientes dados={dados.clientes} />
          <Produtos dados={dados.produtos} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */

/**
 * A serie, do mes mais recente para o mais antigo.
 *
 * Invertida em relacao ao que a api manda: no celular o que se ve sem rolar e o
 * topo, e o mes que interessa e o de agora. No web a ordem cronologica funciona
 * porque a tabela inteira cabe na tela.
 *
 * A barra e DECORACAO — o valor esta escrito por extenso na mesma linha.
 */
function MesAMes({ meses }: { meses: readonly Faturamento['months'][number][] }) {
  const maior = Math.max(...meses.map((m) => m.netCents), 0)

  return (
    <Cartao titulo="Mês a mês">
      {[...meses].reverse().map((m) => (
        <View key={m.month} style={estilos.mes}>
          <View style={estilos.mesTopo}>
            <Text style={[estilos.mesNome, m.salesCount === 0 && estilos.mesParado]}>
              {rotuloDoMes(m.month)}
            </Text>
            <Text style={[estilos.mesValor, m.salesCount === 0 && estilos.mesParado]}>
              {formatMoney(emReais(m.netCents))}
            </Text>
          </View>

          <View style={estilos.barraCaixa}>
            <View
              style={[
                estilos.barra,
                { width: maior === 0 ? '0%' : `${(m.netCents / maior) * 100}%` },
              ]}
            />
          </View>

          {/*
            Mes parado aparece PARADO, e nao ausente (US-041). E o ticket medio
            vem nulo, e nao zero: "R$ 0,00" diria que houve venda de valor
            nenhum.
          */}
          <Text style={estilos.mesDetalhe}>
            {m.salesCount === 0
              ? 'Sem venda neste mês'
              : `${m.salesCount} ${m.salesCount === 1 ? 'venda' : 'vendas'} · bruto ${formatMoney(
                  emReais(m.grossCents),
                )} · ticket médio ${formatMoney(emReais(m.averageTicketCents ?? 0))}`}
          </Text>
        </View>
      ))}
    </Cartao>
  )
}

/**
 * O que ficou de fora do ranking, dito em voz alta.
 *
 * Sem esta linha o lojista soma as posicoes, compara com o faturamento e
 * conclui que um dos dois esta errado. Com ela, descobre quanto passou pelo
 * balcao sem identificacao — informacao de negocio, e nao rodape tecnico.
 */
function Sobra({ rotulo, cents }: { rotulo: string; cents: number }) {
  if (cents === 0) return null

  return (
    <Text style={estilos.sobra}>
      {rotulo}: {formatMoney(emReais(cents))}
    </Text>
  )
}

function Clientes({ dados }: { dados: RankingDeClientes }) {
  return (
    <Cartao titulo="Quem mais comprou">
      {dados.customers.length === 0 ? (
        <Text style={estilos.aviso}>Nenhuma venda com cliente identificado no período.</Text>
      ) : (
        dados.customers.map((c, i) => (
          <View key={c.customerId} style={estilos.posicao}>
            <Text style={estilos.lugar}>{i + 1}</Text>
            <View style={estilos.posicaoTexto}>
              <Text style={estilos.nome} numberOfLines={1}>
                {c.customerName}
              </Text>
              <Text style={estilos.detalhe}>
                {c.salesCount} {c.salesCount === 1 ? 'compra' : 'compras'}
              </Text>
            </View>
            <Text style={estilos.posicaoValor}>{formatMoney(emReais(c.netCents))}</Text>
          </View>
        ))
      )}

      <Sobra rotulo="Balcão, sem cliente identificado" cents={dados.unidentifiedCents} />
    </Cartao>
  )
}

function Produtos({ dados }: { dados: RankingDeProdutos }) {
  return (
    <Cartao titulo="O que mais saiu">
      {dados.products.length === 0 ? (
        <Text style={estilos.aviso}>Nenhum produto do cadastro foi vendido no período.</Text>
      ) : (
        dados.products.map((p, i) => (
          <View key={p.productId} style={estilos.posicao}>
            <Text style={estilos.lugar}>{i + 1}</Text>
            <View style={estilos.posicaoTexto}>
              <Text style={estilos.nome} numberOfLines={1}>
                {p.productName}
              </Text>
              <Text style={estilos.detalhe}>
                {p.quantity} {p.quantity === 1 ? 'unidade' : 'unidades'}
              </Text>
            </View>
            <Text style={estilos.posicaoValor}>{formatMoney(emReais(p.netCents))}</Text>
          </View>
        ))
      )}

      <Sobra rotulo="Venda avulsa, sem produto no cadastro" cents={dados.unlinkedCents} />
    </Cartao>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.lg },
  conteudo: { padding: espaco.md, gap: espaco.md, paddingBottom: espaco.xxl },

  abas: {
    flexDirection: 'row',
    gap: espaco.sm,
    paddingHorizontal: espaco.md,
    paddingBottom: espaco.sm,
  },
  aba: {
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  /* `acento`: com `primaria`, o rotulo da aba ativa (`textoSobreAcento`,
     quase preto) ficava a 1,12:1 — a aba selecionada era a unica ilegivel. */
  abaAtiva: { backgroundColor: cores.acento, borderColor: cores.acento },
  abaTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  abaTextoAtivo: { color: cores.textoSobreAcento, fontWeight: peso.forte },

  totalRotulo: { fontSize: fonte.pequeno, color: cores.textoFraco },
  totalValor: {
    fontSize: fonte.display,
    fontWeight: peso.pesado,
    color: cores.texto,
    marginTop: espaco.xs,
  },
  totalBruto: { fontSize: fonte.corpo, color: cores.texto, marginTop: espaco.xs },
  legenda: { fontSize: fonte.micro, color: cores.textoFraco, marginTop: espaco.sm },

  mes: { paddingVertical: espaco.sm },
  mesTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mesNome: { fontSize: fonte.corpo, color: cores.texto, fontWeight: peso.medio },
  mesValor: { fontSize: fonte.corpo, color: cores.texto },
  mesParado: { color: cores.textoFraco },
  mesDetalhe: { fontSize: fonte.micro, color: cores.textoFraco, marginTop: espaco.xs },

  barraCaixa: {
    height: 6,
    marginTop: espaco.xs,
    borderRadius: raio.pill,
    backgroundColor: cores.borda,
    overflow: 'hidden',
  },
  /*
   * `acento` e nao `primaria`. Medido: `primaria` contra a trilha da barra da
   * **1,06:1** — a barra era indistinguivel do proprio trilho onde ela corre.
   *
   * Nao e violacao de WCAG, porque a barra e decorativa e o valor esta escrito
   * por extenso ao lado. Mas barra que nao se ve nao e decoracao, e ausencia:
   * ela existe para o olho comparar os meses de relance, e a 1,06:1 nao
   * comparava nada. Com `acento`, 5,80:1.
   */
  barra: { height: '100%', borderRadius: raio.pill, backgroundColor: cores.acento },

  posicao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  lugar: {
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    minWidth: 18,
  },
  posicaoTexto: { flex: 1 },
  nome: { fontSize: fonte.corpo, color: cores.texto },
  detalhe: { fontSize: fonte.micro, color: cores.textoFraco },
  posicaoValor: { fontSize: fonte.pequeno, color: cores.texto },

  sobra: {
    fontSize: fonte.micro,
    color: cores.textoFraco,
    marginTop: espaco.sm,
    paddingTop: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },

  aviso: { fontSize: fonte.pequeno, color: cores.textoFraco },
})
