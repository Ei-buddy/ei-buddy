import Link from 'next/link'
import { BRAND } from '@/content/site'
import { IconArrowRight, IconBag, IconBox, IconTrendUp, IconWallet } from './Icons'
import ConstellationBackground from './fundos/ConstellationBackground'
import styles from './DashboardPreview.module.css'

const salesBars = [42, 58, 47, 71, 63, 88, 76]

export default function DashboardPreview() {
  return (
    <section className={styles.section} id="painel">
      {/* Fundo interativo, atras de tudo — NR-130. */}
      <ConstellationBackground tema="escuro" />

      <div className={`container ${styles.conteudo}`}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Painel</span>
          <h2 className={styles.title}>
            Depois do login, tudo em <span className={styles.titleAccent}>mesas</span> temáticas
          </h2>
          <p className={styles.lead}>
            Cada módulo vira uma mesa com o resumo do que importa naquele assunto. Você abre o
            painel e já sabe onde está o problema do dia.
          </p>
        </header>

        <div className={styles.frame}>
          <aside className={styles.sidebar} aria-hidden="true">
            <span className={styles.sidebarBrand}>
              <span className={styles.sidebarMark} />
              {BRAND}
            </span>
            <span className={`${styles.sidebarItem} ${styles.sidebarActive}`}>Visão geral</span>
            <span className={styles.sidebarItem}>Vendas</span>
            <span className={styles.sidebarItem}>Financeiro</span>
            <span className={styles.sidebarItem}>Estoque</span>
            <span className={styles.sidebarItem}>Fiscal</span>
          </aside>

          <div className={styles.board}>
            {/* Mesa 1 — Vendas */}
            <article className={styles.mesa}>
              <header className={styles.mesaHead}>
                <span className={styles.mesaIcon}>
                  <IconBag size={17} />
                </span>
                <h3 className={styles.mesaTitle}>Mesa de Vendas</h3>
                <span className={styles.mesaChip}>
                  <IconTrendUp size={12} /> 18%
                </span>
              </header>
              <strong className={styles.mesaValue}>R$ 8.420</strong>
              <span className={styles.mesaLabel}>faturado hoje · 34 vendas</span>
              <div className={styles.bars}>
                {salesBars.map((h, i) => (
                  <span key={i} className={styles.bar} style={{ height: `${h}%` }} />
                ))}
              </div>
            </article>

            {/* Mesa 2 — Financeiro */}
            <article className={styles.mesa}>
              <header className={styles.mesaHead}>
                <span className={styles.mesaIcon}>
                  <IconWallet size={17} />
                </span>
                <h3 className={styles.mesaTitle}>Mesa Financeira</h3>
              </header>
              <strong className={styles.mesaValue}>R$ 23.180</strong>
              <span className={styles.mesaLabel}>a receber nos próximos 30 dias</span>
              <ul className={styles.rows}>
                <li className={styles.row}>
                  <span>A pagar hoje</span>
                  <strong>R$ 1.240</strong>
                </li>
                <li className={styles.row}>
                  <span>Vencidos</span>
                  <strong className={styles.alert}>R$ 680</strong>
                </li>
                <li className={styles.row}>
                  <span>Saldo conciliado</span>
                  <strong>R$ 11.905</strong>
                </li>
              </ul>
            </article>

            {/* Mesa 3 — Estoque */}
            <article className={styles.mesa}>
              <header className={styles.mesaHead}>
                <span className={styles.mesaIcon}>
                  <IconBox size={17} />
                </span>
                <h3 className={styles.mesaTitle}>Mesa de Estoque</h3>
                <span className={`${styles.mesaChip} ${styles.mesaChipWarn}`}>3 alertas</span>
              </header>
              <strong className={styles.mesaValue}>412 itens</strong>
              <span className={styles.mesaLabel}>no catálogo ativo</span>
              <ul className={styles.rows}>
                <li className={styles.row}>
                  <span>Café torrado 500g</span>
                  <strong className={styles.alert}>4 un</strong>
                </li>
                <li className={styles.row}>
                  <span>Leite integral 1L</span>
                  <strong className={styles.alert}>6 un</strong>
                </li>
                <li className={styles.row}>
                  <span>Açúcar mascavo 1kg</span>
                  <strong className={styles.alert}>2 un</strong>
                </li>
              </ul>
            </article>
          </div>
        </div>

        <div className={styles.cta}>
          <Link href="/app" className={styles.ctaLink}>
            Ver o painel completo
            <IconArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  )
}
