import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import Header from '@/components/Header'
import ListaVipForm from './ListaVipForm'
import styles from './lista-vip.module.css'

export const metadata: Metadata = {
  title: 'Grupo VIP de Pré-Lançamento',
  description: 'Ajude a moldar o EiBuddy antes do lançamento e entre para o Grupo VIP.',
}

/**
 * Pesquisa do pre-lancamento — NR-111.
 *
 * Footer igual ao da landing, como em `PaginaLegal.tsx`: quem chegou por um
 * link precisa de caminho de volta. O Header usa `comVoltar`: os links de
 * `nav` apontam para secoes da landing (`#modulos` etc.) que nao existem
 * aqui, entao viram so um link de volta para `/`.
 */
export default function ListaVipPage() {
  return (
    <>
      <Header comVoltar />

      <main className={styles.pagina}>
        <div className={`container ${styles.corpo}`}>
          <ListaVipForm />
        </div>
      </main>

      <Footer />
    </>
  )
}
