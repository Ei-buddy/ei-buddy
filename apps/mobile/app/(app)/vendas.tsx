import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  FORMAS,
  listarHistoricoDeVendas,
  type ResumoDoHistorico,
  type VendaHistorico,
} from '@/lib/vendas-api'
import { formatDateTime, formatMoney } from '@/lib/format'
import { compartilharComprovante } from '@/lib/comprovante-da-venda'
import { hojeLocal } from '@/lib/periodo'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import CancelarVendaModal from '@/components/CancelarVendaModal'
import CancelarNotaModal from '@/components/CancelarNotaModal'
import DevolverItensModal from '@/components/DevolverItensModal'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

type Periodo = 'hoje' | '7d' | '30d' | 'tudo'

const PERIODOS: [Periodo, string][] = [
  ['hoje', 'Hoje'],
  ['7d', '7 dias'],
  ['30d', '30 dias'],
  ['tudo', 'Tudo'],
]

/** O inicio do periodo, em data LOCAL — o dia da loja, nao o de UTC. */
function inicioDoPeriodo(periodo: Periodo): string | undefined {
  if (periodo === 'tudo') return undefined
  const dias = periodo === 'hoje' ? 0 : periodo === '7d' ? 6 : 29
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return hojeLocal(d)
}

/**
 * Historico de vendas — RF-036, US-021.
 *
 * Cada venda e uma sanfona: fechada mostra cliente, valor e situacao. Aberta
 * revela itens, pagamento e nota, e as acoes do web: devolver itens, cancelar
 * a nota e estornar. Busca, periodo e paginas sao do servidor.
 */
