import Link from 'next/link'
import { highlights, PRE_LANCAMENTO } from '@/content/site'
import { IconArrowRight, IconBolt, IconTrendUp } from './Icons'
import LiquidMetalPanel from './LiquidMetalPanel'
import styles from './Hero.module.css'

/** Alturas do grafico do mockup, em % — apenas ilustrativas. */
const chartBars = [38, 52, 44, 68, 57, 82, 71]

const recentSales = [
  { label: 'Venda #1842', meta: 'Pix · 3 itens', value: 'R$ 268,90' },
  { label: 'Venda #1841', meta: 'Crédito · 1 item', value: 'R$ 89,00' },
  { label: 'Venda #1840', meta: 'Dinheiro · 6 itens', value: 'R$ 412,50' },
]

export default function Hero() {
  /* Em pre-lancamento, o `PreLancamentoBanner` vem antes e ja e o primeiro
     bloco depois do header fixo — o `id="top"` e o padding que compensa o
     header vao para ele; aqui bastaria a folga normal entre secoes. */
  return (
    <section
      className={`${styles.hero} ${PRE_LANCAMENTO ? styles.naoEhOPrimeiro : ''}`}
      id={PRE_LANCAMENTO ? undefined : 'top'}
    >
      <div className={`container ${styles.grid}`}>
        <div className={styles.copy}>
          <span className={styles.badge}>
            <IconBolt size={15} />
            Gestão para pequenos e médios negócios
          </span>

          <h1 className={styles.title}>
            Seu negócio inteiro,
            <br />a um <span className="gradientText">WhatsApp</span> de distância
          </h1>

          <p className={styles.lead}>
            Empresa, clientes, produtos, financeiro, vendas e CRM num sistema só. É o que você
            precisa saber — faturamento, quem deve, o que repor — você pergunta por mensagem e
            recebe a resposta pronta.
          </p>

          <div className={styles.ctas}>
            <Link href={PRE_LANCAMENTO ? '/lista-vip' : '/criar-conta'} className="btn btnPrimary">
              {PRE_LANCAMENTO ? 'Entrar para o Grupo VIP' : 'Começar agora'}
              <IconArrowRight size={18} />
            </Link>
            <a href="#painel" className="btn btnGhost">
              Ver o painel
            </a>
          </div>

          {PRE_LANCAMENTO ? null : (
            <p className={styles.note}>Plano único, sem fidelidade. Cancele quando quiser.</p>
          )}
        </div>

        {/* Mockup ilustrativo do produto, sobre o painel de liquid metal */}
        <div className={styles.mockupWrap}>
          {/* Substitui o brilho estatico que havia aqui: mesma funcao —
              dar profundidade ao mockup — com o efeito animado da marca. */}
          <LiquidMetalPanel />

          <div className={styles.mockup} role="img" aria-label="Prévia do painel do produto">
            <div className={styles.mockupBar}>
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.mockupTitle}>Visão geral</span>
            </div>

            <div className={styles.mockupBody}>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Faturamento hoje</span>
                  <strong className={styles.statValue}>R$ 8.420</strong>
                  <span className={styles.statUp}>
                    <IconTrendUp size={13} /> 12%
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>A receber</span>
                  <strong className={styles.statValue}>R$ 23.180</strong>
                  <span className={styles.statMeta}>18 títulos</span>
                </div>
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartHead}>
                  <span className={styles.chartTitle}>Vendas na semana</span>
                  <span className={styles.chartTag}>+18%</span>
                </div>
                <div className={styles.chart}>
                  {chartBars.map((h, i) => (
                    <span key={i} className={styles.bar} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>

              <ul className={styles.list}>
                {recentSales.map((row) => (
                  <li key={row.label} className={styles.listRow}>
                    <span className={styles.rowDot} />
                    <span className={styles.rowText}>
                      <strong>{row.label}</strong>
                      <span>{row.meta}</span>
                    </span>
                    <span className={styles.rowValue}>{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de confianca em movimento continuo */}
      {/* Capacidades do produto, nao metricas: cada item e uma tela que existe. */}
      <div className={styles.marquee} aria-label="O que o sistema faz">
        <div className={styles.marqueeTrack}>
          {[0, 1].map((copy) => (
            <ul key={copy} className={styles.marqueeGroup} aria-hidden={copy === 1}>
              {highlights.map((item) => (
                <li key={item} className={styles.marqueeItem}>
                  {item}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  )
}
