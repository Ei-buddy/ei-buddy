'use client'

import { useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconClose } from '@/components/Icons'
import styles from './dialog.module.css'
import { useDialogo } from '@/components/app/useDialogo'

/**
 * Confirmacao para acoes que mexem em dinheiro.
 *
 * Baixa e estorno alteram saldo e conciliacao — errar o clique aqui custa
 * caro, entao passam por confirmacao explicita, com o valor a vista.
 */
export default function ConfirmarDialog({
  titulo,
  descricao,
  detalhe,
  rotuloConfirmar = 'Confirmar',
  tom = 'normal',
  processando = false,
  onConfirmar,
  onCancelar,
}: {
  titulo: string
  descricao: string
  /** Linha destacada com o valor ou o item afetado. */
  detalhe?: ReactNode
  rotuloConfirmar?: string
  tom?: 'normal' | 'perigo'
  processando?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useDialogo(ref, onCancelar, processando)

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={() => !processando && onCancelar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={styles.painel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        tabIndex={-1}
      >
        <header className={styles.cabecalho}>
          <h2 id="confirmar-titulo" className={styles.titulo}>
            {titulo}
          </h2>
          <button
            type="button"
            className={styles.fechar}
            onClick={onCancelar}
            disabled={processando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <p className={styles.descricao}>{descricao}</p>

        {detalhe ? <div className={styles.detalhe}>{detalhe}</div> : null}

        <div className={styles.acoes}>
          <Button variant="secondary" onClick={onCancelar} disabled={processando}>
            Cancelar
          </Button>
          <Button
            variant={tom === 'perigo' ? 'danger' : 'primary'}
            onClick={onConfirmar}
            disabled={processando}
          >
            {processando ? (
              <>
                <Spinner size={15} />
                Processando...
              </>
            ) : (
              rotuloConfirmar
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
