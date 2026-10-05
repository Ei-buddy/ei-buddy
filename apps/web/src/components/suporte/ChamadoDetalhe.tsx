'use client'

import { useEffect, useRef, useState } from 'react'
import {
  abrirDetalhe,
  CATEGORIAS,
  responderChamado,
  ROTULO_STATUS,
  type Chamado,
} from '@/lib/suporte-api'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconClose, IconUpload } from '@/components/Icons'
import styles from './suporte.module.css'

/**
 * Conversa do chamado.
 *
 * Mesmo formato do Assistente de proposito: quem abre um chamado ja sabe
 * conversar por chat, e nao precisa aprender uma segunda gramatica de tela
 * para falar com o suporte.
 */
export default function ChamadoDetalhe({
  chamado,
  onFechar,
  onAtualizar,
}: {
  chamado: Chamado
  onFechar: () => void
  onAtualizar: (chamado: Chamado) => void
}) {
  const [resposta, setResposta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onFechar])

  /* Abrir o chamado zera o contador de respostas nao lidas. */
  const [jaMarcou, setJaMarcou] = useState(false)
  useEffect(() => {
    if (jaMarcou || chamado.naoLidas === 0) return

    let cancelado = false
    async function marcar() {
      /*
       * `abrirDetalhe` marca lido E devolve a conversa na mesma ida.
       *
       * Duas chamadas fariam o badge piscar — ele apagaria depois que as
       * mensagens ja tivessem aparecido. E a resposta ja traz as mensagens
       * novas que chegaram desde que a lista foi carregada, que e justamente o
       * que a pessoa veio ler.
       */
      const r = await abrirDetalhe(chamado.id)
      if (cancelado) return
      setJaMarcou(true)
      onAtualizar(r.ok ? r.dados : { ...chamado, naoLidas: 0 })
    }
    void marcar()

    return () => {
      cancelado = true
    }
  }, [chamado, jaMarcou, onAtualizar])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [chamado.mensagens.length])

  async function enviar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)
    setEnviando(true)

    const r = await responderChamado(chamado.id, resposta, null)
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    /*
     * O chamado INTEIRO vem da resposta, e nao remendado aqui.
     *
     * Antes a tela montava o novo estado a mao: acrescentava a mensagem, e
     * adivinhava o status ("se estava encerrado, vira aberto"). Quem decide o
     * status e o servidor — e ele reabre como `andamento`, nao `aberto`. Duas
     * regras para a mesma coisa divergem no dia em que uma das duas mudar.
     */
    onAtualizar(r.dados)
    setResposta('')
  }

  const encerrado = chamado.status === 'closed'

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
        aria-labelledby="chamado-titulo"
        tabIndex={-1}
      >
        <header className={styles.detalheCabecalho}>
          <div className={styles.detalheTopo}>
            <span className={styles.detalheProtocolo}>#{chamado.protocolo}</span>
            <Badge tone={encerrado ? 'success' : 'info'}>{ROTULO_STATUS[chamado.status]}</Badge>
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

        <h2 id="chamado-titulo" className={styles.detalheTitulo}>
          {chamado.assunto}
        </h2>
        <p className={styles.detalheMeta}>
          {CATEGORIAS.find((c) => c.valor === chamado.categoria)?.rotulo} · aberto em{' '}
          {formatDate(chamado.abertoEm)}
        </p>

        {/* --- Conversa --- */}
        <ul className={styles.conversa}>
          {chamado.mensagens.map((m) => (
            <li
              key={m.id}
              className={`${styles.mensagem} ${
                m.autor === 'cliente' ? styles.daPessoa : styles.doSuporte
              }`}
            >
              <div className={styles.balao}>
                <span className={styles.balaoAutor}>
                  {m.autorNome} · {formatDate(m.data)}
                </span>
                <p className={styles.balaoTexto}>{m.texto}</p>
                {m.anexo ? (
                  <span className={styles.balaoAnexo}>
                    <IconUpload size={13} />
                    {m.anexo}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
          <div ref={fimRef} />
        </ul>

        {/* --- Resposta --- */}
        <form onSubmit={enviar} className={styles.respostaForm}>
          {encerrado ? (
            <p className={styles.reabrirAviso}>
              Este chamado foi encerrado. Se ainda precisar de ajuda, é só responder — ele reabre
              automaticamente.
            </p>
          ) : null}

          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            placeholder="Escreva sua resposta ou acrescente informação"
            rows={3}
            aria-label="Resposta"
          />

          <div className={styles.respostaBarra}>
            {/* Sem anexo: so o nome do arquivo viajava, e o arquivo nao. */}
            <span />

            <Button type="submit" disabled={enviando || !resposta.trim()}>
              {enviando ? (
                <>
                  <Spinner size={15} />
                  Enviando...
                </>
              ) : (
                'Responder'
              )}
            </Button>
          </div>

          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  )
}
