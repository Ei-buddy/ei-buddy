import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

type CommonProps = {
  children: ReactNode
  variant?: Variant
  size?: Size
  /** Ocupa toda a largura disponivel. */
  block?: boolean
  className?: string
}

function classesFor({ variant = 'primary', size = 'md', block, className = '' }: CommonProps) {
  return [styles.base, styles[variant], styles[size], block ? styles.block : '', className]
    .filter(Boolean)
    .join(' ')
}

/**
 * `type="button"` por padrao — achado do QA. O `<button>` do HTML nasce
 * `submit`: dentro de um formulario, o Enter num campo "clica" o PRIMEIRO
 * botao de envio — e o primeiro era o Cancelar. O Enter fechava o cadastro de
 * custo fixo sem salvar, e o mesmo acontecia em oito formularios (agenda, PDV,
 * CRM, conta bancaria, titulo, correcao, suporte). Quem envia diz
 * `type="submit"`, como todos os botoes de salvar ja diziam.
 */
export function Button({
  children,
  variant,
  size,
  block,
  className,
  type = 'button',
  ...rest
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      className={classesFor({ children, variant, size, block, className })}
    >
      {children}
    </button>
  )
}

export function ButtonLink({
  children,
  href,
  variant,
  size,
  block,
  className,
  ...rest
}: CommonProps & { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link
      href={href}
      className={classesFor({ children, variant, size, block, className })}
      {...rest}
    >
      {children}
    </Link>
  )
}
