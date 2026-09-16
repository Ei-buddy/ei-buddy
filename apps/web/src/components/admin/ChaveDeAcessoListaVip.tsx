'use client'

import { useEffect, useSyncExternalStore, type FormEvent, type ReactNode, useState } from 'react'
import Link from 'next/link'
import { esquecerChaveDaListaVip, lerChaveDaListaVip, salvarChaveDaListaVip } from '@/lib/admin-api'
import { Button } from '@/components/ui/Button'
import { Card, Field, Input, PageHeader } from '@/components/ui/UI'
import styles from './lista-vip.module.css'

/**
 * Porta provisoria do painel da lista de espera — NR-111.
 *
 * Ainda nao existe o primeiro Super Admin (a concessao exige outro Super
 * Admin ja existente — ver a migration 0008), e o painel nao pode esperar
 * por isso. Em vez de sessao, pede uma chave compartilhada e a guarda so no
 * `localStorage` deste navegador; as chamadas de `admin-api.ts` a mandam no
 * cabecalho `x-waitlist-admin-key`, e a api confere (`chaveValida`, em
 * `routes/waitlist.ts`). `proxy.ts` tem a excecao correspondente, sem ela o
 * redirecionamento para `/login` aconteceria antes desta tela sequer
 * carregar.
 *
 * `useSyncExternalStore`, e nao `useEffect` + `setState` — mesma razao de
 * `AvisoDeCookies.tsx`: `localStorage` e armazenamento EXTERNO ao React, e
 * ler no efeito e chamar `setState` no corpo dele e um render inteiro jogado
 * fora toda vez que a tela abre (o compilador reprova, com razao).
 * `getServerSnapshot` devolve `null`: no servidor nao ha `localStorage`, e
 * comecar sempre pelo formulario evita o pisca de trocar de tela na
 * hidratacao.
 *
 * Sem verificacao previa: um valor errado so aparece quando as chamadas do
 * painel falharem (a chave nao viaja de volta com "certa"/"errada", so como
 * 401/403 na resposta) — "Usar outra chave" cobre o caso de digitar errado.
 *
 * ## A chave nao pode ser a UNICA porta
 *
 * A api ja aceita as duas coisas nesta rota: a chave OU sessao de Super
 * Admin (`routes/waitlist.ts`). Esta tela, porem, so olhava a chave — e o
 * efeito era o pior possivel: quem ja e Super Admin fazia login, abria o
 * painel e via um pedido de chave que ninguem tinha. As respostas estavam
 * gravadas o tempo todo, e o painel dizia o contrario por omissao.
 *
 * Por isso, sem chave guardada, a tela PERGUNTA a api quem esta logado
 * (`/admin/super-admins` so responde a Super Admin) antes de pedir qualquer
 * coisa. A chave continua existindo para quem ainda nao tem conta — que era
 * o caso que a criou.
 */

const ouvintes = new Set<() => void>()

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

const chaveNoServidor = (): string | null => null

function avisarOuvintes(): void {
  for (const ouvinte of ouvintes) ouvinte()
}

/**
 * O que a tela sabe sobre quem esta do outro lado.
 *
 * `sem-sessao` e `sem-permissao` sao separados porque o que falta em cada um e
 * diferente: um precisa entrar na conta, o outro precisa que alguem promova a
 * conta dele. Juntar os dois em "precisa de chave" foi o que mandou alguem
 * procurar por uma chave quando o que faltava era login.
 */
type Acesso = 'perguntando' | 'super-admin' | 'sem-sessao' | 'sem-permissao'

/**
 * Pergunta a api quem esta logado — 200, 401 e 403 sao respostas diferentes.
 *
 * `fetch` cru, e nao `pedir()`: aquele devolve so `{ ok, erro }` e joga fora o
 * codigo, e e exatamente o codigo que diz qual das duas faltas e a desta
 * pessoa. `/admin/super-admins` serve de pergunta por ser barata e por so
 * responder 200 a quem e Super Admin.
 */
async function perguntarAcesso(): Promise<Exclude<Acesso, 'perguntando'>> {
  try {
    const r = await fetch('/api/admin/super-admins', { credentials: 'same-origin' })
    if (r.ok) return 'super-admin'
    return r.status === 403 ? 'sem-permissao' : 'sem-sessao'
  } catch {
    /* Sem rede: a chave e o unico caminho que ainda pode dar certo. */
    return 'sem-sessao'
  }
}

export default function ChaveDeAcessoListaVip({ children }: { children: ReactNode }) {
  const chave = useSyncExternalStore(assinar, lerChaveDaListaVip, chaveNoServidor)
  const [rascunho, setRascunho] = useState('')
  const [acesso, setAcesso] = useState<Acesso>('perguntando')

  /* Uma pergunta so, na abertura: quem ja e Super Admin nao ve porta nenhuma.
     Com chave guardada nem pergunta — a chave ja e a resposta. */
  useEffect(() => {
    if (chave !== null) return

    void (async () => {
      setAcesso(await perguntarAcesso())
    })()
  }, [chave])

  function entrar(evento: FormEvent) {
    evento.preventDefault()
    const valor = rascunho.trim()
    if (valor === '') return

    salvarChaveDaListaVip(valor)
    avisarOuvintes()
  }

  function trocar() {
    esquecerChaveDaListaVip()
    setRascunho('')
    avisarOuvintes()
  }

  /* Sessao de Super Admin: o painel abre direto, sem chave e sem botao de
     trocar chave — nao ha chave nenhuma nesse caminho. */
  if (chave === null && acesso === 'super-admin') return <>{children}</>

  if (chave === null && acesso === 'perguntando') {
    return <PageHeader title="Lista de espera" subtitle="Conferindo seu acesso..." />
  }

  if (chave === null) {
    return (
      <>
        <PageHeader
          title="Lista de espera"
          subtitle="Acesso provisório — cole a chave para entrar"
        />
        {/* Dizer O QUE FALTA, e nao so pedir a chave: sem isto, quem esta
            logado sem ser Super Admin sai procurando uma chave que nao
            resolve o caso dele. */}
        {acesso === 'sem-permissao' ? (
          <p className={styles.chaveAviso}>
            Você está logado, mas esta conta ainda não tem acesso de Super Admin. Peça para
            promoverem sua conta — depois disso este painel abre sozinho, sem chave.
          </p>
        ) : (
          <p className={styles.chaveAviso}>
            Você não está logado.{' '}
            <Link href="/login" className={styles.chaveLink}>
              Entre na sua conta
            </Link>{' '}
            — se ela for Super Admin, este painel abre sozinho. A chave é só para quem ainda não tem
            conta.
          </p>
        )}
        <Card title="Chave de acesso">
          <form className={styles.chaveForm} onSubmit={entrar}>
            <Field label="Chave" htmlFor="chave-lista-vip">
              <Input
                id="chave-lista-vip"
                type="password"
                autoComplete="off"
                autoFocus
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                placeholder="Cole a chave de acesso"
              />
            </Field>
            <Button type="submit" disabled={rascunho.trim() === ''}>
              Entrar
            </Button>
          </form>
        </Card>
      </>
    )
  }

  return (
    <>
      {children}
      <button type="button" className={styles.chaveTrocar} onClick={trocar}>
        Usar outra chave
      </button>
    </>
  )
}
