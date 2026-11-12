import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import Botao from '@/components/ui/Botao'
import { Cartao, Etiqueta, Vazio } from '@/components/ui/Cartao'
import { formatDateTime } from '@/lib/format'
import {
  ABAS_DA_FILA,
  abrirChamadoDaFila,
  carregarFilaDeChamados,
  contagemDaAba,
  encerrarChamadoDaFila,
  responderChamadoDaFila,
  situacaoDoChamado,
  type ChamadoAberto,
  type ChamadoDaFila,
  type ContagensDaFila,
  type SituacaoDaFila,
} from '@/lib/plataforma-api'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Chamados de todas as lojas — NR-215, o par da tela do web.
 *
 * Tocar num chamado abre a conversa logo abaixo dele, com a resposta e o
 * encerrar. A loja recebe a resposta como mensagem nao lida no Suporte.
 */

const ROTULO: Record<Exclude<SituacaoDaFila, 'todos'>, string> = {
  responder: 'Para responder',
  aguardando: 'Aguardando cliente',
  encerrados: 'Encerrado',
}

const TOM: Record<Exclude<SituacaoDaFila, 'todos'>, 'atencao' | 'neutro' | 'sucesso'> = {
  responder: 'atencao',
  aguardando: 'neutro',
  encerrados: 'sucesso',
}

export default function ChamadosDaPlataforma() {
  const [aba, setAba] = useState<SituacaoDaFila>('responder')
  const [chamados, setChamados] = useState<ChamadoDaFila[] | null>(null)
  const [contagens, setContagens] = useState<ContagensDaFila | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<ChamadoAberto | null>(null)
  const [resposta, setResposta] = useState('')
  const [enviando, setEnviando] = useState(false)

  const buscar = useCallback(async (qual: SituacaoDaFila) => {
    const r = await carregarFilaDeChamados(qual)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setChamados(r.dados.tickets)
    setContagens(r.dados.counts)
  }, [])

  useEffect(() => {
    void buscar(aba)
  }, [aba, buscar])

  async function abrir(id: string) {
    if (aberto?.id === id) {
      setAberto(null)
      return
    }
    const r = await abrirChamadoDaFila(id)
    if (!r.ok) return Alert.alert('Chamado', r.erro)
    setAberto(r.dados)
    setResposta('')
  }

  async function responder() {
    if (aberto === null || resposta.trim() === '') return
    setEnviando(true)
    const r = await responderChamadoDaFila(aberto.id, resposta)
    setEnviando(false)
    if (!r.ok) return Alert.alert('Não deu para responder', r.erro)
    setAberto(r.dados)
    setResposta('')
    acompanhar(r.dados)
  }

  /* Respondido, o chamado sai de "Para responder". A conversa mora dentro do
     item da lista: vai junto para a aba onde ele esta agora, ainda aberta. */
  function acompanhar(c: ChamadoAberto) {
    const agora = situacaoDoChamado(c)
    if (aba !== 'todos' && agora !== aba) setAba(agora)
    else void buscar(aba)
  }

  async function encerrar() {
    if (aberto === null) return
    setEnviando(true)
    const r = await encerrarChamadoDaFila(aberto.id)
    setEnviando(false)
    if (!r.ok) return Alert.alert('Não deu para encerrar', r.erro)
    setAberto(r.dados)
    acompanhar(r.dados)
  }

  return (
    <View style={estilos.tela}>
      <View style={estilos.abas}>
        {ABAS_DA_FILA.map(([valor, rotulo]) => (
          <Pressable
            key={valor}
            onPress={() => {
              setAba(valor)
              setAberto(null)
            }}
            style={[estilos.aba, aba === valor && estilos.abaAtiva]}
            accessibilityRole="button"
            accessibilityState={{ selected: aba === valor }}
          >
            <Text style={[estilos.abaTexto, aba === valor && estilos.abaTextoAtivo]}>
              {contagens === null ? rotulo : `${rotulo} (${contagemDaAba(contagens, valor)})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {erro !== null ? (
        <Vazio titulo="Não deu para carregar" descricao={erro} />
      ) : chamados === null ? (
        <Vazio titulo="Carregando" />
      ) : chamados.length === 0 ? (
        <Vazio
          titulo={aba === 'responder' ? 'Nenhum chamado esperando resposta' : 'Nenhum chamado aqui'}
        />
      ) : (
        chamados.map((c) => {
          const s = situacaoDoChamado(c) as Exclude<SituacaoDaFila, 'todos'>
          const expandido = aberto?.id === c.id
          return (
            <Cartao key={c.id}>
              <Pressable
                onPress={() => void abrir(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Chamado ${c.protocol}`}
                style={estilos.cabeca}
              >
                <View style={estilos.linha}>
                  <Text style={[estilos.titulo, estilos.flex]}>{c.subject}</Text>
                  <Etiqueta tom={TOM[s]}>{ROTULO[s]}</Etiqueta>
                </View>
                <Text style={estilos.apoio}>
                  {c.companyName} · {c.protocol}
                </Text>
                <Text style={estilos.apoio}>
                  {c.messagesCount} mensagem(ns) · {formatDateTime(c.updatedAt)}
                </Text>
              </Pressable>

              {expandido && aberto !== null ? (
                <View style={estilos.detalhe}>
                  {aberto.messages.map((m) => (
                    <View
                      key={m.id}
                      style={[estilos.msg, m.author === 'suporte' ? estilos.doSuporte : null]}
                    >
                      <Text style={estilos.apoio}>
                        {m.authorName} · {formatDateTime(m.createdAt)}
                      </Text>
                      <Text style={estilos.texto}>{m.body}</Text>
                    </View>
                  ))}
                  <TextInput
                    style={estilos.campo}
                    value={resposta}
                    onChangeText={setResposta}
                    placeholder="Responder como Suporte EiBuddy"
                    placeholderTextColor={cores.textoFraco}
                    multiline
                    accessibilityLabel="Resposta do suporte"
                  />
                  <Botao
                    onPress={() => void responder()}
                    carregando={enviando}
                    desabilitado={resposta.trim() === ''}
                    largura
                  >
                    Enviar resposta
                  </Botao>
                  {aberto.status !== 'closed' ? (
                    <Botao variante="secundario" onPress={() => void encerrar()} largura>
                      Encerrar chamado
                    </Botao>
                  ) : (
                    <Text style={estilos.apoio}>Encerrado. Responder reabre o chamado.</Text>
                  )}
                </View>
              ) : null}
            </Cartao>
          )
        })
      )}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { gap: espaco.md },
  abas: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  aba: {
    paddingVertical: espaco.xs,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  abaAtiva: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  abaTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  abaTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
  cabeca: { gap: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  flex: { flex: 1 },
  titulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  texto: { fontSize: fonte.pequeno, color: cores.texto },
  detalhe: { gap: espaco.sm, marginTop: espaco.md },
  msg: {
    gap: 2,
    padding: espaco.sm,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  doSuporte: { alignSelf: 'flex-end', backgroundColor: cores.sucessoFundo },
  campo: {
    minHeight: 80,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    color: cores.texto,
    fontSize: fonte.pequeno,
    textAlignVertical: 'top',
  },
}))
