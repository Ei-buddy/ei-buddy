'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Card, PageHeader } from '@/components/ui/UI'
import { carregarPerfil } from '@/lib/perfil-api'
import styles from './plataforma.module.css'

/**
 * A porta da secao Plataforma — NR-122, ADR-0007.
 *
 * ## Por que aqui, e nao em cada tela
 *
 * As telas desta secao sao quatro, e vao crescer. Sem uma porta unica, cada
 * uma repetiria a checagem — e a proxima nasceria sem, porque ninguem lembra
 * de copiar uma guarda que nao aparece na tela quando funciona.
 *
 * ## O que ela e, e o que ela NAO e
 *
 * Isto e apresentacao: a barra lateral ja nao oferece estes itens a quem nao
 * pode, e esta guarda cobre quem digita o endereco. Quem barra de verdade e a
 * api, que confere `platform_admin_is` em toda chamada — nenhuma das telas
 * abaixo conseguiria dado nenhum mesmo se este arquivo sumisse.
 */
export default function PlataformaLayout({ children }: { children: ReactNode }) {
  const [acesso, setAcesso] = useState<'perguntando' | 'liberado' | 'negado'>('perguntando')

  useEffect(() => {
    void (async () => {
      const r = await carregarPerfil()
      /* Perfil que nao carrega nao e recusa: a sessao pode ter expirado, e
         quem trata isso e a propria chamada da tela, com a mensagem certa. */
      setAcesso(r.ok && !r.dados.isPlatformAdmin ? 'negado' : 'liberado')
    })()
  }, [])

  if (acesso === 'perguntando') {
    return <PageHeader title="Plataforma" subtitle="Conferindo seu acesso..." />
  }

  if (acesso === 'negado') {
    return (
      <>
        <PageHeader
          title="Plataforma"
          subtitle="Esta área é de quem administra o EiBuddy inteiro, e sua conta não tem esse acesso."
        />
        <Card title="Como conseguir o acesso">
          <p className={styles.texto}>
            Criar conta não torna ninguém Super Admin: o acesso é concedido por quem já tem, e fica
            registrado quem concedeu e quando — é o que permite auditar depois.
          </p>
          <p className={styles.texto}>
            Peça a um Super Admin que abra <strong>Cargos e Super Admin</strong> e mude o seu
            perfil. Sua loja continua funcionando normalmente pelo resto do menu.
          </p>
        </Card>
      </>
    )
  }

  return <>{children}</>
}
