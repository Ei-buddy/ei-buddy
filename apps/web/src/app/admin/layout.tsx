'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { BRAND } from '@/content/site'
import ThemeToggle from '@/components/app/ThemeToggle'
import { IconLogout, IconShield } from '@/components/Icons'
import { sair as encerrarSessao } from '@/lib/session-client'
import styles from './admin.module.css'

/**
 * Shell do painel do Super Admin — ADR-0007.
 *
 * Fora do `AppShell`: quem esta aqui ainda nao escolheu (nem tem) uma loja, e
 * a navegacao inteira do painel — vendas, clientes, financeiro — nao faz
 * sentido nesta tela. So o essencial: marca, tema, e a saida.
 *
 * `appTheme` no topo por igual motivo ao do `AppShell`: e a classe que liga
 * os tokens `--app-*` (NR-099) — sem ela esta tela ficaria sem cor nenhuma.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter()

  function sair() {
    /* Mesma logica do AppShell: nao espera a resposta, o cookie e httpOnly e
       quem apaga e o servidor. */
    void encerrarSessao()
    router.push('/login')
  }

  return (
    <div className={`appTheme ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <IconShield size={18} />
          {BRAND} · Super Admin
        </span>

        <nav className={styles.nav} aria-label="Painel do Super Admin">
          <Link href="/admin" className={styles.navLink}>
            Empresas
          </Link>
          <Link href="/admin/lista-vip" className={styles.navLink}>
            Lista de espera
          </Link>
          <Link href="/admin/parceiros" className={styles.navLink}>
            Parceiros
          </Link>
        </nav>

        <div className={styles.topActions}>
          <ThemeToggle />
          <button type="button" className={styles.iconButton} onClick={sair} aria-label="Sair">
            <IconLogout size={18} />
          </button>
        </div>
      </header>

      <main className={styles.content}>{children}</main>
    </div>
  )
}
