import type { ReactNode } from 'react'
import Link from 'next/link'
import Footer from '@/components/Footer'
import Header from '@/components/Header'
import styles from './legal.module.css'

/**
 * A moldura dos documentos juridicos — NR-085.
 *
 * Header e Footer iguais aos da landing de proposito: quem chega aqui por um
 * link do rodape ou da tela de cadastro precisa continuar dentro do site, com
 * caminho de volta. Pagina juridica solta, sem navegacao, e a que faz a pessoa
 * usar o botao de voltar do navegador e perder o formulario que estava
 * preenchendo.
 */
export default function PaginaLegal({
  eyebrow,
  titulo,
  atualizadoEm,
  voltarPara,
  children,
}: {
  eyebrow: string
  titulo: string
  /** `AAAA-MM-DD`. Documento juridico sem data nao da para versionar. */
  atualizadoEm: string
  /** Quando presente, mostra uma seta de voltar acima do titulo. */
  voltarPara?: string
  children: ReactNode
}) {
  const [ano, mes, dia] = atualizadoEm.split('-')

  return (
    <>
      <Header />

      <main className={styles.pagina}>
        <div className="container">
          <article className={styles.corpo}>
            {voltarPara ? (
              <Link href={voltarPara} className={styles.voltar}>
                ← Voltar
              </Link>
            ) : null}
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.titulo}>{titulo}</h1>
            <p className={styles.atualizacao}>
              Atualizado em {dia}/{mes}/{ano}
            </p>
            {children}
          </article>
        </div>
      </main>

      <Footer />
    </>
  )
}

/**
 * Marca, no ponto exato, o que ainda depende de decisao.
 *
 * ## Por que isto existe em vez de eu escrever a clausula
 *
 * Porque parte do que um documento destes precisa nao esta no codigo e nao da
 * para inferir: razao social e CNPJ do controlador, contato do encarregado
 * (LGPD art. 41), prazo de retencao alem do minimo fiscal, foro. Escrever isso
 * por conta propria produziria um documento com cara de oficial e conteudo
 * inventado — que e pior que a pagina faltando, porque ninguem desconfia.
 *
 * O bloco aparece onde a lacuna esta, e nao num aviso geral no topo: quem abre
 * a pagina para conferir uma clausula tem de ver a pendencia DAQUELA clausula.
 * Aviso no topo se aprende a ignorar na segunda visita.
 */
export function Pendente({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pendente} role="note">
      <p>
        <strong>Pendente de revisao juridica.</strong> {children}
      </p>
    </div>
  )
}

export { styles as estilosLegais }
