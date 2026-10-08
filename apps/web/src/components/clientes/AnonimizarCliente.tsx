'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { anonimizarCliente, type ComprovanteDeAnonimizacao } from '@/lib/clientes-api'
import { formatDateTime } from '@/lib/format'
import styles from './detalhe.module.css'

/** O minimo do contrato: `reason` pede 10 caracteres. */
const MOTIVO_MINIMO = 10

/**
 * Atender um pedido de exclusao — NR-086, RF-127, RF-128, LGPD art. 18, VI.
 *
 * ## Anonimizar, e nao excluir — e a tela precisa dizer isso ANTES
 *
 * O titular pede exclusao e recebe anonimizacao: os campos pessoais somem, o
 * `id` e as vendas ficam. Se a tela dissesse "excluir cliente", o lojista
 * prometeria ao titular uma coisa e o sistema faria outra — e quem responde ao
 * titular e o lojista, nao nos.
 *
 * Por isso o texto explica a diferenca antes do botao, e nao depois. O
 * comprovante que volta e o que ele usa para responder.
 *
 * ## Irreversivel, e a tela nao finge que da para desfazer
 *
 * Os valores originais nao sao guardados em lugar nenhum — nem na trilha de
 * auditoria, de proposito: gravar o `before` ali criaria uma copia PERMANENTE
 * do dado que o titular pediu para excluir, no unico lugar do sistema de onde
 * ele nunca sairia. O pedido de exclusao viraria o registro definitivo do dado
 * excluido.
 *
 * Entao a confirmacao exige digitar o motivo, e nao apenas clicar duas vezes: o
 * motivo e o fundamento legal da operacao e vai para a trilha, e escrever
 * obriga a parar.
 */
export default function AnonimizarCliente({
  clienteId,
  nome,
  jaAnonimizado,
  onAnonimizado,
}: {
  clienteId: string
  nome: string
  /** Quando ja houve, a secao mostra o estado e nao oferece o botao. */
  jaAnonimizado: boolean
  onAnonimizado: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [comprovante, setComprovante] = useState<ComprovanteDeAnonimizacao | null>(null)

  const podeEnviar = motivo.trim().length >= MOTIVO_MINIMO && !enviando

  async function confirmar() {
    setEnviando(true)
    setErro(null)

    const r = await anonimizarCliente(clienteId, motivo.trim())
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setComprovante(r.dados)
    setAberto(false)
    setMotivo('')
    /* A ficha recarrega: o nome na tela passa a ser o substituto, e mostrar o
       nome antigo ao lado de um comprovante de anonimizacao seria contraditorio. */
    onAnonimizado()
  }

  if (comprovante !== null) {
    return (
      <Card title="Pedido de exclusão atendido">
        <p className={styles.privacidadeTexto}>
          Anonimizado em {formatDateTime(comprovante.anonymizedAt)}. Guarde este comprovante: e com
          ele que você responde ao titular.
        </p>

        <h4 className={styles.privacidadeSubtitulo}>Removido</h4>
        <p className={styles.privacidadeTexto}>{comprovante.scrubbedFields.join(', ')}</p>

        <h4 className={styles.privacidadeSubtitulo}>Preservado, e por que</h4>
        <ul className={styles.privacidadeLista}>
          {comprovante.preserved.map((p) => (
            <li key={p.what}>
              <strong>
                {p.rows} {p.what}
              </strong>{' '}
              — {p.because}
            </li>
          ))}
        </ul>

        {comprovante.deleted.length > 0 ? (
          <>
            <h4 className={styles.privacidadeSubtitulo}>Apagado</h4>
            <ul className={styles.privacidadeLista}>
              {comprovante.deleted.map((d) => (
                <li key={d.what}>
                  {d.rows} {d.what}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    )
  }

  if (jaAnonimizado) {
    return (
      <Card title="Dados pessoais removidos">
        <p className={styles.privacidadeTexto}>
          Este cliente teve os dados pessoais anonimizados a pedido do titular. As vendas e os
          títulos foram preservados sem identificação — os totais e os relatórios continuam
          corretos.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Pedido de exclusão (LGPD)">
      <p className={styles.privacidadeTexto}>
        Se <strong>{nome}</strong> pediu a exclusão dos dados dele, o sistema{' '}
        <strong>anonimiza</strong> em vez de apagar: nome, documento, telefone, e-mail, endereço e
        observações são removidos, e as vendas ficam sem identificação.
      </p>

      <p className={styles.privacidadeTexto}>
        As vendas ficam porque a lei fiscal obriga a guardá-las por cinco anos, e apagar mudaria
        seus totais de períodos já fechados. As notas fiscais não são alteradas — o XML é assinado,
        e mexer nele destrói o documento.
      </p>

      <p className={styles.privacidadeAviso}>
        Não há como desfazer. Os valores originais não ficam guardados em lugar nenhum.
      </p>

      {erro !== null ? (
        <p className={styles.privacidadeErro} role="alert">
          {erro}
        </p>
      ) : null}

      {aberto ? (
        <>
          <label className={styles.privacidadeCampo}>
            <span>Qual foi o pedido? (fica registrado na trilha)</span>
            <textarea
              className={styles.privacidadeTextarea}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: cliente pediu exclusão por e-mail em 09/09, protocolo 1234"
              maxLength={500}
              disabled={enviando}
              autoFocus
            />
          </label>

          <div className={styles.privacidadeAcoes}>
            <Button
              variant="secondary"
              onClick={() => {
                setAberto(false)
                setMotivo('')
                setErro(null)
              }}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmar} disabled={!podeEnviar}>
              {enviando ? 'Anonimizando...' : 'Anonimizar definitivamente'}
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.privacidadeAcoes}>
          <Button variant="secondary" onClick={() => setAberto(true)}>
            Atender pedido de exclusão
          </Button>
        </div>
      )}
    </Card>
  )
}
