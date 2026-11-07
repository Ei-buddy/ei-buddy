'use client'

import { useRef, useState } from 'react'
import { COLUNAS, comentarCard, moverCard, type CardCrm, type ColunaId } from '@/lib/crm-api'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconCheck, IconClose } from '@/components/Icons'
import styles from './crm.module.css'
import { useDialogo } from '@/components/app/useDialogo'

/**
 * Painel de detalhe do card: historico, comentarios e conclusao.
 *
 * O historico e o ponto do CRM — sem ele, "ja falei com esse cliente?"
 * volta a depender da memoria de quem atendeu.
 */
export default function CardDetalhe({
  card,
  onFechar,
  onAtualizar,
}: {
  card: CardCrm
  onFechar: () => void
  onAtualizar: (card: CardCrm) => void
}) {
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useDialogo(ref, onFechar)

  async function enviarComentario(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)
    setEnviando(true)

    const r = await comentarCard(card.id, comentario)
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onAtualizar({ ...card, comentarios: [...card.comentarios, r.dados] })
    setComentario('')
  }

  async function mudarColuna(coluna: ColunaId) {
    const anterior = card.coluna
    onAtualizar({ ...card, coluna })

    const r = await moverCard(card.id, coluna)
    if (!r.ok) {
      onAtualizar({ ...card, coluna: anterior })
      setErro('Não foi possível mover o card.')
    }
  }

  const concluido = card.coluna === 'concluido'

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={onFechar}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={`${styles.dialogPainel} ${styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-titulo"
        tabIndex={-1}
      >
        <header className={styles.detalheCabecalho}>
          <div className={styles.detalheTags}>
            <Badge tone={card.tipo === 'pendencia' ? 'warning' : 'info'}>
              {card.tipo === 'pendencia' ? 'Pendência' : 'Contato'}
            </Badge>
            <Badge tone={concluido ? 'success' : 'neutral'}>
              {COLUNAS.find((c) => c.id === card.coluna)?.titulo}
            </Badge>
          </div>
          <button
            type="button"
            className={styles.dialogFechar}
            onClick={onFechar}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <h2 id="card-titulo" className={styles.detalheTitulo}>
          {card.titulo}
        </h2>

        {card.descricao ? <p className={styles.detalheDescricao}>{card.descricao}</p> : null}

        <dl className={styles.detalheDados}>
          <div>
            <dt>Cliente</dt>
            <dd>{card.clienteNome ?? 'Sem cliente'}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{formatDate(card.data)}</dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>{card.responsavelNome ?? 'Ninguém ainda'}</dd>
          </div>
        </dl>

        {/* --- Mudar coluna --- */}
        <div className={styles.detalheColunas} role="group" aria-label="Status">
          {COLUNAS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.detalheColuna} ${card.coluna === c.id ? styles.detalheColunaAtiva : ''}`}
              onClick={() => void mudarColuna(c.id)}
              aria-pressed={card.coluna === c.id}
            >
              {c.titulo}
            </button>
          ))}
        </div>

        {/* --- Historico --- */}
        <section className={styles.historico}>
          <h3 className={styles.historicoTitulo}>Histórico</h3>

          <ul className={styles.comentarios}>
            {/* Evento de criacao: o card sempre tem ao menos esta linha */}
            <li className={styles.comentario}>
              <span className={styles.comentarioAutor}>Sistema</span>
              <span className={styles.comentarioData}>{formatDate(card.criadoEm)}</span>
              <p className={styles.comentarioTexto}>Card criado.</p>
            </li>

            {card.comentarios.map((c) => (
              <li key={c.id} className={styles.comentario}>
                <span className={styles.comentarioAutor}>{c.autor}</span>
                <span className={styles.comentarioData}>{formatDate(c.data)}</span>
                <p className={styles.comentarioTexto}>{c.texto}</p>
              </li>
            ))}
          </ul>

          <form onSubmit={enviarComentario} className={styles.comentarForm}>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Registrar o que foi combinado, o que o cliente respondeu..."
              rows={2}
              aria-label="Novo comentário"
            />
            {erro ? (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            ) : null}
            <div className={styles.comentarAcoes}>
              <Button type="submit" size="sm" disabled={enviando || !comentario.trim()}>
                {enviando ? (
                  <>
                    <Spinner size={14} />
                    Enviando...
                  </>
                ) : (
                  'Comentar'
                )}
              </Button>
            </div>
          </form>
        </section>

        <div className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onFechar}>
            Fechar
          </Button>
          {!concluido ? (
            <Button onClick={() => void mudarColuna('concluido')}>
              <IconCheck size={16} />
              Marcar como concluído
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
