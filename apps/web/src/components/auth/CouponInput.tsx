'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { validateCoupon, type CouponResult } from '@/lib/auth-api'
import { IconCheck, IconClose } from '../Icons'
import { Spinner } from './Fields'
import formStyles from './auth-form.module.css'
import styles from './signup.module.css'

/** Resultado ja resolvido para um codigo especifico. */
type Resolvido = {
  code: string
  result: CouponResult
}

/**
 * Campo de cupom de parceiro com validacao em tempo real (debounce 600ms).
 *
 * SUBSTITUIR POR: GET /partners/coupons/:codigo — ver `lib/auth-api.ts`.
 * O campo e opcional: o fluxo segue normalmente se ficar em branco ou se o
 * cupom for invalido, apenas sem o beneficio.
 *
 * O texto de ajuda fala do beneficio de QUEM SE CADASTRA, e nao da comissao do
 * parceiro. Dizia "identificamos e comissionamos o parceiro", que e verdade e
 * e a informacao errada para o momento: quem esta preenchendo o cadastro
 * precisa saber o que ganha, nao como o outro lado e remunerado.
 */
export default function CouponInput({
  value,
  onChange,
  onValidChange,
}: {
  value: string
  onChange: (value: string) => void
  /** Informa ao passo pai se ha um cupom valido aplicado. */
  onValidChange: (code: string | null) => void
}) {
  const id = useId()

  /* So o resultado da chamada vive em estado. "Vazio" e "verificando" sao
     derivados do render, comparando o codigo digitado com o ja resolvido. */
  const [resolvido, setResolvido] = useState<Resolvido | null>(null)

  const code = value.trim()

  /* O callback fica em ref para nao entrar nas dependencias do efeito: se o
     pai passar uma funcao inline, a identidade mudaria a cada render. */
  const onValidChangeRef = useRef(onValidChange)
  useEffect(() => {
    onValidChangeRef.current = onValidChange
  }, [onValidChange])

  useEffect(() => {
    if (!code) {
      onValidChangeRef.current(null)
      return
    }

    let cancelado = false

    const timer = setTimeout(async () => {
      const result = await validateCoupon(code)
      if (cancelado) return

      setResolvido({ code, result })
      onValidChangeRef.current(result.status === 'valid' ? result.code : null)
    }, 600)

    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [code])

  /* Estado derivado — nenhum setState sincrono envolvido. */
  const estado: 'vazio' | 'verificando' | 'valido' | 'invalido' = !code
    ? 'vazio'
    : resolvido?.code !== code
      ? 'verificando'
      : resolvido.result.status === 'valid'
        ? 'valido'
        : 'invalido'

  const dadosValidos =
    estado === 'valido' && resolvido?.result.status === 'valid' ? resolvido.result : null

  const mensagemErro =
    estado === 'invalido' && resolvido?.result.status === 'invalid'
      ? resolvido.result.message
      : null

  return (
    <div className={formStyles.field}>
      <label className={formStyles.label} htmlFor={id}>
        Cupom de indicação <span className={styles.optional}>(opcional)</span>
      </label>

      <div className={styles.couponWrap}>
        <input
          id={id}
          className={`${formStyles.input} ${styles.couponInput} ${
            estado === 'invalido' ? formStyles.inputError : ''
          } ${estado === 'valido' ? styles.couponInputValid : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Ex.: PARCEIRO10"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={estado === 'invalido'}
          aria-describedby={`${id}-status`}
        />

        <span className={styles.couponStatus} aria-hidden="true">
          {estado === 'verificando' ? <Spinner size={15} /> : null}
          {estado === 'valido' ? (
            <span className={styles.couponOk}>
              <IconCheck size={14} />
            </span>
          ) : null}
          {estado === 'invalido' ? (
            <span className={styles.couponFail}>
              <IconClose size={14} />
            </span>
          ) : null}
        </span>
      </div>

      {/* Regiao viva: leitores de tela anunciam a mudanca de status */}
      <div id={`${id}-status`} aria-live="polite">
        {estado === 'verificando' ? (
          <span className={formStyles.hint}>Verificando cupom...</span>
        ) : null}

        {dadosValidos ? (
          <span className={styles.couponValidMsg}>
            Cupom de <strong>{dadosValidos.partner}</strong> aplicado — {dadosValidos.benefit}.
          </span>
        ) : null}

        {mensagemErro ? <span className={formStyles.error}>{mensagemErro}</span> : null}

        {estado === 'vazio' ? (
          <span className={formStyles.hint}>
            Se alguém indicou o sistema para você, informe o cupom — é assim que identificaremos o
            benefício que você receberá. Caso contrário, prossiga sem preencher.
          </span>
        ) : null}
      </div>
    </div>
  )
}
