'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import styles from './avisoDeCookies.module.css'

/**
 * O aviso de cookies — NR-085, LGPD art. 9.
 *
 * ## Nao e banner de consentimento, e a diferenca e o ponto
 *
 * Nao ha botao de recusar, porque nao ha o que recusar: o unico cookie e o de
 * sessao, e sem ele nao existe login. A base legal e a execucao do contrato
 * (art. 7, V), nao o consentimento.
 *
 * Oferecer "aceitar / recusar" para algo que sera gravado de qualquer jeito
 * seria uma escolha falsa — e escolha falsa repetida e o que ensina a pessoa a
 * clicar em "aceitar" sem ler, o que estraga o consentimento nos casos em que
 * ele e de verdade. O que a lei cobra aqui e transparencia, e transparencia se
 * cumpre informando.
 *
 * Por isso: um botao so, "Entendi", e o link para o inventario completo.
 *
 * ## Se um cookie de analise entrar
 *
 * Este componente deixa de servir. Ai o consentimento passa a ser a base legal
 * e precisa ser previo (antes de gravar), granular (por finalidade) e revogavel
 * (com um jeito de mudar de ideia depois). `cookies.test.ts` reprova o PR que
 * introduzir cookie de analise ou marketing enquanto so existir este aviso —
 * senao o aviso viraria, ele mesmo, uma afirmacao falsa.
 *
 * ## Por que `useSyncExternalStore`, e nao um efeito
 *
 * Porque `localStorage` e um armazenamento EXTERNO ao React, e este hook existe
 * exatamente para isso. A versao anterior lia num `useEffect` e chamava
 * `setState` no corpo dele — o compilador do React reprova, com razao: e um
 * render inteiro jogado fora em toda abertura de tela.
 *
 * `getServerSnapshot` devolve "dispensado". No servidor nao ha `localStorage` e
 * nao ha o que ler; comecar visivel faria o aviso aparecer no HTML e sumir na
 * hidratacao — um pisca em toda visita de quem ja dispensou.
 */

/** A chave esta no inventario de `lib/cookies.ts`, como todo o resto. */
const CHAVE = 'nr:aviso-cookies'

const ouvintes = new Set<() => void>()

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

function lerDispensa(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) !== null
  } catch {
    /*
     * Navegador com armazenamento bloqueado, ou aba privada restritiva.
     *
     * Responde "dispensado", e nao "mostrar": sem onde gravar, mostrar o aviso
     * significaria mostra-lo em TODA navegacao, e aviso que nao sai deixa de ser
     * informacao e passa a ser obstaculo. O conteudo continua a um clique no
     * rodape.
     */
    return true
  }
}

/* No servidor nao ha o que ler. Ver o cabecalho. */
const dispensaNoServidor = (): boolean => true

export default function AvisoDeCookies() {
  const dispensado = useSyncExternalStore(assinar, lerDispensa, dispensaNoServidor)
  const aviso = useRef<HTMLElement>(null)

  /*
   * Enquanto o aviso esta na tela, a pagina ganha um rodape do tamanho dele.
   * Fixo no rodape, ele cobria o botao 'Salvar cliente' e o 'Finalizar' do PDV
   * ate a pessoa clicar em Entendi (achado do QA): sem o espaco, nao havia
   * como rolar o botao para cima do aviso.
   */
  useEffect(() => {
    const el = aviso.current
    if (dispensado || el === null) return
    const reservar = () => {
      document.body.style.paddingBottom = `${el.offsetHeight + 32}px`
    }
    reservar()
    const observador = new ResizeObserver(reservar)
    observador.observe(el)
    return () => {
      observador.disconnect()
      document.body.style.paddingBottom = ''
    }
  }, [dispensado])

  function dispensar() {
    try {
      window.localStorage.setItem(CHAVE, '1')
    } catch {
      /* Sem onde gravar, o aviso volta na proxima visita. O importante e sair
         agora, que e o que a pessoa pediu ao clicar. */
    }
    /* Avisa o hook para reler. Sem isto o aviso so sumiria na proxima
       navegacao, e o clique pareceria nao ter funcionado. */
    for (const ouvinte of ouvintes) ouvinte()
  }

  if (dispensado) return null

  return (
    /*
     * `role="region"` com nome, e nao `role="dialog"`: dialogo prende o foco e
     * exige resposta, e este aviso nao exige nada. Prender o foco de quem esta
     * lendo a pagina para informar sobre um cookie de sessao seria interromper
     * sem motivo.
     */
    <section ref={aviso} className={styles.aviso} role="region" aria-label="Aviso sobre cookies">
      <p className={styles.texto}>
        Usamos um cookie, e ele é necessário para manter você autenticado. Não usamos cookie de
        análise, de publicidade ou de rastreamento.{' '}
        <a href="/politica-de-cookies" className={styles.link}>
          Ver detalhes
        </a>
      </p>

      <button type="button" className={styles.botao} onClick={dispensar}>
        Entendi
      </button>
    </section>
  )
}
