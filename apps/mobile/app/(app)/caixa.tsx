import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  abrirCaixa,
  carregarCaixa,
  carregarHistoricoDoCaixa,
  fecharCaixa,
  movimentarCaixa,
  ROTULO_FORMA,
  type ResumoDoCaixa,
  type SessaoDeCaixa,
} from '@/lib/caixa-api'
import { formatMoney } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const reais = (cents: number) => formatMoney(cents / 100)
const quando = (iso: string) =>
  new Date(iso)
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(', ', ' ')

/**
 * Caixa — NR-157, o par da tela do web: abrir com troco, sangria e suprimento
 * com motivo, fechar comparando o esperado com o contado.
 */
export default function CaixaScreen() {
  const [caixa, setCaixa] = useState<ResumoDoCaixa | null | undefined>(undefined)
  const [historico, setHistorico] = useState<SessaoDeCaixa[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [c, h] = await Promise.all([carregarCaixa(), carregarHistoricoDoCaixa()])
    if (c.ok) {
      setCaixa(c.dados)
      setErro(null)
    } else setErro(c.erro)
    if (h.ok) setHistorico(h.dados.filter((s) => s.status === 'closed'))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void carregar()
    }, [carregar]),
  )

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Caixa"
        subtitulo={caixa ? 'Aberto' : caixa === null ? 'Fechado' : undefined}
      />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {erro !== null ? (
          <Vazio titulo="Não deu para carregar" descricao={erro} />
        ) : caixa === undefined ? (
          <Vazio titulo="Carregando" descricao="Buscando o caixa." />
        ) : caixa === null ? (
          <Abrir aoMudar={carregar} />
        ) : (
          <Aberto caixa={caixa} aoMudar={carregar} />
        )}

        <Cartao titulo="Caixas fechados">
          {historico.length === 0 ? (
            <Text style={estilos.apoio}>Nenhum caixa fechado ainda.</Text>
          ) : (
            historico.map((s) => {
              const dif = (s.countedCents ?? 0) - (s.expectedCents ?? 0)
              return (
                <View key={s.id} style={estilos.linha}>
                  <View style={estilos.flex}>
                    <Text style={estilos.nome}>{quando(s.openedAt)}</Text>
                    <Text style={estilos.apoio}>
                      esperado {reais(s.expectedCents ?? 0)} · contado {reais(s.countedCents ?? 0)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      estilos.valor,
                      dif < 0 ? estilos.falta : dif > 0 ? estilos.sobra : null,
                    ]}
                  >
                    {dif === 0 ? 'bateu' : `${dif > 0 ? 'sobra' : 'falta'} ${reais(Math.abs(dif))}`}
                  </Text>
                </View>
              )
            })
          )}
        </Cartao>
      </ScrollView>
    </SafeAreaView>
  )
}

function Abrir({ aoMudar }: { aoMudar: () => Promise<void> }) {
  const [troco, setTroco] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function abrir() {
    const cents = troco.trim() === '' ? 0 : centavosDoTexto(troco)
    if (cents === null || cents < 0) return Alert.alert('Caixa', 'Troco inicial inválido.')
    setSalvando(true)
    const r = await abrirCaixa(cents)
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para abrir', r.erro)
    await aoMudar()
  }

  return (
    <Cartao titulo="O caixa está fechado">
      <View style={estilos.form}>
        <Text style={estilos.apoio}>
          Conte o dinheiro da gaveta para começar. As vendas em dinheiro entram sozinhas.
        </Text>
        <Campo
          rotulo="Troco inicial *"
          valor={troco}
          onChange={setTroco}
          tipoTeclado="decimal-pad"
          placeholder="0,00"
        />
        <Botao onPress={() => void abrir()} carregando={salvando} largura>
          Abrir caixa
        </Botao>
      </View>
    </Cartao>
  )
}

