'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CONTEXTO_VAZIO,
  comandosMaisUsados,
  enviarMensagem,
  registrarUso,
  type Contexto,
  type Mensagem,
} from '@/lib/assistente-api'
import { COMANDOS_DESTAQUE, GRUPOS_COMANDOS } from '@/lib/comandos'
import { PageHeader } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import dynamic from 'next/dynamic'
import { IconSparkles } from '@/components/Icons'
import BlocosResposta from './BlocosResposta'
import { hoje } from '@/lib/format'
import styles from './assistente.module.css'

/*
 * A data das mensagens vinha de uma constante fixa em 24/08/2026 — o
 * assistente datava a conversa em agosto por mais tempo que agosto durasse.
 * Agora vem de `hoje()`, a mesma fonte do resto do app.
 */

/*
 * A orb entra por import dinamico — NR-127.
 *
 * O Three.js pesa, e nenhuma outra tela do app o usa: carregado assim, ele so
 * baixa quando alguem abre o assistente. `ssr: false` porque WebGL nao existe
 * no servidor. Enquanto nao chega, o gradiente CSS do proprio componente ja
 * ocupa o lugar — ninguem ve buraco.
 */
const OrbDoAssistente = dynamic(() => import('./OrbDoAssistente'), { ssr: false })

export default function ChatAssistente() {
  const router = useRouter()
  const params = useSearchParams()

  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [contexto, setContexto] = useState<Contexto>(CONTEXTO_VAZIO)
  const [entrada, setEntrada] = useState('')
  const [pensando, setPensando] = useState(false)
  const [todosComandos, setTodosComandos] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const conversaRef = useRef<HTMLDivElement>(null)
  const entradaRef = useRef<HTMLTextAreaElement>(null)

  /* Contador em vez de Date.now(): id de mensagem so precisa ser unico
     dentro da conversa, e relogio no render nao e puro. */
  const proximoId = useRef(0)
  const novoId = () => `m-${++proximoId.current}`

  /* Pergunta vinda dos chips "Via WhatsApp" de outra tela. */
  const perguntaInicial = params.get('pergunta')
  const [perguntaUsada, setPerguntaUsada] = useState(false)

  if (perguntaInicial && !perguntaUsada) {
    setPerguntaUsada(true)
    setEntrada(perguntaInicial)
  }

  /* Rola a conversa para o fim quando ela cresce.
     Mexe no scrollTop do proprio container em vez de usar
     scrollIntoView: aquele rola todo ancestral rolavel, incluindo a
     pagina, e o efeito e a tela pular. */
  useEffect(() => {
    const caixa = conversaRef.current
    if (!caixa) return
    caixa.scrollTo({ top: caixa.scrollHeight, behavior: 'smooth' })
  }, [mensagens, pensando])

  async function perguntar(texto: string) {
    const limpo = texto.trim()
    if (!limpo || pensando) return

    const daPessoa: Mensagem = {
      id: novoId(),
      autor: 'usuario',
      canal: 'app',
      texto: limpo,
      data: hoje(),
    }

    setMensagens((atual) => [...atual, daPessoa])
    setEntrada('')
    setPensando(true)

    /* SUBSTITUIR POR: POST /assistente/mensagens — o contexto vai junto
       para o servidor resolver pronome ("o que ele comprou"). */
    const r = await enviarMensagem(limpo, contexto)

    /* SUBSTITUIR POR: POST /assistente/uso */
    registrarUso(r.intencao, limpo)

    setContexto(r.contexto)
    setMensagens((atual) => [
      ...atual,
      {
        id: novoId(),
        autor: 'assistente',
        canal: 'app',
        texto: r.texto,
        blocos: r.blocos,
        data: hoje(),
      },
    ])
    setPensando(false)
  }

  function executarAcao(acao: string) {
    if (acao === 'cancelar') {
      setToast('Tudo bem, não fiz nada.')
      return
    }
    if (acao === 'abrir_cadastro_cliente') {
      router.push('/app/clientes/novo')
      return
    }
    setToast('Esta acao entra quando o assistente estiver ligado ao backend.')
  }

  const sugeridos = comandosMaisUsados(3)
  const conversaVazia = mensagens.length === 0

  return (
    <>
      <PageHeader
        title="Assistente"
        subtitle="Pergunte em texto — as mesmas perguntas funcionam no WhatsApp"
      />

      <div className={styles.chat}>
        {/* ============ Conversa ============ */}
        <div className={styles.conversa} ref={conversaRef}>
          {conversaVazia ? (
            <div className={styles.boasVindas}>
              {/* A orb no lugar do icone: e o momento em que ela cabe — uma
                  so na tela, antes da conversa comecar. */}
              <OrbDoAssistente tamanho={64} />
              <h2>Como posso ajudar?</h2>
              <p>
                Pergunte sobre vendas, clientes, produtos ou contas. Se citar um cliente, eu guardo
                o assunto — dá para perguntar &ldquo;o que ele comprou&rdquo; logo em seguida.
              </p>
            </div>
          ) : (
            <ul className={styles.mensagens}>
              {mensagens.map((m) => (
                <li
                  key={m.id}
                  className={`${styles.mensagem} ${
                    m.autor === 'usuario' ? styles.daPessoa : styles.doAssistente
                  }`}
                >
                  {m.autor === 'assistente' ? (
                    <span className={styles.avatar} aria-hidden="true">
                      <IconSparkles size={15} />
                    </span>
                  ) : null}

                  <div className={styles.balao}>
                    <p className={styles.balaoTexto}>{m.texto}</p>
                    {m.blocos && m.blocos.length > 0 ? (
                      <div className={styles.blocos}>
                        <BlocosResposta blocos={m.blocos} onAcao={executarAcao} />
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {pensando ? (
            <div className={`${styles.mensagem} ${styles.doAssistente}`} aria-live="polite">
              {/* Enquanto pensa, a orb ocupa o avatar — de novo, uma so na
                  tela, e ela some assim que a resposta chega. O avatar das
                  mensagens continua sendo o icone leve: uma conversa longa
                  viraria dezenas de contextos WebGL vivos ao mesmo tempo. */}
              <OrbDoAssistente tamanho={30} />
              <div className={`${styles.balao} ${styles.digitando}`}>
                <span className={styles.ponto} />
                <span className={styles.ponto} />
                <span className={styles.ponto} />
                <span className={styles.digitandoTexto}>digitando</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* ============ Sugestoes ============ */}
        <div className={styles.sugestoes}>
          {sugeridos.length > 0 ? (
            <div className={styles.grupoSugestao}>
              <span className={styles.grupoRotulo}>Você costuma perguntar</span>
              <div className={styles.chips}>
                {sugeridos.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.chip} ${styles.chipDestaque}`}
                    onClick={() => perguntar(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!todosComandos ? (
            <div className={styles.chips}>
              {COMANDOS_DESTAQUE.map((c) => (
                <button key={c} type="button" className={styles.chip} onClick={() => perguntar(c)}>
                  {c}
                </button>
              ))}
              <button
                type="button"
                className={styles.chipMais}
                onClick={() => setTodosComandos(true)}
              >
                Ver todos
              </button>
            </div>
          ) : (
            <>
              {GRUPOS_COMANDOS.map((g) => (
                <div key={g.modulo} className={styles.grupoSugestao}>
                  <span className={styles.grupoRotulo}>{g.modulo}</span>
                  <div className={styles.chips}>
                    {g.comandos.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={styles.chip}
                        onClick={() => perguntar(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className={styles.chipMais}
                onClick={() => setTodosComandos(false)}
              >
                Mostrar menos
              </button>
            </>
          )}
        </div>

        {/* ============ Entrada ============ */}
        <form
          className={styles.entrada}
          onSubmit={(e) => {
            e.preventDefault()
            void perguntar(entrada)
          }}
        >
          {/* Anexo e audio espelham o uso no WhatsApp. A captura real entra
              com o backend — hoje avisam que ainda nao processam. */}
          <button
            type="button"
            className={styles.entradaBotao}
            onClick={() => setToast('Envio de foto entra junto com o backend do assistente.')}
            aria-label="Anexar foto"
          >
            <IconClipe />
          </button>

          <textarea
            ref={entradaRef}
            className={styles.entradaCampo}
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => {
              /* Enter envia; Shift+Enter quebra linha. */
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void perguntar(entrada)
              }
            }}
            placeholder="Pergunte alguma coisa..."
            rows={1}
            aria-label="Mensagem"
          />

          <button
            type="button"
            className={styles.entradaBotao}
            onClick={() => setToast('Gravação de áudio entra junto com o backend do assistente.')}
            aria-label="Gravar áudio"
          >
            <IconMicrofone />
          </button>

          <Button type="submit" disabled={!entrada.trim() || pensando}>
            Enviar
          </Button>
        </form>
      </div>

      {toast ? <Toast message={toast} tone="success" onClose={() => setToast(null)} /> : null}
    </>
  )
}

/* ------------------------------------------------------------------ */

function IconClipe() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5 12.2 19.3a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.2-7.2" />
    </svg>
  )
}

function IconMicrofone() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </svg>
  )
}
