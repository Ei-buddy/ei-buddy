'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ABAS_DA_FILA,
  abrirChamado,
  carregarFila,
  contagemDaAba,
  encerrarChamado,
  responderChamado,
  ROTULO_CATEGORIA,
  situacaoDoChamado,
  type ChamadoAberto,
  type PaginaDaFila,
  type SituacaoDaFila,
} from '@/lib/admin-chamados-api'
import { formatDateTime } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './chamados.module.css'

/**
 * Chamados de todas as lojas — NR-215.
 *
 * Achado do QA: "Suporte — como enxergaremos os chamados?". O chamado so
 * existia dentro da loja que o abriu. Aqui a equipe EiBuddy ve a fila,
 * responde como "Suporte EiBuddy" (a loja recebe como mensagem nao lida, no
 * proprio Suporte) e encerra.
 *
 * Abre em "Para responder": o que esta com a bola do nosso lado, porque o
 * cliente falou por ultimo.
 */

const TOM: Record<SituacaoDaFila, 'warning' | 'info' | 'success' | 'neutral'> = {
  responder: 'warning',
  aguardando: 'info',
  encerrados: 'success',
  todos: 'neutral',
}

const ROTULO_SITUACAO: Record<Exclude<SituacaoDaFila, 'todos'>, string> = {
  responder: 'Para responder',
  aguardando: 'Aguardando cliente',
  encerrados: 'Encerrado',
}

export default function AdminChamadosView() {
  const [aba, setAba] = useState<SituacaoDaFila>('responder')
  const [fila, setFila] = useState<PaginaDaFila | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<ChamadoAberto | null>(null)
  const [resposta, setResposta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)
  const detalheRef = useRef<HTMLDivElement>(null)

  const buscar = useCallback(async (qual: SituacaoDaFila) => {
    const r = await carregarFila(qual)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setFila(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await buscar(aba)
    })()
  }, [aba, buscar])

  async function abrir(id: string) {
    const r = await abrirChamado(id)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setAberto(r.dados)
    setResposta('')
    /* No celular o detalhe fica embaixo da lista: leva a pessoa ate ele. */
    requestAnimationFrame(() => detalheRef.current?.scrollIntoView({ block: 'start' }))
  }

  async function responder() {
    if (aberto === null || resposta.trim() === '') return
    setEnviando(true)
    const r = await responderChamado(aberto.id, resposta)
    setEnviando(false)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setAberto(r.dados)
    setResposta('')
    setToast({ msg: `Resposta enviada para ${r.dados.companyName}.`, tone: 'success' })
    void buscar(aba)
  }

  async function encerrar() {
    if (aberto === null) return
    setEnviando(true)
    const r = await encerrarChamado(aberto.id)
    setEnviando(false)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setAberto(r.dados)
    setToast({ msg: `Chamado ${r.dados.protocol} encerrado.`, tone: 'success' })
    void buscar(aba)
  }

  const situacaoAberta = aberto === null ? null : situacaoDoChamado(aberto)

  return (
    <>
      <PageHeader
        title="Chamados"
        subtitle="Os chamados de suporte de todas as lojas: responda como Suporte EiBuddy"
      />

      <div className={styles.abas} role="tablist" aria-label="Situação dos chamados">
        {ABAS_DA_FILA.map((a) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={aba === a.valor}
            className={`${styles.aba} ${aba === a.valor ? styles.abaAtiva : ''}`}
            onClick={() => {
              setAba(a.valor)
              setAberto(null)
            }}
          >
            {a.rotulo}
            <span className={styles.contagem}>
              {fila === null ? '—' : contagemDaAba(fila.counts, a.valor)}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.grade}>
        <Card title={ABAS_DA_FILA.find((a) => a.valor === aba)?.rotulo ?? 'Chamados'}>
          {erro !== null ? (
            <EmptyState title="Não deu para carregar os chamados" description={erro} />
          ) : fila === null ? (
            <p className={styles.vazio}>Carregando...</p>
          ) : fila.tickets.length === 0 ? (
            <p className={styles.vazio}>
              {aba === 'responder' ? 'Nenhum chamado esperando resposta.' : 'Nenhum chamado aqui.'}
            </p>
          ) : (
            <ul className={styles.lista}>
              {fila.tickets.map((c) => {
                const s = situacaoDoChamado(c)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${aberto?.id === c.id ? styles.itemAtivo : ''}`}
                      onClick={() => void abrir(c.id)}
                    >
                      <span className={styles.itemTopo}>
                        <strong>{c.subject}</strong>
                        <Badge tone={TOM[s]}>
                          {ROTULO_SITUACAO[s as keyof typeof ROTULO_SITUACAO]}
                        </Badge>
                      </span>
                      <span className={styles.itemApoio}>
                        {c.companyName} · {ROTULO_CATEGORIA[c.category] ?? c.category} ·{' '}
                        {c.protocol}
                      </span>
                      <span className={styles.itemApoio}>
                        {c.messagesCount} {c.messagesCount === 1 ? 'mensagem' : 'mensagens'} ·{' '}
                        {formatDateTime(c.updatedAt)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div ref={detalheRef}>
          <Card title={aberto === null ? 'Conversa' : aberto.subject}>
            {aberto === null ? (
              <p className={styles.vazio}>Escolha um chamado para ver a conversa e responder.</p>
            ) : (
              <div className={styles.detalhe}>
                <p className={styles.itemApoio}>
                  {aberto.companyName} · {ROTULO_CATEGORIA[aberto.category] ?? aberto.category} ·{' '}
                  {aberto.protocol}
                  {situacaoAberta !== null && situacaoAberta !== 'todos' ? (
                    <>
                      {' · '}
                      <Badge tone={TOM[situacaoAberta]}>{ROTULO_SITUACAO[situacaoAberta]}</Badge>
                    </>
                  ) : null}
                </p>

                <ol className={styles.conversa} aria-label="Conversa">
                  {aberto.messages.map((m) => (
                    <li
                      key={m.id}
                      className={m.author === 'suporte' ? styles.doSuporte : styles.doCliente}
                    >
                      <span className={styles.autor}>
                        {m.authorName} · {formatDateTime(m.createdAt)}
                      </span>
                      <span className={styles.texto}>{m.body}</span>
                      {m.attachment ? (
                        <span className={styles.anexo}>Anexo citado: {m.attachment}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>

                <label className={styles.campo}>
                  <span>Responder como Suporte EiBuddy</span>
                  <textarea
                    value={resposta}
                    onChange={(e) => setResposta(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    placeholder="Escreva a resposta para a loja"
                    disabled={enviando}
                  />
                </label>

                <div className={styles.acoes}>
                  {aberto.status !== 'closed' ? (
                    <Button variant="secondary" onClick={() => void encerrar()} disabled={enviando}>
                      Encerrar chamado
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void responder()}
                    disabled={enviando || resposta.trim() === ''}
                  >
                    {enviando ? 'Enviando...' : 'Enviar resposta'}
                  </Button>
                </div>
                {aberto.status === 'closed' ? (
                  <p className={styles.itemApoio}>
                    Encerrado. Responder reabre o chamado para a loja.
                  </p>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