export default function Vendas() {
  const router = useRouter()
  const [vendas, setVendas] = useState<VendaHistorico[]>([])
  const [total, setTotal] = useState(0)
  const [resumo, setResumo] = useState<ResumoDoHistorico | null>(null)
  const [pagina, setPagina] = useState(1)
  const [termo, setTermo] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('30d')
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [estornando, setEstornando] = useState<VendaHistorico | null>(null)
  const [devolvendo, setDevolvendo] = useState<VendaHistorico | null>(null)
  const [cancelandoNota, setCancelandoNota] = useState<VendaHistorico | null>(null)

  const buscar = useCallback(async (t: string, p: Periodo, pag: number) => {
    const de = inicioDoPeriodo(p)
    const r = await listarHistoricoDeVendas({
      termo: t,
      pagina: pag,
      ...(de === undefined ? {} : { de, ate: hojeLocal() }),
    })
    setCarregando(false)
    setCarregandoMais(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setPagina(pag)
    setTotal(r.total)
    setResumo(r.resumo)
    setVendas((atual) => (pag === 1 ? r.vendas : [...atual, ...r.vendas]))
  }, [])

  useEffect(() => {
    /* Espera a digitacao parar: a resposta de "Mar" nao pode chegar depois da
       de "Maria" e apagar o resultado certo. */
    const t = setTimeout(() => void buscar(termo, periodo, 1), 300)
    return () => clearTimeout(t)
  }, [termo, periodo, buscar])

  const recarregar = () => void buscar(termo, periodo, 1)

  /* Estorno de verdade — RF-043: o servidor devolve o estoque e cancela os
     recebiveis numa transacao so. A lista recarrega depois, porque o status
     quem decide e o servidor. */
  function aoEstornar() {
    const numero = estornando?.numero
    setEstornando(null)
    recarregar()
    Alert.alert('Venda estornada', `A venda #${numero ?? ''} foi estornada.`)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Vendas"
        subtitulo={resumo ? `${resumo.quantidade} venda(s) no período` : undefined}
        acao={<Botao onPress={() => router.push('/pdv')}>Nova</Botao>}
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <TextInput
          style={estilos.busca}
          value={termo}
          onChangeText={setTermo}
          placeholder="Número, cliente ou produto"
          placeholderTextColor={cores.textoFraco}
          autoCorrect={false}
          accessibilityLabel="Buscar venda"
        />

        <View style={estilos.periodos}>
          {PERIODOS.map(([valor, rotulo]) => (
            <Pressable
              key={valor}
              onPress={() => setPeriodo(valor)}
              style={[estilos.periodo, periodo === valor && estilos.periodoAtivo]}
              accessibilityRole="button"
              accessibilityState={{ selected: periodo === valor }}
            >
              <Text style={[estilos.periodoTexto, periodo === valor && estilos.periodoTextoAtivo]}>
                {rotulo}
              </Text>
            </Pressable>
          ))}
        </View>

        {carregando ? (
          <Vazio titulo="Carregando" descricao="Buscando o histórico de vendas." />
        ) : erro !== null ? (
          <Vazio
            titulo="Não foi possível carregar"
            descricao={erro}
            acao={<Botao onPress={recarregar}>Tentar de novo</Botao>}
          />
        ) : vendas.length === 0 ? (
          termo === '' && periodo === 'tudo' ? (
            <Vazio
              titulo="Nenhuma venda ainda"
              descricao="As vendas fechadas no PDV aparecem aqui."
              acao={<Botao onPress={() => router.push('/pdv')}>Fazer a primeira venda</Botao>}
            />
          ) : (
            <Vazio
              titulo="Nenhuma venda encontrada"
              descricao="Nada neste período ou nesta busca."
              acao={
                <Botao
                  variante="secundario"
                  onPress={() => {
                    setTermo('')
                    setPeriodo('tudo')
                  }}
                >
                  Ver todas
                </Botao>
              }
            />
          )
        ) : (
          <>
            {resumo !== null ? (
              <View style={estilos.resumo}>
                <View style={estilos.resumoItem}>
                  <Text style={estilos.resumoRotulo}>Bruto</Text>
                  <Text style={estilos.resumoValor}>{formatMoney(resumo.faturamento)}</Text>
                </View>
                <View style={estilos.resumoItem}>
                  <Text style={estilos.resumoRotulo}>Líquido</Text>
                  <Text style={[estilos.resumoValor, estilos.liquido]}>
                    {formatMoney(resumo.liquido)}
                  </Text>
                </View>
                <View style={estilos.resumoItem}>
                  <Text style={estilos.resumoRotulo}>Ticket bruto</Text>
                  <Text style={estilos.resumoValor}>
                    {resumo.ticketMedio === null ? '—' : formatMoney(resumo.ticketMedio)}
                  </Text>
                </View>
              </View>
            ) : null}

            {vendas.map((v) => {
              const estornada = v.status === 'estornada'
              const podeDevolver =
                !estornada &&
                v.itens.some((i) => i.produtoId !== null && i.quantidade > i.devolvido)

              return (
                <Sanfona
                  key={v.id}
                  titulo={`#${v.numero} · ${v.clienteNome}`}
                  resumo={`${formatDateTime(v.data)} · ${formatMoney(v.total)}`}
                  etiqueta={
                    estornada ? (
                      <Etiqueta tom="erro">Estornada</Etiqueta>
                    ) : v.devolvidoValor > 0 ? (
                      <Etiqueta tom="atencao">Devolução parcial</Etiqueta>
                    ) : (
                      <Etiqueta tom="sucesso">{formatMoney(v.total)}</Etiqueta>
                    )
                  }
                >
                  {v.itens.map((i, idx) => (
                    <View key={idx} style={estilos.item}>
                      <Text style={estilos.itemQtd}>{i.quantidade}×</Text>
                      <Text style={estilos.itemNome} numberOfLines={1}>
                        {i.descricao}
                        {i.devolvido > 0 ? ` (${i.devolvido} devolvido)` : ''}
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
                  {v.devolvidoValor > 0 ? (
                    <Detalhe rotulo="Devolvido" valor={`- ${formatMoney(v.devolvidoValor)}`} />
                  ) : null}
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

                  {/* Recibo nao fiscal, para a venda estornada tambem (sai
                      marcado) — NR-154. */}
                  <View style={estilos.acoes}>
                    <Acao
                      rotulo="Comprovante"
                      onPress={() =>
                        void compartilharComprovante(v).then((r) => {
                          if (!r.ok) Alert.alert('Comprovante', r.erro)
                        })
                      }
                    />
                  </View>

                  {!estornada ? (
                    <View style={estilos.acoes}>
                      {/* Com nota ativa, o servidor recusa estorno e devolucao:
                          cancelar a nota e o primeiro passo, e o botao diz isso. */}
                      {v.nota !== null ? (
                        <Acao rotulo="Cancelar nota" onPress={() => setCancelandoNota(v)} />
                      ) : null}
                      {podeDevolver ? (
                        <Acao rotulo="Devolver itens" onPress={() => setDevolvendo(v)} />
                      ) : null}
                      <Acao rotulo="Estornar venda" perigo onPress={() => setEstornando(v)} />
                    </View>
                  ) : null}
                </Sanfona>
              )
            })}

            {vendas.length < total ? (
              <Botao
                variante="secundario"
                carregando={carregandoMais}
                onPress={() => {
                  setCarregandoMais(true)
                  void buscar(termo, periodo, pagina + 1)
                }}
                largura
              >
                Carregar mais ({total - vendas.length})
              </Botao>
            ) : null}
          </>
        )}
      </ScrollView>

      {estornando !== null ? (
        <CancelarVendaModal
          venda={estornando}
          onCancelada={aoEstornar}
          onFechar={() => setEstornando(null)}
        />
      ) : null}

      {devolvendo !== null ? (
        <DevolverItensModal
          venda={devolvendo}
          onDevolvido={(r) => {
            setDevolvendo(null)
            recarregar()
            Alert.alert(
              'Devolução registrada',
              r.entregarAoCliente > 0
                ? `Entregue ${formatMoney(r.entregarAoCliente)} ao cliente.`
                : `${formatMoney(r.deixaDeReceber)} deixam de ser cobrados.`,
            )
          }}
          onFechar={() => setDevolvendo(null)}
        />
      ) : null}

      {cancelandoNota !== null && cancelandoNota.nota !== null ? (
        <CancelarNotaModal
          venda={{
            id: cancelandoNota.id,
            numero: cancelandoNota.numero,
            notaNumero: cancelandoNota.nota.numero,
          }}
          onCancelada={() => {
            setCancelandoNota(null)
            recarregar()
            Alert.alert(
              'Nota cancelada',
              'A SEFAZ cancelou a nota. Agora a venda pode ser estornada ou devolvida.',
            )
          }}
          onFechar={() => setCancelandoNota(null)}
        />
      ) : null}
    </SafeAreaView>
  )
}

function Acao({
  rotulo,
  onPress,
  perigo = false,
}: {
  rotulo: string
  onPress: () => void
  perigo?: boolean
}) {
  return (
    <Pressable
      style={[estilos.acao, perigo && estilos.acaoPerigo]}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text style={[estilos.acaoTexto, perigo && estilos.acaoTextoPerigo]}>{rotulo}</Text>
    </Pressable>
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

  busca: {
    minHeight: 48,
    paddingHorizontal: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    fontSize: fonte.corpo,
    color: cores.texto,
  },
  periodos: { flexDirection: 'row', gap: espaco.sm },
  periodo: {
    flex: 1,
    paddingVertical: espaco.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  periodoAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  periodoTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  periodoTextoAtivo: { color: cores.acento, fontWeight: peso.forte },

  acoes: { gap: espaco.sm, marginTop: espaco.sm },
  acao: {
    paddingVertical: espaco.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  acaoPerigo: { borderColor: cores.erro },
  acaoTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
  acaoTextoPerigo: { color: cores.erro },
})
