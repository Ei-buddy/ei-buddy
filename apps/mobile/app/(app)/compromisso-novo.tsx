import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { SeletorCliente } from '@/components/SeletoresDoPdv'
import { hojeLocal, marcarCompromisso } from '@/lib/agenda-api'
import { dataDoTexto, formatDate, mascaraData } from '@/lib/format'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Marcar compromisso — NR-078, US-043, RF-089 e RF-091.
 *
 * Os mesmos campos do web: titulo, dia, inicio e fim, local, cliente,
 * observacao e lembrete.
 */
export default function CompromissoNovoScreen() {
  const router = useRouter()

  const [titulo, setTitulo] = useState('')
  const [dia, setDia] = useState(formatDate(hojeLocal()))
  const [hora, setHora] = useState('')
  const [horaFim, setHoraFim] = useState('')
  const [local, setLocal] = useState('')
  const [observacao, setObservacao] = useState('')
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)
  const [escolhendoCliente, setEscolhendoCliente] = useState(false)
  const [lembrete, setLembrete] = useState('30')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const diaIso = dataDoTexto(dia)
    const quando = diaIso === null ? null : montarInstante(diaIso, hora)
    const ate = diaIso === null || horaFim === '' ? undefined : montarInstante(diaIso, horaFim)

    if (titulo.trim().length < 2) {
      setErro('Diga do que se trata.')
      return
    }
    if (quando === null) {
      setErro('Confira o dia (DD/MM/AAAA) e a hora (HH:MM).')
      return
    }
    if (ate === null || (ate !== undefined && ate <= quando)) {
      setErro('O fim precisa ser uma hora depois do início.')
      return
    }

    const minutos = lembrete.trim() === '' ? undefined : Number(lembrete)
    if (minutos !== undefined && (!Number.isInteger(minutos) || minutos < 1)) {
      setErro('O lembrete é em minutos inteiros, a partir de 1.')
      return
    }

    setErro(null)
    setSalvando(true)

    const r = await marcarCompromisso({
      titulo: titulo.trim(),
      quando,
      ...(ate === undefined ? {} : { ate }),
      ...(local.trim() === '' ? {} : { local: local.trim() }),
      ...(observacao.trim() === '' ? {} : { observacao: observacao.trim() }),
      ...(cliente === null ? {} : { clienteId: cliente.id }),
      ...(minutos === undefined ? {} : { lembreteMinutosAntes: minutos }),
    })

    setSalvando(false)

    if (!r.ok) {
      /* A api recusa lembrete que cairia no passado, entre outras coisas. A
         mensagem dela ja explica; repetir em outras palavras so criaria duas
         versoes da mesma regra. */
      setErro(r.erro)
      return
    }

    Alert.alert('Compromisso marcado', titulo.trim(), [
      { text: 'OK', onPress: () => router.back() },
    ])
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Novo compromisso" subtitulo="Entrega, visita, pagamento" />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}

          <Campo
            rotulo="O que é"
            valor={titulo}
            onChange={setTitulo}
            placeholder="Entrega da Padaria Sol"
          />

          <Campo
            rotulo="Dia"
            valor={dia}
            onChange={(v) => setDia(mascaraData(v))}
            placeholder="DD/MM/AAAA"
            tipoTeclado="numeric"
          />

          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Campo
                rotulo="Início"
                valor={hora}
                onChange={(v) => setHora(mascaraHora(v))}
                placeholder="14:00"
                tipoTeclado="numeric"
              />
            </View>
            <View style={estilos.flex}>
              <Campo
                rotulo="Fim (opcional)"
                valor={horaFim}
                onChange={(v) => setHoraFim(mascaraHora(v))}
                placeholder="15:00"
                tipoTeclado="numeric"
              />
            </View>
          </View>

          <Campo rotulo="Local (opcional)" valor={local} onChange={setLocal} />

          <Pressable
            style={estilos.cliente}
            onPress={() => setEscolhendoCliente(true)}
            accessibilityRole="button"
          >
            <Text style={estilos.rotulo}>Cliente (opcional)</Text>
            <Text style={estilos.clienteNome}>{cliente?.nome ?? 'Escolher cliente'}</Text>
          </Pressable>

          <Campo rotulo="Observação (opcional)" valor={observacao} onChange={setObservacao} />

          <Campo
            rotulo="Lembrar quantos minutos antes"
            valor={lembrete}
            onChange={setLembrete}
            dica="Deixe em branco para não lembrar."
            tipoTeclado="numeric"
          />

          <Botao onPress={() => void salvar()} carregando={salvando} largura>
            {salvando ? 'Marcando...' : 'Marcar'}
          </Botao>
        </ScrollView>
      </KeyboardAvoidingView>

      {escolhendoCliente ? (
        <SeletorCliente
          onEscolher={(c) => {
            setCliente({ id: c.id, nome: c.nome })
            setEscolhendoCliente(false)
          }}
          onFechar={() => setEscolhendoCliente(false)}
        />
      ) : null}
    </SafeAreaView>
  )
}

/**
 * Monta o instante a partir de dia e hora LOCAIS.
 *
 * `new Date(\`${dia}T${hora}\`)` sem fuso e interpretado como local pelo
 * JavaScript — que e o que se quer aqui, porque o lojista digitou a hora do
 * relogio dele. A conversao para UTC acontece em `marcarCompromisso`, num lugar
 * so.
 *
 * Devolve `null` em vez de `Invalid Date`: comparacao com `Invalid Date` e
 * sempre falsa, e isso ja causou uma agenda vazia se passando por resposta
 * certa do outro lado do sistema.
 */
function montarInstante(dia: string, hora: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hora)) return null

  const d = new Date(`${dia}T${hora}:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "1430" vira "14:30" enquanto digita. */
function mascaraHora(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  linha: { flexDirection: 'row', gap: espaco.md },
  rotulo: { fontSize: fonte.pequeno, fontWeight: peso.medio, color: cores.textoFraco },
  cliente: {
    gap: espaco.xs,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
  },
  clienteNome: { fontSize: fonte.corpo, color: cores.texto },
  flex: { flex: 1 },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  erro: { color: cores.erro, fontSize: fonte.pequeno, fontWeight: peso.forte },
})
