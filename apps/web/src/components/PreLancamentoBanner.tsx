import Link from 'next/link'
import BuddyDoPreLancamento from './BuddyDoPreLancamento'
import { IconArrowRight, IconSparkles } from './Icons'
import styles from './PreLancamentoBanner.module.css'

/**
 * Topo da landing em modo pre-lancamento — ver `PRE_LANCAMENTO` em
 * `content/site.ts`.
 *
 * Ocupa o lugar que o `Hero` tinha (primeiro bloco depois do header fixo, por
 * isso herda o `id="top"` e o padding que compensa o header) porque a
 * primeira coisa que a pagina pede agora nao e "comece a usar" — e "ajude a
 * gente a construir".
 */
export default function PreLancamentoBanner() {
  return (
    <section className={styles.banner} id="top">
      <div className={`container ${styles.inner}`}>
        <span className={styles.badge}>
          <IconSparkles size={15} />
          Pré-lançamento
        </span>

        <h1 className={styles.title}>
          Estamos construindo o EiBuddy — <span className="gradientText">com você</span>
        </h1>

        <p className={styles.lead}>
          Antes de abrir para todo mundo, queremos ouvir quem vai usar de verdade. Entre para o
          Grupo VIP de Pré-Lançamento, conte o que espera do Buddy e acompanhe a construção em
          primeira mão.
        </p>

        <Link href="/lista-vip" className="btn btnPrimary">
          Entrar para o Grupo VIP
          <IconArrowRight size={18} />
        </Link>
      </div>

      {/* Ele chega depois do texto e sai quando a secao sai — NR-135. */}
      <BuddyDoPreLancamento />
    </section>
  )
}
