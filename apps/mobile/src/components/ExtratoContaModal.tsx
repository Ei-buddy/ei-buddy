import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import Botao from '@/components/ui/Botao'
import {
  carregarExtrato,
  type ContaBancaria,
  type ExtratoDaConta,
} from '@/lib/contas-bancarias-api'
import { formatDate, formatMoney, hoje } from '@/lib/format'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

function periodoDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

function mesAoLado(mes: string, passo: number): string {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number) as [number, number]
  return `${MESES[m - 1]} de ${ano}`
}

const reais = (cents: number) => formatMoney(cents / 100)

/**
 * O extrato da conta, mes a mes — par do `ExtratoContaBancaria` do web
 * (achado do QA: "Bancos: ter um extrato das movimentacoes").
 */
export default function ExtratoContaModal({
  conta,
  onFechar,
}: {
  conta: ContaBancaria
  onFechar: () => void
}) {
  const [mes, setMes] = useState(() => hoje().slice(0, 7))
  const [extrato, setExtrato] = useState<ExtratoDaConta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    const { de, ate } = periodoDoMes(mes)
    void carregarExtrato(conta.id, de, ate).then((r) => {
      if (cancelado) return
      if (r.ok) {
        setExtrato(r.dados)
        setErro(null)
      } else setErro(r.erro)
    })
    return () => {
      cancelado = true
    }
  }, [conta.id, mes])

  const atual = extrato !== null && extrato.from === periodoDoMes(mes).de ? extrato : null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable
          style={estilos.fora}
          onPress={onFechar}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={estilos.folha}>
          <ScrollView contentContainerStyle={estilos.conteudo}>
            <Text style={estilos.titulo}>Extrato · {conta.name}</Text>

            <View style={estilos.meses}>
              <Pressable
                onPress={() => setMes((m) => mesAoLado(m, -1))}
                style={estilos.seta}
                accessibilityRole="button"
                accessibilityLabel="Mês anterior"
              >
                <Text style={estilos.setaTexto}>‹</Text>
              </Pressable>
              <Text style={estilos.mes}>{rotuloDoMes(mes)}</Text>
              <Pressable
                onPress={() => setMes((m) => mesAoLado(m, 1))}
                style={estilos.seta}
                accessibilityRole="button"
                accessibilityLabel="Próximo mês"
              >
                <Text style={estilos.setaTexto}>›</Text>
              </Pressable>
            </View>

            {erro !== null ? (
              <Text style={estilos.erro}>{erro}</Text>
            ) : atual === null ? (
              <Text style={estilos.apoio}>Carregando...</Text>
            ) : (
              <>
                <View style={estilos.resumo}>
                  <Linha
                    rotulo={`Saldo em ${formatDate(atual.from)}`}
                    valor={reais(atual.openingCents)}
                  />
                  <Linha rotulo="Entradas" valor={`+${reais(atual.inflowCents)}`} tom="entrada" />
                  <Linha rotulo="Saídas" valor={`−${reais(atual.outflowCents)}`} tom="saida" />
                  <Linha
                    rotulo={`Saldo em ${formatDate(atual.to)}`}
                    valor={reais(atual.closingCents)}
                    forte
                  />
                </View>

                {atual.entries.length === 0 ? (
                  <Text style={estilos.apoio}>Nenhuma movimentação neste mês.</Text>
                ) : (
                  atual.entries.map((l) => (
                    <View key={l.id} style={estilos.movimento}>
                      <View style={estilos.flex}>
                        <Text style={estilos.nome} numberOfLines={1}>
                          {l.counterparty ??
                            (l.kind === 'receivable' ? 'Recebimento' : 'Pagamento')}
                        </Text>
                        <Text style={estilos.apoio} numberOfLines={1}>
                          {formatDate(l.date)} · {l.isReversal ? 'Estorno · ' : ''}
                          {l.description}
                        </Text>
                      </View>
                      <View style={estilos.valores}>
                        <Text style={l.amountCents >= 0 ? estilos.entrada : estilos.saida}>
                          {l.amountCents >= 0 ? '+' : '−'}
                          {reais(Math.abs(l.amountCents))}
                        </Text>
                        <Text style={estilos.apoio}>{reais(l.balanceCents)}</Text>
                      </View>
                    </View>
                  ))
                )}
              </>
            )}

            <Botao variante="secundario" onPress={onFechar} largura>
              Fechar
            </Botao>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function Linha({
  rotulo,
  valor,
  tom,
  forte = false,
}: {
  rotulo: string
  valor: string
  tom?: 'entrada' | 'saida'
  forte?: boolean
}) {
  return (
    <View style={estilos.linha}>
      <Text style={[estilos.flex, estilos.apoio]}>{rotulo}</Text>
      <Text
        style={[
          estilos.valor,
          tom === 'entrada' && estilos.entrada,
          tom === 'saida' && estilos.saida,
          forte && estilos.forte,
        ]}
      >
        {valor}
      </Text>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  fora: { flex: 1 },
  folha: {
    ...vidro.painel,
    maxHeight: '88%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  meses: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seta: {
    ...vidro.peca,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: raio.pill,
  },
  setaTexto: { fontSize: 22, color: cores.texto },
  mes: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  resumo: { gap: espaco.xs },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  movimento: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  valores: { alignItems: 'flex-end' },
  flex: { flex: 1 },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  valor: { fontSize: fonte.pequeno, color: cores.texto },
  forte: { fontWeight: peso.pesado },
  entrada: { fontSize: fonte.pequeno, color: cores.acento, fontWeight: peso.forte },
  saida: { fontSize: fonte.pequeno, color: cores.erro, fontWeight: peso.forte },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
}))
