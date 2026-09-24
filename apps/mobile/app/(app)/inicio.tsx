import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { describeDueDate, formatMoney } from '@/lib/format'
import {
  carregarContasAPagar,
  carregarParaRepor,
  carregarResumoDoDia,
  carregarSaudacao,
  carregarVendasRecentes,
  type ContaAPagar,
  type ProdutoParaRepor,
  type ResumoDoDia,
  type Saudacao,
  type VendaRecente,
} from '@/lib/inicio-api'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import { Etiqueta } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

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
}

const VAZIO: Estado = {
  saudacao: null,
  resumo: null,
  contas: null,
  totalAPagarCents: 0,
  vencidas: 0,
  repor: null,
  vendas: null,
}

export default function Inicio() {
  const router = useRouter()

  const [estado, setEstado] = useState<Estado>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)

  const buscar = useCallback(async () => {
    /* Tudo em paralelo: sao cinco perguntas independentes, e encadea-las
       multiplicaria a espera numa rede de celular por nada. */
    const [saudacao, resumo, aPagar, repor, vendas] = await Promise.all([
      carregarSaudacao(),
      carregarResumoDoDia(),
      carregarContasAPagar(),
      carregarParaRepor(),
      carregarVendasRecentes(),
    ])

    setEstado({
      saudacao,
      resumo,
      contas: aPagar.contas,
      totalAPagarCents: aPagar.totalCents,
      vencidas: aPagar.vencidas,
      repor,
      vendas,
    })
    setCarregando(false)
    setAtualizando(false)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar()
    })()
  }, [buscar])

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
        {/* Numeros do dia: sempre visiveis, sem precisar abrir nada. */}
        <View style={estilos.indicadores}>
          <Indicador
            rotulo="Vendido hoje"
            valor={r?.faturamentoCents ?? null}
            apoio={r?.vendasHoje === null ? undefined : `${r?.vendasHoje ?? 0} vendas`}
            carregando={carregando}
            destaque
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
          <Indicador
            rotulo="Repor"
            contagem={r?.produtosParaRepor ?? null}
            apoio={
              r === null || r.produtosEsgotados === null
                ? undefined
                : r.produtosEsgotados > 0
                  ? `${r.produtosEsgotados} esgotado(s)`
                  : 'nada esgotado'
            }
            alerta={(r?.produtosEsgotados ?? 0) > 0}
            carregando={carregando}
          />
        </View>

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
          titulo="Últimas vendas"
          resumo={estado.vendas === null ? '—' : `${estado.vendas.length} recentes`}
          inicialAberta
        >
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
        </Sanfona>

        <Sanfona
          titulo="Contas a pagar"
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
            limite={5}
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
        </Sanfona>

        <Sanfona
          titulo="Precisa repor"
          resumo={estado.repor === null ? '—' : `${estado.repor.length} produto(s)`}
          etiqueta={
            (estado.repor?.length ?? 0) > 0 ? (
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
        </Sanfona>
      </ScrollView>
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */

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

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.md, gap: espaco.md, paddingBottom: espaco.xxl },

  indicadores: { flexDirection: 'row', gap: espaco.sm },
  indicador: {
    flex: 1,
    minWidth: 0,
    padding: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
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
     * `acento`, como no `Botao` primario do design system.
     *
     * Com `primaria` aqui, o rotulo — que usa `textoSobreAcento`, quase preto
     * — ficava a 1,12:1. A acao principal da tela inicial, aquela que a pessoa
     * abre o app para fazer, tinha o texto invisivel. Esta tela havia
     * divergido do componente compartilhado, e foi na divergencia que o
     * contraste se perdeu.
     */
    backgroundColor: cores.acento,
  },
  atalhoPressionado: { opacity: 0.85 },
  atalhoTexto: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.textoSobreAcento },
  atalhoApoio: { fontSize: fonte.pequeno, color: cores.textoSobreAcento, opacity: 0.85 },

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
})
