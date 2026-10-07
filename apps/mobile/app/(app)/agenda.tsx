import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  agendaDoDia,
  cancelarCompromisso,
  type CompromissoDaApi,
  hojeLocal,
  horaLocal,
} from '@/lib/agenda-api'
import { formatDate } from '@/lib/format'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Agenda do dia — NR-078, US-045.
 *
 * Versao enxuta: no celular o que importa e "o que tenho para hoje e amanha".
 * Calendario mensal fica no web.
 *
 * ## O que mudou ao ligar na api
 *
 * A tela de demonstracao tinha um marcador de **concluido**, com um toque para
 * riscar o item. Esse conceito NAO existe no servidor: `appointments.status` e
 * `scheduled` ou `cancelled`, e so.
 *
 * Trocar "feito" por "cancelado" seria inverter o significado — um e sucesso, o
 * outro e "nao vai acontecer". Entao o marcador saiu, e o que ficou e cancelar,
 * que e o que a api sabe fazer. Marcar como concluido, se o produto quiser,
 * pede coluna nova e uma decisao de time.
 */
export default function Agenda() {
  const router = useRouter()
  const [hoje, setHoje] = useState<CompromissoDaApi[]>([])
  const [amanha, setAmanha] = useState<CompromissoDaApi[]>([])
  /** Veio do servidor, e nao deduzido de lista vazia — US-045. */
  const [diaLivre, setDiaLivre] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)

    const dias = proximosDois()
    const [a, b] = await Promise.all([agendaDoDia(dias.hoje), agendaDoDia(dias.amanha)])

    /*
     * Um erro em qualquer um dos dois vira erro da tela. Mostrar metade da
     * agenda sem dizer que a outra metade falhou e pior que nao mostrar nada:
     * o lojista se organiza a partir do que ve.
     */
    if (!a.ok) {
      setErro(a.erro)
      setCarregando(false)
      return
    }
    if (!b.ok) {
      setErro(b.erro)
      setCarregando(false)
      return
    }

    setHoje([...a.dados.compromissos])
    setAmanha([...b.dados.compromissos])
    setDiaLivre(a.dados.livre)
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /* Editar abre o mesmo formulario do cadastro, ja preenchido — NR-152. */
  function editar(c: CompromissoDaApi) {
    router.push({ pathname: '/compromisso-novo', params: { compromisso: JSON.stringify(c) } })
  }

  function cancelar(c: CompromissoDaApi) {
    Alert.alert(
      'Cancelar compromisso',
      `${c.title}\n\nEle sai da agenda, mas continua no histórico.`,
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Cancelar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const r = await cancelarCompromisso(c.id)
              if (!r.ok) {
                Alert.alert('Não deu para cancelar', r.erro)
                return
              }
              /* Recarrega em vez de tirar da lista na mao: o servidor e a
                 fonte da verdade, e entre a leitura e agora outra pessoa pode
                 ter mexido na agenda. */
              await carregar()
            })()
          },
        },
      ],
    )
  }

  const subtitulo = carregando
    ? 'Carregando...'
    : erro !== null
      ? 'Não foi possível carregar'
      : hoje.length === 0
        ? 'Nada marcado para hoje'
        : `${hoje.length} hoje`

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Agenda"
        subtitulo={subtitulo}
        acao={<Botao onPress={() => router.push({ pathname: '/compromisso-novo' })}>Marcar</Botao>}
      />

      <ScrollView
        contentContainerStyle={estilos.conteudo}
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />
        }
      >
        {carregando && hoje.length === 0 ? (
          <ActivityIndicator color={cores.acento} style={estilos.espera} />
        ) : erro !== null ? (
          <Vazio titulo="Não deu para carregar" descricao={erro} />
        ) : (
          <>
            <Secao titulo="Hoje">
              {hoje.length === 0 ? (
                /* "Agenda livre" dito com todas as letras — US-045 pede
                   confirmacao explicita, e nao uma lista vazia que tambem
                   apareceria se a consulta tivesse falhado. */
                <Vazio
                  titulo={diaLivre ? 'Dia livre' : 'Nada marcado'}
                  descricao="Nenhum compromisso para hoje."
                />
              ) : (
                hoje.map((c) => (
                  <LinhaCompromisso
                    key={c.id}
                    item={c}
                    onEditar={() => editar(c)}
                    onCancelar={() => cancelar(c)}
                  />
                ))
              )}
            </Secao>

            {amanha.length > 0 ? (
              <Secao titulo="Amanhã">
                {amanha.map((c) => (
                  <LinhaCompromisso
                    key={c.id}
                    item={c}
                    mostrarData
                    onEditar={() => editar(c)}
                    onCancelar={() => cancelar(c)}
                  />
                ))}
              </Secao>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * Hoje e amanha, no fuso do APARELHO.
 *
 * Somar 24h a `Date.now()` erraria no dia da virada do horario de verao, onde o
 * dia tem 23 ou 25 horas. Somar 1 ao dia do calendario e deixar o `Date`
 * normalizar acerta sempre.
 */
function proximosDois(agora = new Date()): { hoje: string; amanha: string } {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  return { hoje: hojeLocal(agora), amanha: hojeLocal(d) }
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={estilos.secao}>
      <Text style={estilos.secaoTitulo}>{titulo}</Text>
      <View style={estilos.secaoItens}>{children}</View>
    </View>
  )
}

function LinhaCompromisso({
  item,
  mostrarData = false,
  onEditar,
  onCancelar,
}: {
  item: CompromissoDaApi
  mostrarData?: boolean
  onEditar: () => void
  onCancelar: () => void
}) {
  return (
    <Pressable
      onPress={onEditar}
      onLongPress={onCancelar}
      style={estilos.compromisso}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint="Toque para editar; toque e segure para cancelar"
    >
      <View style={estilos.compromissoInfo}>
        <Text style={estilos.compromissoTitulo} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={estilos.compromissoApoio}>
          {mostrarData ? `${formatDate(item.startsAt.slice(0, 10))} · ` : ''}
          {horaLocal(item.startsAt)}
        </Text>
      </View>

      {item.reminderMinutesBefore !== null ? <Etiqueta tom="neutro">lembrete</Etiqueta> : null}
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },

  conteudo: { padding: espaco.lg, gap: espaco.xl },
  espera: { marginTop: espaco.xl },

  secao: { gap: espaco.md },
  secaoTitulo: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  secaoItens: { gap: espaco.sm },

  compromisso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  compromissoInfo: { flex: 1, gap: 2 },
  compromissoTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  compromissoApoio: { fontSize: fonte.micro, color: cores.textoFraco },
})
