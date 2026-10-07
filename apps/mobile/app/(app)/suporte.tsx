import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import Campo from '@/components/ui/Campo'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  abrirChamado,
  abrirDetalhe,
  type CategoriaChamado,
  CATEGORIAS,
  type Chamado,
  listarChamados,
  MINIMO_ASSUNTO,
  MINIMO_DESCRICAO,
  responderChamado,
  ROTULO_STATUS,
  type StatusChamado,
} from '@/lib/suporte-api'
import { formatDate, formatDateTime } from '@/lib/format'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

const TOM_STATUS: Record<StatusChamado, 'neutro' | 'sucesso' | 'atencao' | 'erro'> = {
  open: 'atencao',
  waiting: 'atencao',
  closed: 'neutro',
}

const rotuloDaCategoria = (c: CategoriaChamado) =>
  CATEGORIAS.find((x) => x.valor === c)?.rotulo ?? c

/**
 * Suporte — US-062.
 *
 * ## O que esta tela era
 *
 * Dois chamados escritos no codigo e um `abrirChamado` que esperava 800ms e
 * empilhava um objeto no `useState`. O lojista descrevia o problema, lia "O time
 * responde por aqui e por e-mail", e ninguem do outro lado recebia nada — o
 * chamado desaparecia quando o app fechava. As rotas existem desde a NR-080,
 * com banco e painel do suporte; faltava o cliente.
 *
 * ## A conversa carrega ao ABRIR o chamado
 *
 * A lista devolve resumo, sem mensagens: uma lista que traz toda conversa de
 * todo chamado cresce sem limite. A sanfona ganhou `onAbrir` e e ela que busca o
 * detalhe.
 *
 * Isso tem uma consequencia que mudou o comportamento da tela: abrir MARCA
 * LIDO. Antes as respondidas abriam sozinhas (`inicialAberta`), o que era
 * cortesia enquanto nada era gravado — agora apagaria o aviso de resposta nova
 * de chamados que ninguem leu, e nao ha como desmarcar. Elas ficam fechadas,
 * com o contador de nao lidas a vista.
 *
 * ## Responder ficou aqui
 *
 * `POST /suporte/chamados/:id/mensagens` existe e o celular nao usava. Sem isso,
 * a unica forma de continuar uma conversa era abrir OUTRO chamado — e o suporte
 * recebia dois protocolos para o mesmo problema.
 */
