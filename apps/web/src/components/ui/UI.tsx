import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react'
import Image from 'next/image'
import styles from './UI.module.css'

/* ------------------------------------------------------------------ *
 * Cabecalho de pagina
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Superficies
 * ------------------------------------------------------------------ */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${styles.card} ${className}`}>
      {title || action ? (
        <header className={styles.cardHeader}>
          {title ? <h2 className={styles.cardTitle}>{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Indicadores
 * ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {hint ? <span className={`${styles.statHint} ${styles[`hint_${tone}`]}`}>{hint}</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Badge de status
 * ------------------------------------------------------------------ */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>
}

/* ------------------------------------------------------------------ *
 * Formulario
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  htmlFor,
  obrigatorio = false,
  span = 6,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  /**
   * Marca o campo como obrigatorio NA TELA — NR-148: asterisco no rotulo,
   * "(obrigatório)" para leitor de tela e `aria-required` no campo ligado.
   * Nao valida nada: quem recusa o envio continua sendo o formulario. Por
   * isso `aria-required`, e nao `required` — o atributo do HTML acionaria a
   * validacao nativa do navegador e mudaria o comportamento do envio.
   */
  obrigatorio?: boolean
  /** Colunas ocupadas dentro de FormGrid (de 1 a 12). */
  span?: number
  children: ReactNode
}) {
  /* Sem `htmlFor`, o rotulo se liga sozinho ao primeiro campo que e filho
     direto: assim leitor de tela e clique no rotulo chegam ao campo sem cada
     formulario lembrar de inventar um id. Campo dentro de outro elemento (com
     botao ao lado, por exemplo) ainda precisa de `htmlFor` explicito. */
  const gerado = useId()
  const lista = Children.toArray(children)
  const campo = lista.find(ehCampo)
  const alvo = htmlFor ?? (campo ? (campo.props.id ?? gerado) : undefined)
  const extras = {
    ...(htmlFor === undefined && campo && campo.props.id === undefined ? { id: gerado } : {}),
    ...(obrigatorio ? { 'aria-required': true } : {}),
  }
  const filhos =
    campo && Object.keys(extras).length > 0
      ? lista.map((f) => (f === campo ? cloneElement(campo, extras) : f))
      : children

  return (
    <div className={styles.field} data-span={span}>
      {/*
        O texto de ajuda fica AO LADO do rotulo, e nao abaixo do campo.

        Abaixo, ele criava duas desordens de uma vez. A visivel: cada campo com
        ajuda ficava mais alto que os vizinhos, e a tela perdia o alinhamento.
        A invisivel: `.field` e um grid, e quando a linha estica por causa de
        um vizinho mais alto, as linhas automaticas crescem junto — ou seja, o
        INPUT dos outros campos ficava mais alto. Era esse o sintoma relatado
        em "a altura do DDD e do Celular esta fora do padrao".
      */}
      <span className={styles.labelRow}>
        <label className={styles.label} htmlFor={alvo}>
          {label}
          {obrigatorio ? <MarcaObrigatorio /> : null}
        </label>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
      {filhos}
    </div>
  )
}

/** O asterisco de campo obrigatorio — para rotulo montado fora do `Field`. */
export function MarcaObrigatorio() {
  return (
    <>
      <span className={styles.obrigatorio} aria-hidden="true">
        {' '}
        *
      </span>
      <span className={styles.somenteLeitor}> (obrigatório)</span>
    </>
  )
}

/** A legenda do asterisco, no topo do formulario que usa `obrigatorio`. */
export function LegendaObrigatorio() {
  return (
    <p className={styles.legendaObrigatorio}>
      <span className={styles.obrigatorio} aria-hidden="true">
        *
      </span>{' '}
      Campo obrigatório
    </p>
  )
}

function ehCampo(filho: ReactNode): filho is React.ReactElement<{ id?: string }> {
  return (
    isValidElement(filho) &&
    (filho.type === Input || filho.type === Select || filho.type === Textarea)
  )
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.formGrid}>{children}</div>
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${styles.control} ${className}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select {...rest} className={`${styles.control} ${styles.select} ${className}`}>
      {children}
    </select>
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`${styles.control} ${styles.textarea} ${className}`} />
}

export function Checkbox({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ *
 * Barra de acoes acima das listagens
 * ------------------------------------------------------------------ */

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>
}

/* ------------------------------------------------------------------ *
 * Estado vazio
 * ------------------------------------------------------------------ */

export function EmptyState({
  title,
  description,
  action,
  mascote = false,
}: {
  title: string
  description?: string
  action?: ReactNode
  /**
   * Mostra o Buddy — SO para "nao ha nada aqui ainda" (ex.: nenhum cliente
   * cadastrado). Fica de fora por padrao porque este mesmo componente tambem
   * serve de "carregando..." (ver `Skeleton.tsx` para o substituto disso) e
   * de erro — um mascote sorrindo nesses dois casos destoaria do tom.
   */
  mascote?: boolean
}) {
  return (
    <div className={styles.empty}>
      {mascote ? (
        <Image src="/buddy.png" alt="" width={72} height={72} className={styles.emptyMascote} />
      ) : null}
      <strong className={styles.emptyTitle}>{title}</strong>
      {description ? <p className={styles.emptyText}>{description}</p> : null}
      {action}
    </div>
  )
}
