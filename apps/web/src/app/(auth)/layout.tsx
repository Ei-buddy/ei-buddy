import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { BRAND } from '@/content/site'
import CartaoDeVidro from '@/components/auth/CartaoDeVidro'
import styles from './auth.module.css'

/**
 * As telas de entrada — login, cadastro e recuperacao de senha — NR-129.
 *
 * Eram dois paineis: a marca em azul a esquerda, o formulario a direita. Agora
 * sao um fundo claro com halos azul e verde-agua e um cartao de vidro no
 * centro, com o Buddy no topo.
 *
 * So a moldura mudou. Cada formulario continua validando, enviando e
 * redirecionando do mesmo jeito; o cartao so os envolve.
 *
 * ## O que saiu, e por que
 *
 * Os tres destaques do painel de marca ("Tudo em um so fluxo", "Assistente em
 * texto", "Seguranca nivel bancario") nao couberam: um cartao centralizado
 * com argumentos em volta vira landing page, e quem chega aqui ja decidiu
 * entrar. A frase de rodape ficou, abaixo do cartao.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {/*
        Os halos sao o fundo inteiro: um por cor da marca, desfocados e FIXOS.

        Havia aqui uma camada de linhas correndo (`CaminhosDeFundo`, NR-129).
        Ela saiu a pedido: numa tela em que a pessoa digita CNPJ e senha,
        movimento continuo no fundo disputa atencao com o formulario. O que
        fica e estatico — e continua sendo a cor da marca, nao um cinza.
      */}
      <span className={`${styles.halo} ${styles.haloAzul}`} aria-hidden="true" />
      <span className={`${styles.halo} ${styles.haloTeal}`} aria-hidden="true" />

      <header className={styles.topo}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandName}>{BRAND}</span>
        </Link>
      </header>

      <main className={styles.centro}>
        <div className={styles.coluna}>
          {/* O Buddy no lugar da letra-placeholder do componente de
              referencia. Decorativo: o nome da marca ja esta no topo, e o
              leitor de tela nao precisa ouvir a mesma coisa duas vezes. */}
          <div className={styles.mascote}>
            <Image src="/buddy-azul.png" alt="" width={84} height={84} priority />
          </div>

          <CartaoDeVidro>{children}</CartaoDeVidro>

          <p className={styles.rodape}>
            Feito para MEIs e pequenos comércios — do balcão à contabilidade.
          </p>
        </div>
      </main>
    </div>
  )
}
