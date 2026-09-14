import Link from 'next/link'
import { BRAND, footerColumns } from '@/content/site'
import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.about}>
          <span className={styles.brand}>
            <span className={styles.brandName}>{BRAND}</span>
          </span>
          <p className={styles.aboutText}>
            Módulos integrados de vendas, financeiro, estoque e fiscal para quem toca o comércio no
            dia a dia — com um assistente que responde em linguagem natural.
          </p>
        </div>

        <div className={styles.columns}>
          {footerColumns.map((col) => (
            <nav key={col.title} className={styles.column} aria-label={col.title}>
              <h3 className={styles.columnTitle}>{col.title}</h3>
              <ul className={styles.columnList}>
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={styles.columnLink}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className={`container ${styles.bottom}`}>
        <p>
          © {new Date().getFullYear()} {BRAND}. Todos os direitos reservados.
        </p>
        <div className={styles.legal}>
          <a href="/termos-de-uso" target="_blank" rel="noreferrer noopener">
            Termos de uso
          </a>
          <a href="/politica-de-privacidade" target="_blank" rel="noreferrer noopener">
            Privacidade
          </a>
          <a href="/politica-de-cookies" target="_blank" rel="noreferrer noopener">
            Cookies
          </a>
        </div>
      </div>
    </footer>
  )
}
