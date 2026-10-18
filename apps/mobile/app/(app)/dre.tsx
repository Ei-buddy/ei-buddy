import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  carregarDre,
  type Dre,
  type LinhaDoDre,
  mesLocal,
  type TipoDeConta,
} from '@/lib/contabilidade-api'
import { formatMoney } from '@/lib/format'
import BotoesExportar from '@/components/BotoesExportar'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Resultado do periodo — NR-077, RF-085, RF-086. US-041.
 *
 * ## Por que o celular mostra o mes, e so o mes
 *
 * No web o lojista escolhe qualquer periodo com dois campos de data. Aqui ele
 * escolhe entre ESTE mes e o ANTERIOR, e nada mais. Dois seletores de data num
 * telefone, para uma pergunta que quase sempre e "como foi o mes", trocam um
 * toque por seis — e a comparacao com o mes passado, que e o que se quer de
 * fato, viraria uma conta de cabeca.
 *
 * Quem precisar de recorte fino abre o web. Isso esta dito aqui para nao
 * parecer esquecimento.
 *
 * ## A tela nao calcula nada
 *
 * A ordem das subtracoes vem de `domain` e chega pronta. Repetir a aritmetica
 * aqui daria uma segunda resposta para "o mes fechou no azul" — e a divergencia
 * apareceria como o app e o computador discordando sobre o mesmo mes.
 */

const emReais = (centavos: number) => centavos / 100

const ROTULO_DO_TIPO: Record<TipoDeConta, string> = {
  revenue: 'Receita',
  deduction: 'Dedução',
  cost: 'Custo',
  expense: 'Despesa',
}

/** O mes anterior ao de uma data, em `AAAA-MM-DD`. */
function mesAnterior(agora = new Date()): { de: string; ate: string } {
  /* Dia 1 antes de voltar o mes: em 31 de marco, `setMonth(mes - 1)` daria 3 de
     marco, porque fevereiro nao tem 31. O dia 1 existe em todo mes. */
  const primeiro = new Date(agora.getFullYear(), agora.getMonth(), 1)
  primeiro.setMonth(primeiro.getMonth() - 1)
  return mesLocal(primeiro)
}

type Recorte = 'atual' | 'anterior'

