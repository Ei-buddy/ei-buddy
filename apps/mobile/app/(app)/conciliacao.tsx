import { getDocumentAsync } from 'expo-document-picker'
import { File } from 'expo-file-system'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  carregarFila,
  carregarSugestoes,
  conciliar,
  criarLancamentoDaTransacao,
  desfazerConciliacao,
  importarExtrato,
  type RecorteDaFila,
  type Sugestao,
  type TransacaoBancaria,
} from '@/lib/conciliacao-api'
import { formatDate, formatMoney } from '@/lib/format'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** O motivo do desfazer vai para a trilha; o contrato pede 3 caracteres. */
const MOTIVO_MINIMO = 3

/**
 * Conciliacao bancaria — RF-074 a RF-078, a mesma tela do web.
 *
 * Importa o extrato do banco (OFX ou CSV) escolhido nos arquivos do celular,
 * mostra o que ainda nao bateu e, para cada transacao, os lancamentos que
 * batem. O que nao tem lancamento vira um, ja conciliado.
 */
export default function Conciliacao() {
  const [recorte, setRecorte] = useState<RecorteDaFila>('pending')
  const [transacoes, setTransacoes] = useState<TransacaoBancaria[] | null>(null)
  const [pendentes, setPendentes] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  const buscar = useCallback(async (scope: RecorteDaFila) => {
    const r = await carregarFila(scope)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setTransacoes(r.dados.transactions)
    setPendentes(r.dados.pendingCount)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar(recorte)
    })()
  }, [buscar, recorte])

  async function importar() {
    const escolha = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
    if (escolha.canceled) return
    const arquivo = escolha.assets[0]
    if (!arquivo) return
    const nome = arquivo.name.toLowerCase()
    if (!nome.endsWith('.ofx') && !nome.endsWith('.csv')) {
      Alert.alert('Arquivo não aceito', 'O extrato precisa ser um arquivo .ofx ou .csv do banco.')
      return
    }
    setImportando(true)
    let base64: string
    try {
      base64 = await new File(arquivo.uri).base64()
    } catch {
      setImportando(false)
      Alert.alert('Não deu para ler o arquivo', 'Escolha o arquivo de novo.')
      return
    }
    const r = await importarExtrato(arquivo.name, base64)
    setImportando(false)
    if (!r.ok) {
      Alert.alert('Não deu para importar', r.erro)
      return
    }
    Alert.alert(
      'Extrato importado',
      `${r.dados.imported} transação(ões) nova(s)` +
        (r.dados.ignored > 0 ? `, ${r.dados.ignored} já estavam aqui.` : '.'),
    )
    setRecorte('pending')
    await buscar('pending')
  }

  function pronto(mensagem: string) {
    setAberta(null)
    void buscar(recorte)
    Alert.alert('Conciliação', mensagem)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Conciliação"
        subtitulo={`${pendentes} transação(ões) por conciliar`}
        acao={
          <Botao onPress={() => void importar()} carregando={importando}>
            Importar
          </Botao>
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <View style={estilos.recortes}>
          {(
            [
              ['pending', 'Por conciliar'],
              ['reconciled', 'Conciliadas'],
            ] as const
          ).map(([valor, rotulo]) => (
            <Pressable
              key={valor}
              onPress={() => setRecorte(valor)}
              style={[estilos.recorte, recorte === valor && estilos.recorteAtivo]}
              accessibilityRole="button"
              accessibilityState={{ selected: recorte === valor }}
            >
              <Text style={[estilos.recorteTexto, recorte === valor && estilos.recorteTextoAtivo]}>
                {rotulo}
              </Text>
            </Pressable>
          ))}
        </View>

        {erro !== null ? (
          <Vazio
            titulo="Não deu para carregar"
            descricao={erro}
            acao={<Botao onPress={() => void buscar(recorte)}>Tentar de novo</Botao>}
          />
        ) : transacoes === null ? (
          <Vazio titulo="Carregando" descricao="Buscando as transações do extrato." />
        ) : transacoes.length === 0 ? (
          <Vazio
            titulo={recorte === 'pending' ? 'Tudo conciliado' : 'Nada conciliado ainda'}
            descricao={
              recorte === 'pending'
                ? 'Importe o extrato do banco (OFX ou CSV) para conferir com os lançamentos.'
                : undefined
            }
          />
        ) : (
          transacoes.map((t) => (
            <View key={t.id} style={estilos.transacao}>
              <Pressable
                onPress={() => setAberta(aberta === t.id ? null : t.id)}
                accessibilityRole="button"
                style={estilos.transacaoTopo}
              >
                <View style={estilos.flex}>
                  <Text style={estilos.nome} numberOfLines={2}>
                    {t.description}
                  </Text>
                  <Text style={estilos.apoio}>
                    {formatDate(t.postedOn)}
                    {t.counterparty ? ` · ${t.counterparty}` : ''}
                  </Text>
                </View>
                <Text style={[estilos.valor, t.direction === 'debit' && estilos.saida]}>
                  {t.direction === 'debit' ? '− ' : '+ '}
                  {formatMoney(t.amountCents / 100)}
                </Text>
              </Pressable>

              {t.reconciledWith !== null ? (
                <View style={estilos.conciliada}>
                  <Etiqueta tom="sucesso">Conciliada</Etiqueta>
                  <Text style={estilos.apoio} numberOfLines={1}>
                    {t.reconciledWith.counterparty} · {t.reconciledWith.description}
                  </Text>
                </View>
              ) : null}

              {aberta === t.id ? (
                t.reconciledWith === null ? (
                  <PainelDeConciliacao transacao={t} onPronto={pronto} />
                ) : (
                  <PainelDesfazer transacao={t} onPronto={pronto} />
                )
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function PainelDeConciliacao({
  transacao,
  onPronto,
}: {
  transacao: TransacaoBancaria
  onPronto: (mensagem: string) => void
}) {
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null)
  const [criando, setCriando] = useState(false)
  const [contraparte, setContraparte] = useState(transacao.counterparty ?? '')
  const [descricao, setDescricao] = useState(transacao.description)
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await carregarSugestoes(transacao.id)
      if (cancelado) return
      if (!r.ok) {
        setErro(r.erro)
        setSugestoes([])
        return
      }
      setSugestoes(r.dados.suggestions)
      /* Nada casa: o caminho util e criar o lancamento, entao ele ja abre. */
      setCriando(r.dados.suggestions.length === 0)
    })()
    return () => {
      cancelado = true
    }
  }, [transacao.id])

  async function aceitar(s: Sugestao) {
    setProcessando(true)
    setErro(null)
    const r = await conciliar(transacao.id, { entryKind: s.entry.entryKind, entryId: s.entry.id })
    setProcessando(false)
    if (!r.ok) return setErro(r.erro)
    onPronto(`Conciliado com ${s.entry.counterparty}.`)
  }

  async function criar() {
    setProcessando(true)
    setErro(null)
    const r = await criarLancamentoDaTransacao(transacao.id, {
      counterparty: contraparte.trim(),
      description: descricao.trim(),
    })
    setProcessando(false)
    if (!r.ok) return setErro(r.erro)
    onPronto('Lançamento criado e conciliado.')
  }

  if (sugestoes === null) {
    return <Text style={estilos.apoio}>Procurando lançamentos que batem...</Text>
  }

  return (
    <View style={estilos.painel}>
      {sugestoes.map((s) => (
        <View key={`${s.entry.entryKind}-${s.entry.id}`} style={estilos.sugestao}>
          <View style={estilos.flex}>
            <Text style={estilos.nome}>{s.entry.counterparty}</Text>
            <Text style={estilos.apoio} numberOfLines={1}>
              {s.entry.description} · vence {formatDate(s.entry.dueDate)}
            </Text>
            <Text style={estilos.apoio}>
              {formatMoney(s.expectedAmountCents / 100)}
              {s.daysApart > 0 ? ` · ${s.daysApart} dia(s) de diferença` : ' · mesmo dia'}
            </Text>
          </View>
          <Botao variante="secundario" onPress={() => void aceitar(s)} desabilitado={processando}>
            Conciliar
          </Botao>
        </View>
      ))}

      {criando ? (
        <View style={estilos.painel}>
          <Text style={estilos.apoio}>
            Nenhum lançamento bate. Crie um a partir da transação — ele já entra conciliado.
          </Text>
          <Campo rotulo="Contraparte" valor={contraparte} onChange={setContraparte} />
          <Campo rotulo="Descrição" valor={descricao} onChange={setDescricao} />
          <Botao
            onPress={() => void criar()}
            carregando={processando}
            desabilitado={contraparte.trim().length < 2 || descricao.trim().length < 2}
            largura
          >
            Criar lançamento
          </Botao>
        </View>
      ) : (
        <Pressable onPress={() => setCriando(true)} accessibilityRole="button">
          <Text style={estilos.link}>Nenhum serve? Criar lançamento</Text>
        </Pressable>
      )}

      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
    </View>
  )
}

function PainelDesfazer({
  transacao,
  onPronto,
}: {
  transacao: TransacaoBancaria
  onPronto: (mensagem: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function desfazer() {
    setProcessando(true)
    setErro(null)
    const r = await desfazerConciliacao(transacao.id, motivo.trim())
    setProcessando(false)
    if (!r.ok) return setErro(r.erro)
    onPronto('Conciliação desfeita. A transação voltou para a fila.')
  }

  return (
    <View style={estilos.painel}>
      <Campo
        rotulo="Motivo para desfazer"
        valor={motivo}
        onChange={setMotivo}
        placeholder="Ex.: conciliei com o título errado"
      />
      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
      <Botao
        variante="perigo"
        onPress={() => void desfazer()}
        carregando={processando}
        desabilitado={motivo.trim().length < MOTIVO_MINIMO}
        largura
      >
        Desfazer conciliação
      </Botao>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1, gap: 2 },
  recortes: { flexDirection: 'row', gap: espaco.sm },
  recorte: {
    flex: 1,
    paddingVertical: espaco.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  recorteAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  recorteTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  recorteTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
  transacao: {
    ...vidro.peca,
    gap: espaco.sm,
    padding: espaco.md,
    borderRadius: raio.md,
  },
  transacaoTopo: { flexDirection: 'row', gap: espaco.md, alignItems: 'center' },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  valor: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.sucesso },
  saida: { color: cores.erro },
  conciliada: { flexDirection: 'row', gap: espaco.sm, alignItems: 'center' },
  painel: { gap: espaco.sm },
  sugestao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.sm,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
}))
