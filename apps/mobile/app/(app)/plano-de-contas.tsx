import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  apagarConta,
  carregarDre,
  carregarPlano,
  criarConta,
  mesLocal,
  ROTULO_DO_TIPO,
  type ContaContabil,
  type Dre,
  type TipoDeConta,
} from '@/lib/contabilidade-api'
import { formatMoney } from '@/lib/format'
import ComandosWhatsApp from '@/components/ComandosWhatsApp'
import { COMANDOS_PLANO_CONTAS } from '@/lib/comandos'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { CustosFixos, CustosVariaveis } from '@/components/CustosSecoes'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const TIPOS: TipoDeConta[] = ['expense', 'cost', 'revenue', 'deduction']

/**
 * Plano de contas — NR-077, RF-081 a RF-086.
 *
 * A tela lia `financeiro-api.ts`: um plano de exemplo com um "gasto no mês"
 * inventado por conta, mesmo depois de o web já falar com `/contas-contabeis`
 * e `/relatorios/dre` de verdade. Agora busca as duas.
 *
 * Criar e apagar conta, como no web. Conta do plano padrao nao se apaga, e
 * conta com lancamento o servidor recusa dizendo por que.
 */
export default function PlanoDeContas() {
  const [contas, setContas] = useState<ContaContabil[]>([])
  const [dre, setDre] = useState<Dre | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoTipo, setNovoTipo] = useState<TipoDeConta>('expense')
  const [salvando, setSalvando] = useState(false)

  const buscar = useCallback(async () => {
    const { de, ate } = mesLocal()
    /* As duas chamadas em paralelo: sao independentes, e encadea-las somaria
       as duas latencias antes de a tela desenhar. */
    const [rPlano, rDre] = await Promise.all([carregarPlano(), carregarDre(de, ate)])

    setCarregando(false)

    if (!rPlano.ok) {
      setErro(rPlano.erro)
      return
    }

    setErro(null)
    setContas(rPlano.dados.accounts)
    /* O DRE pode falhar sem derrubar a tela: o plano — o que se veio ver — ja
       chegou. Sem ele, cada conta so perde o "no mes" ao lado do nome. */
    setDre(rDre.ok ? rDre.dados : null)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  /* O valor de cada conta no mes, pela mesma agregacao do DRE — nunca somado
     aqui de novo. Contas sem lancamento no periodo ficam de fora do mapa, e
     por isso o valor padrao e zero. */
  const porConta = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const linha of dre?.lines ?? []) {
      if (linha.accountId !== null) mapa.set(linha.accountId, linha.amountCents)
    }
    return mapa
  }, [dre])

  const gastoMes = useMemo(
    () =>
      contas
        .filter((c) => c.type === 'expense' || c.type === 'cost')
        .reduce((acc, c) => acc + (porConta.get(c.id) ?? 0), 0) / 100,
    [contas, porConta],
  )

  async function criar() {
    setSalvando(true)
    const r = await criarConta({ name: novoNome.trim(), type: novoTipo })
    setSalvando(false)
    if (!r.ok) {
      Alert.alert('Não deu para criar', r.erro)
      return
    }
    setCriando(false)
    setNovoNome('')
    await buscar()
  }

  function apagar(conta: ContaContabil) {
    Alert.alert(`Apagar ${conta.name}?`, 'Só dá para apagar conta sem lançamentos.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const r = await apagarConta(conta.id)
            if (!r.ok) Alert.alert('Não deu para apagar', r.erro)
            else await buscar()
          })(),
      },
    ])
  }

  if (carregando) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Plano de contas" />
        <Vazio titulo="Carregando" descricao="Buscando o plano de contas." />
      </SafeAreaView>
    )
  }

  if (erro !== null) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Plano de contas" />
        <Vazio
          titulo="Não foi possível carregar"
          descricao={erro}
          acao={<Botao onPress={() => void buscar()}>Tentar de novo</Botao>}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Plano de contas"
        subtitulo={`${formatMoney(gastoMes)} de gasto no mês`}
        acao={criando ? undefined : <Botao onPress={() => setCriando(true)}>Nova</Botao>}
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {criando ? (
          <View style={estilos.formulario}>
            <Campo
              rotulo="Nome da conta"
              valor={novoNome}
              onChange={setNovoNome}
              placeholder="Ex.: Manutenção"
            />
            <View style={estilos.tipos}>
              {TIPOS.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setNovoTipo(t)}
                  style={[estilos.tipo, novoTipo === t && estilos.tipoAtivo]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: novoTipo === t }}
                >
                  <Text style={[estilos.tipoTexto, novoTipo === t && estilos.tipoTextoAtivo]}>
                    {ROTULO_DO_TIPO[t]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={estilos.acoes}>
              <View style={estilos.flex}>
                <Botao variante="secundario" onPress={() => setCriando(false)} largura>
                  Cancelar
                </Botao>
              </View>
              <View style={estilos.flex}>
                <Botao
                  onPress={() => void criar()}
                  carregando={salvando}
                  desabilitado={novoNome.trim().length < 2}
                  largura
                >
                  Criar
                </Botao>
              </View>
            </View>
          </View>
        ) : null}

        <CustosFixos contas={contas} />
        <CustosVariaveis />

        <Sanfona titulo="Planos de conta" resumo={`${contas.length} cadastrados`} inicialAberta>
          {contas.length === 0 ? (
            <Vazio
              titulo="Nenhuma conta cadastrada"
              descricao="Toque em Nova para criar a primeira conta."
            />
          ) : (
            contas.map((c) => (
              <View key={c.id} style={estilos.linha}>
                <View style={estilos.linhaInfo}>
                  <Text style={estilos.linhaNome}>{c.name}</Text>
                </View>
                <Etiqueta tom={c.type === 'revenue' ? 'sucesso' : 'neutro'}>
                  {ROTULO_DO_TIPO[c.type]}
                </Etiqueta>
                <Text style={estilos.linhaValor}>
                  {formatMoney((porConta.get(c.id) ?? 0) / 100)}
                </Text>
                {c.isDefault ? null : (
                  <Pressable
                    onPress={() => apagar(c)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Apagar ${c.name}`}
                  >
                    <Text style={estilos.apagar}>×</Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </Sanfona>
        {/* Via WhatsApp, como no web — NR-165. */}
        <ComandosWhatsApp comandos={COMANDOS_PLANO_CONTAS} />
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  linhaInfo: { flex: 1, gap: 1 },
  linhaNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  linhaValor: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apagar: { fontSize: 20, color: cores.textoFraco, paddingHorizontal: espaco.xs },

  formulario: {
    ...vidro.peca,
    gap: espaco.md,
    padding: espaco.md,
    borderRadius: raio.md,
  },
  flex: { flex: 1 },
  acoes: { flexDirection: 'row', gap: espaco.sm },
  tipos: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  tipo: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  tipoAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  tipoTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  tipoTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
}))