function Aberto({ caixa, aoMudar }: { caixa: ResumoDoCaixa; aoMudar: () => Promise<void> }) {
  const dinheiro = caixa.salesByMethod.find((p) => p.method === 'cash')?.amountCents ?? 0
  const outras = caixa.salesByMethod.filter((p) => p.method !== 'cash')
  const [tipo, setTipo] = useState<'withdrawal' | 'deposit'>('withdrawal')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function movimentar() {
    const cents = centavosDoTexto(valor)
    if (cents === null || cents <= 0)
      return Alert.alert('Caixa', 'Informe um valor maior que zero.')
    if (motivo.trim().length < 3) return Alert.alert('Caixa', 'Diga o motivo.')
    setSalvando(true)
    const r = await movimentarCaixa(tipo, cents, motivo)
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para registrar', r.erro)
    setValor('')
    setMotivo('')
    await aoMudar()
  }

  async function fechar() {
    const cents = centavosDoTexto(contado)
    if (cents === null || cents < 0) return Alert.alert('Caixa', 'Informe quanto há na gaveta.')
    setSalvando(true)
    const r = await fecharCaixa(cents, obs)
    setSalvando(false)
    if (!r.ok) return Alert.alert('Não deu para fechar', r.erro)
    const dif = cents - (r.dados.session.expectedCents ?? 0)
    Alert.alert(
      'Caixa fechado',
      dif === 0 ? 'Bateu certinho.' : `${dif > 0 ? 'Sobra' : 'Falta'} de ${reais(Math.abs(dif))}.`,
    )
    await aoMudar()
  }

  return (
    <>
      <Cartao titulo="Agora">
        <Linha rotulo="Troco inicial" valor={reais(caixa.session.openingCents)} />
        <Linha
          rotulo={`Vendas em dinheiro (${caixa.salesCount} venda(s), todas as formas)`}
          valor={reais(dinheiro)}
        />
        <Linha rotulo="Suprimentos" valor={`+${reais(caixa.depositsCents)}`} />
        <Linha rotulo="Sangrias" valor={`−${reais(caixa.withdrawalsCents)}`} />
        <Linha rotulo="Esperado na gaveta" valor={reais(caixa.expectedCashCents)} forte />
        {outras.length > 0 ? (
          <Text style={estilos.subtitulo}>Conferir com a maquininha</Text>
        ) : null}
        {outras.map((p) => (
          <Linha key={p.method} rotulo={ROTULO_FORMA[p.method]} valor={reais(p.amountCents)} />
        ))}
      </Cartao>

      <Cartao titulo="Sangria ou suprimento">
        <View style={estilos.form}>
          <View style={estilos.tipos}>
            {(
              [
                ['withdrawal', 'Sangria (tirar)'],
                ['deposit', 'Suprimento (pôr)'],
              ] as const
            ).map(([v, r]) => (
              <Pressable
                key={v}
                onPress={() => setTipo(v)}
                style={[estilos.tipo, tipo === v && estilos.tipoAtivo]}
                accessibilityRole="button"
              >
                <Text style={estilos.tipoTexto}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <Campo
            rotulo="Valor *"
            valor={valor}
            onChange={setValor}
            tipoTeclado="decimal-pad"
            placeholder="0,00"
          />
          <Campo
            rotulo="Motivo *"
            valor={motivo}
            onChange={setMotivo}
            placeholder="Depósito no banco..."
          />
          <Botao
            variante="secundario"
            onPress={() => void movimentar()}
            carregando={salvando}
            largura
          >
            Registrar
          </Botao>
          {caixa.movements.map((m) => (
            <Linha
              key={m.id}
              rotulo={`${m.kind === 'withdrawal' ? 'Sangria' : 'Suprimento'} · ${m.reason}`}
              valor={`${m.kind === 'withdrawal' ? '−' : '+'}${reais(m.amountCents)}`}
            />
          ))}
        </View>
      </Cartao>

      <Cartao titulo="Fechar caixa">
        <View style={estilos.form}>
          <Text style={estilos.apoio}>
            Conte a gaveta. O esperado é {reais(caixa.expectedCashCents)}.
          </Text>
          <Campo
            rotulo="Contado na gaveta *"
            valor={contado}
            onChange={setContado}
            tipoTeclado="decimal-pad"
            placeholder="0,00"
          />
          <Campo rotulo="Observação" valor={obs} onChange={setObs} />
          <Botao onPress={() => void fechar()} carregando={salvando} largura>
            Fechar caixa
          </Botao>
        </View>
      </Cartao>
    </>
  )
}

function Linha({
  rotulo,
  valor,
  forte = false,
}: {
  rotulo: string
  valor: string
  forte?: boolean
}) {
  return (
    <View style={estilos.linha}>
      <Text style={[estilos.flex, forte ? estilos.nome : estilos.apoio]}>{rotulo}</Text>
      <Text style={[estilos.valor, forte && estilos.forte]}>{valor}</Text>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  form: { gap: espaco.md },
  flex: { flex: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: espaco.xs },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  subtitulo: {
    marginTop: espaco.md,
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoFraco,
  },
  valor: { fontSize: fonte.pequeno, color: cores.texto },
  forte: { fontWeight: peso.pesado },
  falta: { color: cores.erro },
  sobra: { color: cores.atencao },
  tipos: { flexDirection: 'row', gap: espaco.sm, flexWrap: 'wrap' },
  tipo: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  tipoAtivo: { borderColor: cores.acento, backgroundColor: cores.campo },
  tipoTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
}))
