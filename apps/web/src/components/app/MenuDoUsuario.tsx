'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { assinarConexao, lerConexao, lerConexaoNoServidor } from '@/lib/conexao'
import { IconLogout, IconReceipt, IconStore } from '../Icons'
import PeriodoDoDia from './PeriodoDoDia'
import styles from './AppShell.module.css'

/**
 * Quem esta logado, e o que da para fazer a partir disso — NR-136.
 *
 * O avatar e o nome eram texto parado no canto. Agora sao um botao: clicar
 * abre um menu com os lugares que pertencem a PESSOA e a loja dela (dados da
 * empresa, assinatura, sair), em vez de espalha-los pela barra lateral, que e
 * dos modulos de trabalho.
 *
 * ## O ponto no avatar nao e enfeite
 *
 * Ele fica verde e pulsando enquanto o navegador esta online, e cinza e parado
 * quando a conexao cai — ver `lib/conexao.ts`. Um indicador que nunca muda de
 * estado nao informa nada; este avisa antes de a pessoa achar que o sistema
 * travou.
 *
 * ## O botao de sair continua na barra
 *
 * O item "Sair" daqui NAO substitui o botao que ja existia ao lado: quem ja
 * sabe onde clicava continua clicando no mesmo lugar. Tirar um caminho que
 * funciona para forcar o caminho novo e cobrar da pessoa o preco da mudanca.
 */
export default function MenuDoUsuario({
  nome,
  empresa,
  iniciais,
  aoSair,
}: {
  nome: string
  empresa: string
  iniciais: string
  aoSair: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const online = useSyncExternalStore(assinarConexao, lerConexao, lerConexaoNoServidor)

  useEffect(() => {
    if (!aberto) return

    function aoApontarFora(e: PointerEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }

    document.addEventListener('pointerdown', aoApontarFora)
    window.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('pointerdown', aoApontarFora)
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  return (
    <div className={styles.user} ref={caixa}>
      <button
        type="button"
        className={styles.userBotao}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
      >
        <span className={styles.avatarWrap}>
          <span className={styles.avatar}>{iniciais}</span>
          <span
            className={`${styles.pontoDeStatus} ${online ? '' : styles.pontoOffline}`}
            /* O estado dito em palavras, e nao so em cor — quem nao distingue
               verde de cinza precisa da mesma informacao (RNF-052). */
            title={online ? 'Conectado' : 'Sem conexão'}
            aria-hidden="true"
          />
        </span>

        <span className={styles.userText}>
          <strong>{nome}</strong>
          <span>{empresa}</span>
        </span>

        <PeriodoDoDia />
      </button>

      {aberto ? (
        <div className={styles.userMenu} role="menu" aria-label="Sua conta">
          <p className={styles.userMenuTopo}>
            <strong>{nome}</strong>
            <span>{empresa}</span>
          </p>

          <Link
            href="/app/empresa"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => setAberto(false)}
          >
            <IconStore size={17} />
            Dados da empresa
          </Link>

          <Link
            href="/app/assinatura"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => setAberto(false)}
          >
            <IconReceipt size={17} />
            Assinatura
          </Link>

          <button
            type="button"
            className={`${styles.userMenuItem} ${styles.userMenuSair}`}
            role="menuitem"
            onClick={() => {
              setAberto(false)
              aoSair()
            }}
          >
            <IconLogout size={17} />
            Sair
          </button>
        </div>
      ) : null}
    </div>
  )
}
