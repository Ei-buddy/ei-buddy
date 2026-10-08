import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  COLUNAS,
  comentarCard,
  listarCards,
  moverCard,
  type CardCrm,
  type ColunaId,
} from '@/lib/crm-api'
import { formatDate, formatDateTime, daysUntil } from '@/lib/format'
import NovoCardModal from '@/components/NovoCardModal'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import Sanfona from '@/components/ui/Sanfona'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * CRM — NR-109.
 *
 * O web mostra um quadro Kanban com as colunas lado a lado. No celular
 * isso viraria rolagem horizontal dentro de vertical — desconfortavel.
 * Aqui cada coluna e uma sanfona, e mover o card e um toque nos botoes
 * de destino, que funciona no toque e no leitor de tela (arrastar nao).
 *
 * Como no web: criar card (com cliente e responsavel) e comentar — tocar no
 * card abre a descricao e os comentarios.
 */
export default function Crm() {
  const [cards, setCards] = useState<CardCrm[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  const buscar = useCallback(async () => {
    const r = await listarCards()
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setCards(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  const porColuna = useMemo(() => {
    const mapa = new Map<ColunaId, CardCrm[]>()
    for (const c of COLUNAS) mapa.set(c.id, [])
    for (const card of cards) {
      mapa.get(card.coluna)?.push(card)
    }
    return mapa
  }, [cards])

  async function mover(id: string, destino: ColunaId) {
    const anterior = cards.find((c) => c.id === id)?.coluna
    if (!anterior || anterior === destino) return

    /* Move na tela antes da resposta e desfaz se falhar — arrastar card
       que demora a responder parece travado. */
    setCards((atual) => atual.map((c) => (c.id === id ? { ...c, coluna: destino } : c)))

    const r = await moverCard(id, destino)
    if (!r.ok) {
      setCards((atual) => atual.map((c) => (c.id === id ? { ...c, coluna: anterior } : c)))
    }
  }

  const aFazer = porColuna.get('afazer')?.length ?? 0

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="CRM"
        subtitulo={carregando ? 'carregando' : aFazer > 0 ? `${aFazer} a fazer` : 'nada pendente'}
        acao={<Botao onPress={() => setCriando(true)}>Novo</Botao>}
      />

      {carregando ? (
        <View style={estilos.centro}>
          <ActivityIndicator color={cores.acento} />
        </View>
      ) : erro !== null ? (
        <View style={estilos.centro}>
          <Vazio
            titulo="Não deu para carregar o quadro"
            descricao={erro}
            acao={
              <Botao
                variante="secundario"
                onPress={() => {
                  setCarregando(true)
                  setErro(null)
                  void buscar()
                }}
              >
                Tentar de novo
              </Botao>
            }
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={estilos.conteudo}>
          {COLUNAS.map((coluna) => {
            const lista = porColuna.get(coluna.id) ?? []

            return (
              <Sanfona
                key={coluna.id}
                titulo={coluna.titulo}
                resumo={`${lista.length} card(s)`}
                etiqueta={
                  coluna.id === 'afazer' && lista.length > 0 ? (
                    <Etiqueta tom="atencao">{lista.length}</Etiqueta>
                  ) : undefined
                }
                inicialAberta={coluna.id !== 'concluido'}
              >
                {lista.length === 0 ? (
                  <Text style={estilos.vazio}>Nada nesta coluna.</Text>
                ) : (
                  lista.map((card) => (
                    <CardLinha
                      key={card.id}
                      card={card}
                      onMover={(destino) => void mover(card.id, destino)}
                      onComentado={(c) =>
                        setCards((atual) =>
                          atual.map((x) =>
                            x.id === card.id ? { ...x, comentarios: [...x.comentarios, c] } : x,
                          ),
                        )
                      }
                    />
                  ))
                )}
              </Sanfona>
            )
          })}
        </ScrollView>
      )}

      {criando ? (
        <NovoCardModal
          onCriado={(card) => {
            setCriando(false)
            setCards((atual) => [card, ...atual])
          }}
          onFechar={() => setCriando(false)}
        />
      ) : null}
    </SafeAreaView>
  )
}

function CardLinha({
  card,
  onMover,
  onComentado,
}: {
  card: CardCrm
  onMover: (destino: ColunaId) => void
  onComentado: (c: CardCrm['comentarios'][number]) => void
}) {
  const atrasado = card.coluna !== 'concluido' && daysUntil(card.data) < 0
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function comentar() {
    setEnviando(true)
    setErro(null)
    const r = await comentarCard(card.id, texto)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setTexto('')
    onComentado(r.dados)
  }

  return (
    <View style={estilos.card}>
      <View style={estilos.cardTopo}>
        <Etiqueta tom={card.tipo === 'pendencia' ? 'atencao' : 'neutro'}>
          {card.tipo === 'pendencia' ? 'Pendência' : 'Contato'}
        </Etiqueta>
        {atrasado ? <Etiqueta tom="erro">Atrasado</Etiqueta> : null}
      </View>

      <Pressable onPress={() => setAberto((a) => !a)} accessibilityRole="button">
        <Text style={estilos.cardTitulo}>{card.titulo}</Text>
      </Pressable>
      <Text style={estilos.cardApoio} numberOfLines={1}>
        {card.clienteNome ?? 'Sem cliente'} · {formatDate(card.data)}
      </Text>
      <Text style={estilos.cardOrigem}>
        {card.responsavelNome ? `Com ${card.responsavelNome.split(' ')[0]}` : 'Sem responsável'}
        {card.comentarios.length > 0 ? ` · ${card.comentarios.length} comentário(s)` : ''}
      </Text>

      {aberto ? (
        <View style={estilos.detalhe}>
          {card.descricao ? <Text style={estilos.cardApoio}>{card.descricao}</Text> : null}
          {card.comentarios.map((c) => (
            <View key={c.id} style={estilos.comentario}>
              <Text style={estilos.cardOrigem}>
                {c.autor} · {formatDateTime(c.data)}
              </Text>
              <Text style={estilos.cardApoio}>{c.texto}</Text>
            </View>
          ))}
          <View style={estilos.comentar}>
            <TextInput
              style={estilos.comentarCampo}
              value={texto}
              onChangeText={setTexto}
              placeholder="Escreva um comentário"
              placeholderTextColor={cores.textoFraco}
              accessibilityLabel="Comentário"
            />
            <Botao
              variante="secundario"
              onPress={() => void comentar()}
              carregando={enviando}
              desabilitado={texto.trim() === ''}
            >
              Enviar
            </Botao>
          </View>
          {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
        </View>
      ) : null}

      {/* Botoes de destino no lugar de arrastar: funciona no toque e e
          alcancavel pelo leitor de tela. */}
      <View style={estilos.mover}>
        {COLUNAS.filter((c) => c.id !== card.coluna).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => onMover(c.id)}
            style={estilos.moverBotao}
            accessibilityRole="button"
            accessibilityLabel={`Mover ${card.titulo} para ${c.titulo}`}
          >
            <Text style={estilos.moverTexto}>{c.titulo}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.lg },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  vazio: { fontSize: fonte.pequeno, color: cores.textoFraco },

  card: {
    gap: espaco.sm,
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  cardTopo: { flexDirection: 'row', gap: espaco.sm },
  cardTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  cardApoio: { fontSize: fonte.micro, color: cores.textoFraco },
  cardOrigem: { fontSize: 11, color: cores.textoFraco, opacity: 0.7 },

  mover: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: espaco.xs },
  moverBotao: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
    minHeight: 36,
    justifyContent: 'center',
  },
  moverTexto: { fontSize: fonte.micro, color: cores.textoFraco },

  detalhe: { gap: espaco.sm, paddingTop: espaco.xs },
  comentario: { gap: 2, paddingLeft: espaco.sm, borderLeftWidth: 2, borderLeftColor: cores.borda },
  comentar: { flexDirection: 'row', gap: espaco.sm, alignItems: 'center' },
  comentarCampo: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    fontSize: fonte.pequeno,
    color: cores.texto,
  },
  erro: { fontSize: fonte.micro, color: cores.erro },
}))
