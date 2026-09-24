import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FORMAS, listarHistoricoDeVendas, type VendaHistorico } from '@/lib/vendas-api'
import { formatDateTime, formatMoney } from '@/lib/format'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import CancelarVendaModal from '@/components/CancelarVendaModal'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Historico de vendas — RF-036, US-021.
 *
 * Cada venda e uma sanfona: fechada mostra cliente, valor e situacao —
 * que e o que se procura ao conferir o dia. Abrir revela os itens, o
 * pagamento e a nota, sem trocar de tela.
 *
 * Mostrava cinco vendas de exemplo, sempre as mesmas: o faturamento e o
 * ticket medio do topo somavam dinheiro que nao existia. Agora busca em
 * `GET /sales`.
 */
export default function Vendas() {
  const router = useRouter()
  const [vendas, setVendas] = useState<VendaHistorico[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [estornando, setEstornando] = useState<VendaHistorico | null>(null)

  const buscar = useCallback(async () => {
    const r = await listarHistoricoDeVendas()
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setVendas(r.vendas)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  /* Estorno de verdade — RF-043: o servidor devolve o estoque e cancela os
     recebiveis numa transacao so. A lista recarrega depois, porque o status
     quem decide e o servidor. */
  function aoCancelar() {
    const numero = estornando?.numero
    setEstornando(null)
    void buscar()
    Alert.alert('Venda estornada', `A venda #${numero ?? ''} foi estornada.`)
  }

  const resumo = useMemo(() => {
    const concluidas = vendas.filter((v) => v.status === 'concluida')
    const total = concluidas.reduce((a, v) => a + v.total, 0)
    return {
      concluidas,
      total,
      liquido: concluidas.reduce((a, v) => a + v.valorLiquido, 0),
      ticket: concluidas.length ? total / concluidas.length : 0,
    }
  }, [vendas])

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Vendas"
        subtitulo={`${resumo.concluidas.length} concluídas`}
        acao={<Botao onPress={() => router.push('/pdv')}>Nova</Botao>}
      />

      <ScrollView contentContainerStyle={estilos.conteudo}>
        {carregando ? (
          <Vazio titulo="Carregando" descricao="Buscando o histórico de vendas." />
        ) : erro !== null ? (
          <Vazio
            titulo="Não foi possível carregar"
            descricao={erro}
            acao={<Botao onPress={() => void buscar()}>Tentar de novo</Botao>}
          />
        ) : vendas.length === 0 ? (
          <Vazio
            titulo="Nenhuma venda ainda"
            descricao="As vendas fechadas no PDV aparecem aqui."
            acao={<Botao onPress={() => router.push('/pdv')}>Fazer a primeira venda</Botao>}
          />
        ) : (
          <>
            <View style={estilos.resumo}>
              <View style={estilos.resumoItem}>
                <Text style={estilos.resumoRotulo}>Faturamento</Text>
                <Text style={estilos.resumoValor}>{formatMoney(resumo.total)}</Text>
              </View>
              <View style={estilos.resumoItem}>
                <Text style={estilos.resumoRotulo}>Líquido</Text>
                <Text style={[estilos.resumoValor, estilos.liquido]}>
                  {formatMoney(resumo.liquido)}
                </Text>
              </View>
              <View style={estilos.resumoItem}>
                <Text style={estilos.resumoRotulo}>Ticket médio</Text>
                <Text style={estilos.resumoValor}>{formatMoney(resumo.ticket)}</Text>
              </View>
            </View>

            {vendas.map((v) => (
              <Sanfona
                key={v.id}
                titulo={`#${v.numero} · ${v.clienteNome}`}
                resumo={`${formatDateTime(v.data)} · ${formatMoney(v.total)}`}
                etiqueta={
                  v.status === 'estornada' ? (
                    <Etiqueta tom="erro">Estornada</Etiqueta>
                  ) : (
                    <Etiqueta tom="sucesso">{formatMoney(v.total)}</Etiqueta>
                  )
                }
              >
                {/* Itens */}
                {v.itens.map((i, idx) => (
                  <View key={idx} style={estilos.item}>
                    <Text style={estilos.itemQtd}>{i.quantidade}×</Text>
                    <Text style={estilos.itemNome} numberOfLines={1}>
                      {i.descricao}
                    </Text>
                    <Text style={estilos.itemValor}>
                      {formatMoney(i.precoUnitario * i.quantidade)}
                    </Text>
                  </View>
                ))}

                <View style={estilos.divisor} />

                <Detalhe rotulo="Subtotal" valor={formatMoney(v.subtotal)} />
                {v.desconto > 0 ? (
                  <Detalhe rotulo="Desconto" valor={`- ${formatMoney(v.desconto)}`} />
                ) : null}
                <Detalhe rotulo="Total" valor={formatMoney(v.total)} forte />
                <Detalhe
                  rotulo="Pagamento"
                  valor={v.pagamentos
                    .map((p) => FORMAS.find((f) => f.valor === p.forma)?.rotulo ?? p.forma)
                    .join(' + ')}
                />
                <Detalhe rotulo="Líquido" valor={formatMoney(v.valorLiquido)} />
                <Detalhe
                  rotulo="Nota fiscal"
                  valor={
                    v.nota
                      ? `${v.nota.tipo === 'nfce' ? 'NFC-e' : 'NFS-e'} ${v.nota.numero}`
                      : 'sem nota'
                  }
                />

                {v.status !== 'estornada' ? (
                  <Pressable
                    style={estilos.estornar}
                    accessibilityRole="button"
                    onPress={() => setEstornando(v)}
                  >
                    <Text style={estilos.estornarTexto}>Estornar venda</Text>
                  </Pressable>
                ) : null}
              </Sanfona>
            ))}
          </>
        )}
      </ScrollView>

      {estornando !== null ? (
        <CancelarVendaModal
          venda={estornando}
          onCancelada={aoCancelar}
          onFechar={() => setEstornando(null)}
        />
      ) : null}
    </SafeAreaView>
  )
}

function Detalhe({
  rotulo,
  valor,
  forte = false,
}: {
  rotulo: string
  valor: string
  forte?: boolean
}) {
  return (
    <View style={estilos.detalhe}>
      <Text style={estilos.detalheRotulo}>{rotulo}</Text>
      <Text style={[estilos.detalheValor, forte && estilos.detalheForte]}>{valor}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  resumo: {
    flexDirection: 'row',
    gap: espaco.sm,
  },
  resumoItem: {
    flex: 1,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
    gap: 2,
  },
  resumoRotulo: { fontSize: 11, color: cores.textoFraco },
  resumoValor: { fontSize: fonte.pequeno, fontWeight: peso.pesado, color: cores.texto },
  liquido: { color: cores.acento },

  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  itemQtd: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.acento },
  itemNome: { flex: 1, fontSize: fonte.pequeno, color: cores.texto },
  itemValor: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },

  divisor: { height: 1, backgroundColor: cores.borda, marginVertical: espaco.xs },

  detalhe: { flexDirection: 'row', justifyContent: 'space-between', gap: espaco.md },
  detalheRotulo: { fontSize: fonte.micro, color: cores.textoFraco },
  detalheValor: { fontSize: fonte.micro, color: cores.texto },
  detalheForte: { fontSize: fonte.pequeno, fontWeight: peso.pesado },

  estornar: {
    marginTop: espaco.sm,
    paddingVertical: espaco.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.erro,
    borderRadius: raio.pill,
  },
  estornarTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
})
