'use client'

import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PIX_EXPIRATION_MINUTES, type PixCharge, type PixChargeStatus } from '@/lib/auth-api'
import { formatMoney } from '@/lib/format'
import { IconCheck } from '@/components/Icons'
import { Spinner } from '@/components/auth/Fields'
import styles from './cobrancaPix.module.css'

/** Intervalo do polling de confirmacao, em ms. */
const POLL_INTERVAL = 4000

type Estado = 'carregando' | 'aguardando' | 'confirmado' | 'expirado' | 'erro'

/**
 * Cobranca por Pix, com os quatro estados: aguardando (com contador e
 * polling), confirmado, expirado e erro.
 *
 * Compartilhado entre a assinatura (criar conta) e a venda no PDV — o que
 * muda entre os dois e de onde vem a cobranca, nao a tela. Por isso as
 * chamadas entram por prop em vez de virem importadas: o componente nao
 * precisa saber se esta cobrando mensalidade ou venda de balcao.
 */
export default function CobrancaPix({
  titulo,
  subtitulo,
  amount,
  criarCobranca,
  consultarStatus,
  onPago,
  textoSucesso,
}: {
  /** Nome do que esta sendo cobrado (plano, numero da venda...). */
  titulo: string
  /** Linha de apoio ao lado do valor. */
  subtitulo: string
  amount: number
  /** SUBSTITUIR no chamador: POST da cobranca no backend. */
  criarCobranca: (amount: number) => Promise<PixCharge>
  /** SUBSTITUIR no chamador: GET do status da cobranca. */
  consultarStatus: (chargeId: string) => Promise<PixChargeStatus>
  onPago: () => void
  textoSucesso?: string
}) {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [charge, setCharge] = useState<PixCharge | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [restante, setRestante] = useState(PIX_EXPIRATION_MINUTES * 60)
  const [copiado, setCopiado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /* Incrementar dispara uma nova cobranca (botao "gerar novo codigo"). */
  const [tentativa, setTentativa] = useState(0)

  /* Descarta polling de uma cobranca antiga apos regerar. */
  const chargeIdRef = useRef<string | null>(null)

  /* ---------------------------------------------------------------- *
   * Geracao da cobranca + QR Code
   * ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      try {
        /* SUBSTITUIR POR: POST /billing/charges */
        const nova = await criarCobranca(amount)
        if (cancelado) return

        chargeIdRef.current = nova.chargeId

        /* O QR e desenhado no proprio navegador a partir do payload que o
           backend devolve — nenhuma imagem vem de servico externo. */
        const url = await QRCode.toDataURL(nova.payload, {
          width: 460,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#1e2a78', light: '#ffffff' },
        })
        if (cancelado) return

        setCharge(nova)
        setQrDataUrl(url)
        setRestante(Math.max(0, Math.round((nova.expiresAt - Date.now()) / 1000)))
        setEstado('aguardando')
      } catch {
        if (cancelado) return
        setErro('Não foi possível gerar o código de pagamento.')
        setEstado('erro')
      }
    }

    void carregar()

    return () => {
      cancelado = true
    }
  }, [criarCobranca, amount, tentativa])

  /** Acao do usuario: limpa a tela e dispara o efeito de novo. */
  const gerarNovoCodigo = useCallback(() => {
    setEstado('carregando')
    setErro(null)
    setQrDataUrl(null)
    setCharge(null)
    setCopiado(false)
    setTentativa((n) => n + 1)
  }, [])

  /* ---------------------------------------------------------------- *
   * Contador de expiracao
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (estado !== 'aguardando') return

    const timer = setInterval(() => {
      setRestante((s) => {
        if (s <= 1) {
          setEstado('expirado')
          return 0
        }
        return s - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [estado])

  /* ---------------------------------------------------------------- *
   * Polling de confirmacao
   * Trocar por webhook + SSE/websocket quando o backend suportar.
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (estado !== 'aguardando' || !charge) return

    const idAtual = charge.chargeId

    const timer = setInterval(async () => {
      try {
        /* SUBSTITUIR POR: GET /billing/charges/:id */
        const status = await consultarStatus(idAtual)
        if (chargeIdRef.current !== idAtual) return

        if (status === 'paid') {
          setEstado('confirmado')
        } else if (status === 'expired') {
          setEstado('expirado')
        }
      } catch {
        /* Falha de rede pontual nao derruba a tela — segue tentando. */
      }
    }, POLL_INTERVAL)

    return () => clearInterval(timer)
  }, [estado, charge, consultarStatus])

  /* Redireciona pouco depois de confirmar, para o usuario ver o sucesso. */
  useEffect(() => {
    if (estado !== 'confirmado') return
    const timer = setTimeout(onPago, 1800)
    return () => clearTimeout(timer)
  }, [estado, onPago])

  /* ---------------------------------------------------------------- *
   * Copiar codigo
   * ---------------------------------------------------------------- */

  async function copiar() {
    if (!charge) return
    try {
      await navigator.clipboard.writeText(charge.payload)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2200)
    } catch {
      setErro('Não foi possível copiar. Selecione o código manualmente.')
    }
  }

  const minutos = String(Math.floor(restante / 60)).padStart(2, '0')
  const segundos = String(restante % 60).padStart(2, '0')
  const expirandoLogo = restante > 0 && restante <= 120

  /* ================================================================ *
   * Estado: confirmado
   * ================================================================ */

  if (estado === 'confirmado') {
    return (
      <div className={`${styles.card} ${styles.cardSuccess}`}>
        <span className={styles.successIcon}>
          <IconCheck size={30} />
        </span>
        <h2 className={styles.successTitle}>Pagamento confirmado!</h2>
        <p className={styles.successText}>{textoSucesso ?? `${titulo} confirmado.`}</p>
        <div className={styles.successBar} aria-hidden="true">
          <span />
        </div>
      </div>
    )
  }

  /* ================================================================ *
   * Estados: expirado e erro
   * ================================================================ */

  if (estado === 'expirado' || estado === 'erro') {
    const expirou = estado === 'expirado'
    return (
      <div className={styles.card}>
        <div className={`${styles.notice} ${expirou ? styles.noticeWarn : styles.noticeError}`}>
          <strong>{expirou ? 'O código expirou' : 'Algo deu errado'}</strong>
          <p>
            {expirou
              ? `Cada código Pix vale ${PIX_EXPIRATION_MINUTES} minutos. Gere um novo para continuar — nada foi cobrado.`
              : (erro ?? 'Não foi possível gerar o código de pagamento.')}
          </p>
        </div>

        <button type="button" className={styles.primaryButton} onClick={gerarNovoCodigo}>
          Gerar novo código
        </button>
      </div>
    )
  }

  /* ================================================================ *
   * Estados: carregando e aguardando
   * ================================================================ */

  return (
    <div className={styles.card}>
      {/* Resumo do plano */}
      <div className={styles.planBox}>
        <div>
          <span className={styles.planLabel}>{subtitulo}</span>
          <strong className={styles.planName}>{titulo}</strong>
        </div>
        <div className={styles.planPrice}>
          <strong>{formatMoney(amount)}</strong>
          <span>a pagar</span>
        </div>
      </div>

      {/* QR Code */}
      <div className={styles.qrBox}>
        {estado === 'carregando' || !qrDataUrl ? (
          <div className={styles.qrLoading}>
            <Spinner size={26} />
            <span>Gerando código...</span>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="QR Code para pagamento via Pix"
              className={styles.qrImage}
              width={230}
              height={230}
            />
            <p className={styles.qrHint}>Abra o app do seu banco, escolha Pix e aponte a câmera.</p>
          </>
        )}
      </div>

      {/* Contador */}
      {estado === 'aguardando' ? (
        <p className={`${styles.timer} ${expirandoLogo ? styles.timerUrgent : ''}`}>
          Este código expira em{' '}
          <strong>
            {minutos}:{segundos}
          </strong>
        </p>
      ) : null}

      {/* Copia e cola */}
      {charge ? (
        <div className={styles.copyBlock}>
          <span className={styles.copyLabel}>Ou use o Pix copia e cola</span>
          <div className={styles.copyRow}>
            <code className={styles.copyCode}>{charge.payload}</code>
            <button type="button" className={styles.copyButton} onClick={copiar}>
              {copiado ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Aguardando confirmacao */}
      {estado === 'aguardando' ? (
        <div className={styles.waiting} aria-live="polite">
          <Spinner size={15} />
          Aguardando confirmacao do pagamento...
        </div>
      ) : null}

      {erro ? <p className={styles.inlineError}>{erro}</p> : null}

      {/* ----------------------------------------------------------------
          APOIO A DEMONSTRACAO — so fora de producao.
          Sem PSP real o polling nunca confirma, entao este botao permite
          ver o estado de sucesso. Em producao ele deixava marcar como paga
          uma venda Pix, ou a propria assinatura no cadastro, sem pagamento.
         ---------------------------------------------------------------- */}
      {estado === 'aguardando' && process.env.NODE_ENV !== 'production' ? (
        <button type="button" className={styles.demoButton} onClick={() => setEstado('confirmado')}>
          Simular pagamento confirmado (demonstração)
        </button>
      ) : null}
    </div>
  )
}
