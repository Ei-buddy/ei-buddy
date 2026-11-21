'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelarNfse,
  estadoDaNfse,
  pedirNfse,
  situacaoCertificado,
  type NfseDaVenda as Nfse,
  type SituacaoCertificado,
} from '@/lib/vendas-api'
import { formatCentavos } from '@/lib/format'
import { Badge } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import styles from './vendas.module.css'

/**
 * A NFS-e dos servicos da venda — DEC-031, NR-242.
 *
 * A NFS-e nacional e ASSINCRONA: pedida, ela fica "processando" ate o Ambiente
 * Nacional responder — de segundos a alguns minutos. A tela acompanha por um
 * minuto e, se ainda nao saiu, deixa o botao de atualizar: a venda ja esta
 * registrada, e dizer "falhou" mandaria o lojista pedir de novo.
 *
 * Serve a etapa fiscal do PDV e o detalhe da venda, para os dois mostrarem o
 * mesmo estado do mesmo jeito.
 */

/** A cada 4 s, por um minuto. O servidor so consulta o provedor a cada 20 s. */
const INTERVALO_MS = 4_000
const CONSULTAS_NA_TELA = 15

export default function NfseDaVenda({
  vendaId,
  podeCancelar = true,
}: {
  vendaId: string
  /** Venda estornada nao cancela nota pela tela: o estorno ja exigiu isso. */
  podeCancelar?: boolean
}) {
  const [nfse, setNfse] = useState<Nfse | null | undefined>(undefined)
  const [certificado, setCertificado] = useState<SituacaoCertificado | null>(null)
  const [carregou, setCarregou] = useState(false)
  const [pedindo, setPedindo] = useState(false)
  const [acompanhando, setAcompanhando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [processandoCancelamento, setProcessandoCancelamento] = useState(false)
  const ativo = useRef(true)

  useEffect(() => {
    ativo.current = true
    return () => {
      ativo.current = false
    }
  }, [])

  /** Consulta ate a nota sair de "processando", por no maximo um minuto. */
  const acompanhar = useCallback(async () => {
    setAcompanhando(true)
    for (let i = 0; i < CONSULTAS_NA_TELA && ativo.current; i += 1) {
      await new Promise((r) => setTimeout(r, INTERVALO_MS))
      const atual = await estadoDaNfse(vendaId)
      if (!ativo.current) return
      if (atual !== undefined) setNfse(atual)
      if (atual !== undefined && atual !== null && atual.status !== 'processing') break
    }
    if (ativo.current) setAcompanhando(false)
  }, [vendaId])

  useEffect(() => {
    let cancelado = false
    void (async () => {
      /* Sem certificado valido, nao ha como pedir — como na NFC-e. Pedir assim
         mesmo levaria o pedido a um servidor sem emissor de verdade. */
      const [atual, cert] = await Promise.all([estadoDaNfse(vendaId), situacaoCertificado()])
      if (cancelado) return
      setNfse(atual)
      setCertificado(cert)
      setCarregou(true)
      if (atual?.status === 'processing') void acompanhar()
    })()
    return () => {
      cancelado = true
    }
  }, [vendaId, acompanhar])

  async function emitir() {
    setPedindo(true)
    setErro(null)
    const r = await pedirNfse(vendaId)
    setPedindo(false)
    if (!r.ok) {
      /* A mensagem do servidor diz o que falta e onde (Codigo de Tributacao
         Nacional, cidade da loja, servico sem NBS) — mostrar inteira. */
      setErro(r.error)
      return
    }
    setNfse(r.nfse)
    if (r.nfse.status === 'processing') void acompanhar()
  }

  async function atualizar() {
    const atual = await estadoDaNfse(vendaId)
    if (atual !== undefined) setNfse(atual)
    if (atual?.status === 'processing') void acompanhar()
  }

  async function confirmarCancelamento() {
    if (justificativa.trim().length < 15) {
      setErro('A justificativa do cancelamento precisa de ao menos 15 caracteres.')
      return
    }
    setProcessandoCancelamento(true)
    const r = await cancelarNfse(vendaId, justificativa)
    setProcessandoCancelamento(false)
    if (!r.ok) {
      setErro(r.error)
      setCancelando(false)
      return
    }
    setNfse(r.nfse)
    setErro(null)
    setCancelando(false)
    setJustificativa('')
  }

  if (!carregou) {
    return (
      <p className={styles.carregando}>
        <Spinner size={15} />
        Consultando a NFS-e...
      </p>
    )
  }

  return (
    <div className={styles.nfse}>
      {nfse === null || nfse === undefined ? (
        <div className={styles.notaDetalhe}>
          <Badge tone="neutral">NFS-e</Badge>
          <span className={styles.semNota}>
            {nfse === undefined
              ? 'Não deu para consultar a NFS-e agora.'
              : certificado !== 'valido'
                ? 'Para emitir a NFS-e dos serviços, cadastre um certificado digital A1 válido em Empresa.'
                : 'Para os serviços da venda (produtos com NBS no cadastro).'}
          </span>
          {certificado === 'valido' ? (
            <Button size="sm" onClick={() => void emitir()} disabled={pedindo}>
              {pedindo ? 'Pedindo...' : 'Emitir NFS-e'}
            </Button>
          ) : null}
        </div>
      ) : nfse.status === 'processing' ? (
        <div className={styles.notaDetalhe}>
          <Badge tone="info">NFS-e</Badge>
          {acompanhando ? <Spinner size={15} /> : null}
          <span className={styles.semNota}>
            Processando no Ambiente Nacional · {formatCentavos(nfse.amountCents)}
          </span>
          {acompanhando ? null : (
            <Button size="sm" variant="secondary" onClick={() => void atualizar()}>
              Atualizar
            </Button>
          )}
        </div>
      ) : nfse.status === 'authorized' ? (
        <div className={styles.notaDetalhe}>
          <Badge tone="success">NFS-e</Badge>
          <strong>Número {nfse.number}</strong>
          {nfse.accessKey !== null ? (
            <span className={styles.notaChave}>{nfse.accessKey}</span>
          ) : null}
          {nfse.danfseUrl !== null ? (
            <ButtonLink
              href={nfse.danfseUrl}
              variant="secondary"
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              Baixar PDF
            </ButtonLink>
          ) : null}
          {nfse.publicUrl !== null ? (
            <ButtonLink
              href={nfse.publicUrl}
              variant="ghost"
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver no portal
            </ButtonLink>
          ) : null}
          {podeCancelar ? (
            <Button size="sm" variant="secondary" onClick={() => setCancelando(true)}>
              Cancelar NFS-e
            </Button>
          ) : null}
        </div>
      ) : nfse.status === 'rejected' ? (
        <div className={styles.notaDetalhe}>
          <Badge tone="danger">NFS-e recusada</Badge>
          <span className={styles.semNota}>{nfse.rejection?.message}</span>
          <Button size="sm" onClick={() => void emitir()} disabled={pedindo}>
            {pedindo ? 'Pedindo...' : 'Tentar de novo'}
          </Button>
        </div>
      ) : (
        <p className={styles.semNota}>NFS-e {nfse.number ?? ''} cancelada.</p>
      )}

      {erro !== null ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      {cancelando && nfse?.status === 'authorized' ? (
        <ConfirmarDialog
          titulo="Cancelar a NFS-e"
          descricao="A NFS-e é cancelada no Ambiente Nacional. O prazo é o do município; fora dele, o cancelamento é recusado e o contador orienta o que fazer."
          tom="perigo"
          rotuloConfirmar="Cancelar NFS-e"
          processando={processandoCancelamento}
          detalhe={
            <div className={styles.estornoDetalhe}>
              <strong>NFS-e número {nfse.number}</strong>
              <label className={styles.estornoMotivo}>
                Justificativa (mínimo 15 caracteres)
                <input
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Serviço lançado em duplicidade"
                  maxLength={255}
                  autoFocus
                />
              </label>
            </div>
          }
          onConfirmar={() => void confirmarCancelamento()}
          onCancelar={() => setCancelando(false)}
        />
      ) : null}
    </div>
  )
}
