import type { ReactNode } from 'react'
import Link from 'next/link'
import { BRAND } from '@/content/site'
import { IconBolt, IconShield, IconSparkles } from '@/components/Icons'
import styles from './auth.module.css'

const destaques = [
  {
    icon: IconBolt,
    title: 'Tudo em um só fluxo',
    text: 'Vendas, financeiro, estoque e fiscal conversando entre si.',
  },
  {
    icon: IconSparkles,
    title: 'Assistente em texto',
    text: 'Pergunte o que precisa e receba o número pronto.',
  },
  {
    icon: IconShield,
    title: 'Segurança nível bancário',
    text: 'Dados isolados por empresa e backup diário.',
  },
]

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {/* Painel de marca — gradiente da identidade */}
      <aside className={styles.brandPanel}>
        <div className={styles.brandInner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandName}>{BRAND}</span>
          </Link>

          <div className={styles.pitch}>
            <h2 className={styles.pitchTitle}>A gestão do seu comércio, do balcão ao relatório.</h2>

            <ul className={styles.highlights}>
              {destaques.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.title} className={styles.highlight}>
                    <span className={styles.highlightIcon}>
                      <Icon size={18} />
                    </span>
                    <span className={styles.highlightText}>
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/*
            Era "Mais de 12 mil negocios ja usam" — numero inventado, e falso:
            com PRE_LANCAMENTO ligado ninguem usa o produto ainda. A landing ja
            tinha tirado essa metrica pelo mesmo motivo (ver o comentario de
            `highlights` em content/site.ts), e esta tela ficou para tras.

            Volta a ser metrica quando houver numero apurado, nao estimado.
          */}
          <p className={styles.footNote}>
            Feito para MEIs e pequenos comércios — do balcão à contabilidade.
          </p>
        </div>
      </aside>

      {/* Painel do formulario — fundo claro */}
      <main className={styles.formPanel}>
        <div className={styles.formInner}>{children}</div>
      </main>
    </div>
  )
}
