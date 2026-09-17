import Image from 'next/image'
import Link from 'next/link'
import { PRE_LANCAMENTO } from '@/content/site'
import { IconArrowRight } from './Icons'
import GridBloomBackground from './fundos/GridBloomBackground'
import styles from './CtaBuddy.module.css'

/**
 * Fechamento da landing.
 *
 * A pagina terminava no FAQ, que responde duvidas mas nao convida a nada.
 * Esta faixa retoma a acao no fim da leitura, quando a pessoa ja viu o
 * produto inteiro — e e onde o mascote cabe sem disputar atencao com o
 * mockup do hero.
 */
export default function CtaBuddy() {
  return (
    <section className={`section ${styles.section}`}>
      <div className="container">
        <div className={styles.card}>
          {/* Fundo interativo, atras do texto e do Buddy — NR-130. Dentro do
              cartao, e nao da secao: o cartao tem fundo proprio e cobriria. */}
          <GridBloomBackground tema="claro" />

          <div className={styles.copy}>
            <span className={styles.badge}>
              {PRE_LANCAMENTO ? 'Ajude a construir' : 'Comece hoje'}
            </span>

            <h2 className={styles.title}>
              Deixe o <span className="gradientText">Buddy</span> cuidar da papelada
            </h2>

            <p className={styles.lead}>
              {PRE_LANCAMENTO
                ? 'O EiBuddy ainda está em construção. Entre para o Grupo VIP de Pré-Lançamento e ajude a moldar o produto antes de todo mundo.'
                : 'Crie sua conta em dois minutos e use todos os módulos desde o primeiro dia. Sem instalação, sem contrato de fidelidade e sem cobrança por usuário.'}
            </p>

            <div className={styles.ctas}>
              <Link
                href={PRE_LANCAMENTO ? '/lista-vip' : '/criar-conta'}
                className="btn btnPrimary"
              >
                {PRE_LANCAMENTO ? 'Entrar para o Grupo VIP' : 'Começar agora'}
                <IconArrowRight size={18} />
              </Link>
              {PRE_LANCAMENTO ? null : (
                <a href="#planos" className="btn btnGhost">
                  Ver o plano
                </a>
              )}
            </div>
          </div>

          <div className={styles.mascote}>
            <div className={styles.glow} aria-hidden="true" />
            <Image
              src="/buddy.png"
              alt="Buddy, o mascote do EiBuddy, com o polegar levantado"
              fill
              className={styles.imagem}
              sizes="(min-width: 940px) 380px, 260px"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
