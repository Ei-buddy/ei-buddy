'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, FormGrid, Textarea } from '@/components/ui/UI'
import { Spinner } from '@/components/auth/Fields'
import { IconClose } from '@/components/Icons'
import { entrarNaEmpresa, type EmpresaListada } from '@/lib/admin-api'
import styles from './admin.module.css'
import { useDialogo } from '@/components/app/useDialogo'

/** A api recusa justificativa menor que isto — RF-131. */
const JUSTIFICATIVA_MINIMA = 10

/**
 * Justificativa obrigatoria antes de "entrar como" uma loja — ADR-0007, RF-131.
 *
 * A pergunta nao e "posso entrar?" — quem chegou aqui ja e Super Admin, a api
 * ja confere isso. E "por que, desta vez?" — o texto vai para
 * `platform_admin_access`, a trilha que qualquer auditoria olha primeiro
 * quando alguem pergunta por que um Super Admin viu os dados de uma loja.
 */
export default function EntrarDialog({
  empresa,
  onEntrou,
  onCancelar,
}: {
  empresa: EmpresaListada
  onEntrou: () => void
  onCancelar: () => void
}) {
  const [justificativa, setJustificativa] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useDialogo(ref, onCancelar, entrando)

  const valida = justificativa.trim().length >= JUSTIFICATIVA_MINIMA

  async function confirmar() {
    if (!valida) return

    setEntrando(true)
    setErro(null)

    const r = await entrarNaEmpresa(empresa.id, justificativa.trim())
    if (!r.ok) {
      setErro(r.erro)
      setEntrando(false)
      return
    }

    onEntrou()
  }

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !entrando && onCancelar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entrar-titulo"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="entrar-titulo" className={styles.dialogTitulo}>
            Entrar como Super Admin
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancelar}
            disabled={entrando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </Button>
        </header>

        <p className={styles.dialogAlvo}>
          Você vai ver o painel como <strong>{empresa.tradeName ?? empresa.legalName}</strong>. Isso
          fica registrado, com o motivo abaixo.
        </p>

        <FormGrid>
          <Field
            label="Motivo do acesso"
            span={12}
            hint={`Mínimo de ${JUSTIFICATIVA_MINIMA} caracteres.`}
          >
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: verificar chamado de suporte #482"
              maxLength={500}
              disabled={entrando}
              autoFocus
            />
          </Field>
        </FormGrid>

        {erro !== null ? (
          <p role="alert" className={styles.dialogErro}>
            {erro}
          </p>
        ) : null}

        <div className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onCancelar} disabled={entrando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!valida || entrando}>
            {entrando ? (
              <>
                <Spinner size={15} />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