export default function Suporte() {
  const [chamados, setChamados] = useState<Chamado[]>([])
  const [abertos, setAbertos] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const buscar = useCallback(async () => {
    const r = await listarChamados()
    setCarregando(false)
    setAtualizando(false)

    if (!r.ok) {
      setErroCarga(r.message)
      return
    }

    setErroCarga(null)
    /*
     * As mensagens ja carregadas SOBREVIVEM ao recarregamento.
     *
     * A lista vem sem elas. Sobrescrever de cabeca fecharia a conversa que a
     * pessoa esta lendo — e o "puxar para atualizar" e exatamente o gesto de
     * quem espera resposta com o chamado aberto na tela.
     */
    setChamados((atual) => {
      const conversas = new Map(atual.map((c) => [c.id, c.mensagens]))
      return r.dados.chamados.map((c) => ({
        ...c,
        mensagens: c.mensagens.length > 0 ? c.mensagens : (conversas.get(c.id) ?? []),
      }))
    })
    setAbertos(r.dados.abertos)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  /* --- Abrir chamado --- */
  const [assunto, setAssunto] = useState('')
  const [categoria, setCategoria] = useState<CategoriaChamado>('tecnico')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    if (aviso === null) return

    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  /*
   * Os minimos sao conferidos AQUI antes de ir na rede.
   *
   * Nao para substituir o servidor — ele confere de novo, e e ele que decide —,
   * mas porque "diga em poucas palavras do que se trata" chegando depois de uma
   * ida a rede, no balcao com sinal ruim, e uma espera para nada.
   */
  const assuntoCurto = assunto.trim().length > 0 && assunto.trim().length < MINIMO_ASSUNTO
  const descricaoCurta = descricao.trim().length > 0 && descricao.trim().length < MINIMO_DESCRICAO
  const podeAbrir =
    assunto.trim().length >= MINIMO_ASSUNTO && descricao.trim().length >= MINIMO_DESCRICAO

  async function enviarChamado() {
    setEnviando(true)
    setErroForm(null)

    const r = await abrirChamado({ assunto, categoria, descricao })
    setEnviando(false)

    if (!r.ok) {
      setErroForm(r.message)
      return
    }

    setAssunto('')
    setDescricao('')
    /* O PROTOCOLO e o que a pessoa anota — vem do servidor, nao de
       `Math.random()` como o falso fazia. */
    setAviso(`Chamado ${r.dados.protocolo} aberto. O time responde por aqui.`)

    await buscar()
  }

  /* --- Detalhe e resposta --- */
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null)
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [respondendo, setRespondendo] = useState<string | null>(null)

  /** Guarda a conversa no chamado e zera as nao lidas que o servidor zerou. */
  function guardarDetalhe(detalhe: Chamado) {
    setChamados((atual) => atual.map((c) => (c.id === detalhe.id ? { ...c, ...detalhe } : c)))
  }

  async function carregarConversa(chamado: Chamado) {
    /*
     * Ja carregada E sem nada novo: nao busca de novo. Fechar e reabrir a
     * sanfona nao e pedido de recarregar — para isso existe o puxar para baixo.
     *
     * O `naoLidas` na condicao nao e detalhe: a lista atualiza o contador sem
     * trazer mensagem, entao um chamado lido ontem e respondido hoje chega aqui
     * com a conversa ANTIGA em memoria. So o `mensagens.length` na guarda
     * abriria a sanfona sem a resposta nova — e sem marca-la lida, deixando o
     * contador aceso sobre uma conversa que a pessoa acha que leu.
     */
    if (chamado.mensagens.length > 0 && chamado.naoLidas === 0) return

    setCarregandoDetalhe(chamado.id)
    const r = await abrirDetalhe(chamado.id)
    setCarregandoDetalhe(null)

    if (!r.ok) {
      setAviso(r.message)
      return
    }

    guardarDetalhe(r.dados)
  }

  async function enviarResposta(chamadoId: string) {
    const texto = (respostas[chamadoId] ?? '').trim()
    if (texto === '') return

    setRespondendo(chamadoId)
    const r = await responderChamado(chamadoId, texto)
    setRespondendo(null)

    if (!r.ok) {
      setAviso(r.message)
      return
    }

    setRespostas((atual) => ({ ...atual, [chamadoId]: '' }))
    guardarDetalhe(r.dados)
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Suporte"
        subtitulo={abertos > 0 ? `${abertos} em aberto` : 'nenhum em aberto'}
      />

      <ScrollView
        contentContainerStyle={estilos.conteudo}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true)
              void buscar()
            }}
          />
        }
      >
        <Sanfona titulo="Abrir chamado" resumo="descreva o problema">
          <Campo
            rotulo="Assunto"
            valor={assunto}
            onChange={setAssunto}
            erro={assuntoCurto ? 'Diga em poucas palavras do que se trata.' : null}
            placeholder="Resumo em uma linha"
            editavel={!enviando}
          />

          <Text style={estilos.rotulo}>Categoria</Text>
          <View style={estilos.categorias}>
            {CATEGORIAS.map((c) => (
              <Pressable
                key={c.valor}
                onPress={() => setCategoria(c.valor)}
                disabled={enviando}
                style={[estilos.chip, categoria === c.valor && estilos.chipAtivo]}
                accessibilityRole="radio"
                accessibilityState={{ selected: categoria === c.valor }}
              >
                <Text style={[estilos.chipTexto, categoria === c.valor && estilos.chipTextoAtivo]}>
                  {c.rotulo}
                </Text>
              </Pressable>
            ))}
          </View>

          <Campo
            rotulo="O que aconteceu"
            valor={descricao}
            onChange={setDescricao}
            erro={
              descricaoCurta
                ? 'Conte o que aconteceu — quanto mais detalhe, mais rápida a resposta.'
                : null
            }
            dica="O que você fez, e o que apareceu na tela."
            placeholder="Conte o que você fez e o que apareceu"
            editavel={!enviando}
          />

          {erroForm !== null ? (
            <Text style={estilos.erro} accessibilityRole="alert">
              {erroForm}
            </Text>
          ) : null}

          <Botao onPress={enviarChamado} carregando={enviando} desabilitado={!podeAbrir} largura>
            {enviando ? 'Enviando...' : 'Abrir chamado'}
          </Botao>
        </Sanfona>

        {carregando ? (
          <Vazio titulo="Carregando" descricao="Buscando seus chamados." />
        ) : erroCarga !== null ? (
          <Vazio
            titulo="Não foi possível carregar"
            /* Puxar para atualizar continua valendo: no balcao o sinal cai, e o
               caminho de tentar de novo tem de estar a mao. */
            descricao={`${erroCarga} Puxe para baixo para tentar de novo.`}
          />
        ) : chamados.length === 0 ? (
          <Vazio
            titulo="Nenhum chamado"
            descricao="Quando precisar de ajuda, abra um chamado acima."
          />
        ) : (
          chamados.map((c) => (
            <Sanfona
              key={c.id}
              titulo={c.assunto}
              resumo={`${c.protocolo} · ${rotuloDaCategoria(c.categoria)} · ${formatDate(c.atualizadoEm)}`}
              etiqueta={
                <View style={estilos.etiquetas}>
                  {c.naoLidas > 0 ? <Etiqueta tom="sucesso">{c.naoLidas} nova(s)</Etiqueta> : null}
                  <Etiqueta tom={TOM_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Etiqueta>
                </View>
              }
              onAbrir={() => void carregarConversa(c)}
            >
              {carregandoDetalhe === c.id ? (
                <Text style={estilos.apoio}>Carregando a conversa...</Text>
              ) : c.mensagens.length === 0 ? (
                <Text style={estilos.apoio}>Não deu para carregar a conversa.</Text>
              ) : (
                c.mensagens.map((m) => (
                  <View
                    key={m.id}
                    style={[estilos.mensagem, m.autor === 'suporte' && estilos.mensagemSuporte]}
                  >
                    <Text style={estilos.mensagemDe}>
                      {m.autor === 'suporte' ? m.autorNome : 'Você'} · {formatDateTime(m.data)}
                    </Text>
                    <Text style={estilos.mensagemTexto}>{m.texto}</Text>
                    {m.anexo !== null ? (
                      <Text style={estilos.mensagemAnexo}>Anexo: {m.anexo}</Text>
                    ) : null}
                  </View>
                ))
              )}

              {/* Chamado encerrado nao recebe resposta: o campo apareceria e o
                  servidor recusaria depois de a pessoa digitar. */}
              {c.status !== 'closed' && c.mensagens.length > 0 ? (
                <>
                  <Campo
                    rotulo="Responder"
                    valor={respostas[c.id] ?? ''}
                    onChange={(v) => setRespostas((atual) => ({ ...atual, [c.id]: v }))}
                    placeholder="Escreva sua resposta"
                    editavel={respondendo !== c.id}
                  />
                  <Botao
                    onPress={() => void enviarResposta(c.id)}
                    carregando={respondendo === c.id}
                    desabilitado={(respostas[c.id] ?? '').trim() === ''}
                    largura
                  >
                    {respondendo === c.id ? 'Enviando...' : 'Enviar resposta'}
                  </Botao>
                </>
              ) : null}
            </Sanfona>
          ))
        )}
      </ScrollView>

      {/* A faixa de resposta, no lugar do `Alert` que existia aqui: no celular,
          um alerta de sucesso cobra um toque em "ok" para a pessoa poder ver a
          lista que acabou de mudar. */}
      {aviso !== null ? (
        <View style={estilos.aviso} accessibilityLiveRegion="polite">
          <Text style={estilos.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  rotulo: { fontSize: fonte.pequeno, fontWeight: peso.medio, color: cores.textoFraco },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  categorias: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  etiquetas: { flexDirection: 'row', alignItems: 'center', gap: espaco.xs },

  /* Chip no lugar de `Botao`: cinco botoes primarios lado a lado disputavam a
     atencao com o de abrir o chamado, que e a acao da secao. */
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.campo,
  },
  chipAtivo: { ...vidro.ativo },
  chipTexto: { fontSize: fonte.micro, color: cores.texto },
  chipTextoAtivo: { color: cores.textoSobreAtivo, fontWeight: peso.forte },

  mensagem: {
    padding: espaco.md,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    gap: espaco.xs,
  },
  mensagemSuporte: { backgroundColor: cores.sucessoFundo },
  mensagemDe: { fontSize: 11, fontWeight: peso.forte, color: cores.textoFraco },
  mensagemTexto: { fontSize: fonte.micro, lineHeight: 19, color: cores.texto },
  mensagemAnexo: { fontSize: 11, color: cores.textoFraco },

  erro: {
    padding: espaco.md,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.erro,
    color: cores.erro,
    fontSize: fonte.micro,
    lineHeight: 19,
  },

  aviso: {
    ...vidro.painel,
    position: 'absolute',
    left: espaco.lg,
    right: espaco.lg,
    bottom: espaco.xl,
    padding: espaco.md,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.sucesso,
  },
  avisoTexto: { fontSize: fonte.pequeno, color: cores.texto },
})
