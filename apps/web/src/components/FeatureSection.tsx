import type { ReactNode } from 'react'
import { IconCheck } from './Icons'
import styles from './FeatureSection.module.css'

type FeatureSectionProps = {
  id?: string
  eyebrow: string
  title: ReactNode
  text: string
  bullets: string[]
  /** Mini-previa de UI que ilustra o pilar. */
  visual: ReactNode
  /** Inverte o lado da imagem — usado para alternar entre as secoes. */
  reverse?: boolean
  /** Fundo levemente acinzentado, para separar blocos vizinhos. */
  muted?: boolean
  /** Camada decorativa atras do conteudo, como os fundos interativos — NR-130. */
  fundo?: ReactNode
}

export default function FeatureSection({
  id,
  eyebrow,
  title,
  text,
  bullets,
  visual,
  reverse = false,
  muted = false,
  fundo,
}: FeatureSectionProps) {
  return (
    <section
      className={`section ${styles.section} ${muted ? styles.muted : ''} ${fundo ? styles.comFundo : ''}`}
      id={id}
    >
      {fundo}
      <div className={`container ${styles.grid} ${reverse ? styles.reverse : ''}`}>
        <div className={styles.copy}>
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="sectionTitle">{title}</h2>
          <p className="sectionLead">{text}</p>

          <ul className={styles.bullets}>
            {bullets.map((item) => (
              <li key={item} className={styles.bullet}>
                <span className={styles.check}>
                  <IconCheck size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.visual}>{visual}</div>
      </div>
    </section>
  )
}