export default function Relatorio() {
  const [recorte, setRecorte] = useState<Recorte>('atual')
  const [dre, setDre] = useState<Dre | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [detalhando, setDetalhando] = useState<TipoDeConta | null>(null)

  const buscar = useCallback(async (qual: Recorte) => {
    const periodo = qual === 'atual' ? mesLocal() : mesAnterior()
    const r = await carregarDre(periodo.de, periodo.ate)

    setCarregando(false)
    setAtualizando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setDre(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar(recorte)
    })()
  }, [recorte, buscar])

  const trocar = (qual: Recorte) => {
    if (qual === recorte) return
    setCarregando(true)
    setDetalhando(null)
    setRecorte(qual)
  }

  const recarregar = () => {
    setAtualizando(true)
    void buscar(recorte)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Resultado"
        subtitulo="Quanto sobrou no período"
        acao={
          dre === null ? undefined : (
            <BotoesExportar lista="dre" filtros={{ from: dre.from, to: dre.to }} />
          )
        }
      />

      <View style={estilos.abas}>
        {(['atual', 'anterior'] as const).map((qual) => (
          <Pressable
            key={qual}
            onPress={() => trocar(qual)}
            style={[estilos.aba, recorte === qual && estilos.abaAtiva]}
            accessibilityRole="tab"
            accessibilityState={{ selected: recorte === qual }}
          >
            <Text style={[estilos.abaTexto, recorte === qual && estilos.abaTextoAtivo]}>
              {qual === 'atual' ? 'Este mês' : 'Mês passado'}
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
            titulo="Não deu para montar o resultado"
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
      ) : dre === null ? null : (
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
          {/*
            O resultado primeiro, e grande. No celular a tela abre com uma
            pergunta so na cabeca do lojista, e ela e esta — as parcelas que
            levam ate ele vem abaixo, para quem quiser conferir.
          */}
          <Cartao>
            <Text style={estilos.resultadoRotulo}>Resultado do período</Text>
            <Text
              style={[estilos.resultadoValor, dre.resultCents < 0 && estilos.resultadoNegativo]}
            >
              {formatMoney(emReais(dre.resultCents))}
            </Text>
            <Text style={estilos.margem}>
              {dre.grossMarginPoints === null
                ? 'Sem receita no período'
                : `Margem bruta de ${dre.grossMarginPoints}%`}
            </Text>
          </Cartao>

          {/*
            Zeros EXPLICITOS quando nao houve movimento (US-041), e nao um
            estado vazio: "Receita R$ 0,00" responde a pergunta, "sem dados"
            deixa o lojista sem saber se o mes foi parado ou se o app quebrou.
          */}
          <Cartao titulo="Como se chega lá">
            {[
              { rotulo: 'Receita bruta', valor: dre.grossRevenueCents },
              { rotulo: 'Deduções', valor: dre.deductionsCents, subtrai: true },
              { rotulo: 'Receita líquida', valor: dre.netRevenueCents, total: true },
              { rotulo: 'Custo', valor: dre.costCents, subtrai: true },
              { rotulo: 'Lucro bruto', valor: dre.grossProfitCents, total: true },
              { rotulo: 'Despesas', valor: dre.expensesCents, subtrai: true },
            ].map((l) => (
              <View key={l.rotulo} style={[estilos.linha, l.total === true && estilos.linhaTotal]}>
                <Text style={[estilos.linhaRotulo, l.total === true && estilos.linhaForte]}>
                  {l.rotulo}
                </Text>
                <Text style={[estilos.linhaValor, l.total === true && estilos.linhaForte]}>
                  {/* O sinal aparece, e nao so a cor: quem nao distingue cores
                      continua lendo o menos (RNF-052). */}
                  {l.subtrai === true && l.valor !== 0 ? '− ' : ''}
                  {formatMoney(emReais(Math.abs(l.valor)))}
                </Text>
              </View>
            ))}
          </Cartao>

          <Detalhe
            linhas={dre.lines}
            aberto={detalhando}
            aoAlternar={(t) => setDetalhando((atual) => (atual === t ? null : t))}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */

const ORDEM: readonly TipoDeConta[] = ['revenue', 'deduction', 'cost', 'expense']

/**
 * As contas que compoem cada bloco — RF-086.
 *
 * Fechado por padrao. O servidor manda a CONTAGEM de lancamentos por conta, e
 * nao os lancamentos: um mes movimentado tem milhares, e no celular abrir tudo
 * de uma vez daria uma rolagem que ninguem percorre.
 */
function Detalhe({
  linhas,
  aberto,
  aoAlternar,
}: {
  linhas: readonly LinhaDoDre[]
  aberto: TipoDeConta | null
  aoAlternar: (t: TipoDeConta) => void
}) {
  const comMovimento = ORDEM.filter((t) => linhas.some((l) => l.type === t))

  if (comMovimento.length === 0) {
    return (
      <Cartao>
        <Text style={estilos.aviso}>Nenhum lançamento neste período.</Text>
      </Cartao>
    )
  }

  return (
    <Cartao titulo="Por conta">
      {comMovimento.map((tipo) => {
        const doTipo = linhas.filter((l) => l.type === tipo)
        const expandido = aberto === tipo

        return (
          <View key={tipo}>
            <Pressable
              onPress={() => aoAlternar(tipo)}
              style={estilos.grupo}
              accessibilityRole="button"
              accessibilityState={{ expanded: expandido }}
            >
              <Text style={estilos.grupoTitulo}>{ROTULO_DO_TIPO[tipo]}</Text>
              <Text style={estilos.grupoContagem}>
                {doTipo.length} {doTipo.length === 1 ? 'conta' : 'contas'}
              </Text>
            </Pressable>

            {expandido
              ? doTipo.map((l) => (
                  <View key={l.accountId ?? `sem-conta-${l.type}`} style={estilos.conta}>
                    <View style={estilos.contaTexto}>
                      <Text style={[estilos.contaNome, l.accountId === null && estilos.semConta]}>
                        {l.accountName}
                      </Text>
                      <Text style={estilos.contaContagem}>
                        {l.entryCount} {l.entryCount === 1 ? 'lançamento' : 'lançamentos'}
                      </Text>
                    </View>
                    <Text style={estilos.contaValor}>{formatMoney(emReais(l.amountCents))}</Text>
                  </View>
                ))
              : null}
          </View>
        )
      })}
    </Cartao>
  )
}

const estilos = criarEstilos(() => ({
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
    ...vidro.peca,
    paddingVertical: espaco.sm,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
  },
  /* Aba ativa no azul de vidro com texto branco (NR-160). Fundo e texto em
     par: com `primaria` e texto quase preto, a aba ficava a 1,12:1. */
  abaAtiva: { ...vidro.ativo },
  abaTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  abaTextoAtivo: { color: cores.textoSobreAtivo, fontWeight: peso.forte },

  resultadoRotulo: { fontSize: fonte.pequeno, color: cores.textoFraco },
  resultadoValor: {
    fontSize: fonte.display,
    fontWeight: peso.pesado,
    color: cores.texto,
    marginTop: espaco.xs,
  },
  resultadoNegativo: { color: cores.erro },
  margem: { fontSize: fonte.pequeno, color: cores.textoFraco, marginTop: espaco.xs },

  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaco.sm,
  },
  linhaTotal: { borderTopWidth: 1, borderTopColor: cores.borda },
  linhaRotulo: { fontSize: fonte.corpo, color: cores.texto },
  linhaValor: { fontSize: fonte.corpo, color: cores.texto },
  linhaForte: { fontWeight: peso.forte },

  grupo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  grupoTitulo: { fontSize: fonte.corpo, color: cores.texto, fontWeight: peso.medio },
  grupoContagem: { fontSize: fonte.pequeno, color: cores.textoFraco },

  conta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaco.sm,
    paddingLeft: espaco.md,
  },
  contaTexto: { flex: 1, paddingRight: espaco.sm },
  contaNome: { fontSize: fonte.pequeno, color: cores.texto },
  semConta: { color: cores.textoFraco, fontStyle: 'italic' },
  contaContagem: { fontSize: fonte.micro, color: cores.textoFraco },
  contaValor: { fontSize: fonte.pequeno, color: cores.texto },

  aviso: { fontSize: fonte.pequeno, color: cores.textoFraco },
}))
