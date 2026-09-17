'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buscar,
  MINIMO_DA_BUSCA,
  type Resultado,
  ROTULO_DO_TIPO,
  type TipoDeResultado,
} from '@/lib/busca-api'
import { IconSearch } from '@/components/Icons'
import styles from './BuscaSpotlight.module.css'

/**
 * A busca do app, em overlay — NR-126.
 *
 * ## O que muda em relacao ao campo que havia na barra
 *
 * A busca ja existia e ja consultava produto, cliente e venda de verdade
 * (`lib/busca-api`). O que ela nao fazia era achar TELA: quem queria o plano
 * de contas precisava lembrar que ele mora dentro de Financeiro e clicar dois
 * niveis de menu. Agora as telas entram como resultado, ao lado dos
 * registros, com a mesma caixa e o mesmo teclado.
 *
 * O campo saiu da barra e virou botao: um campo sempre visivel promete que
 * digitar ali e o caminho, e ai a lista de resultados nasce espremida entre a
 * barra e o conteudo. No centro da tela ela cabe.
 *
 * ## Os dois atalhos
 *
 * `/` ja existia e continua valendo — quem aprendeu nao precisa reaprender.
 * `Ctrl/Cmd+K` entra ao lado dele, que e o que a maioria tenta primeiro.
 * Nenhum dos dois rouba tecla de formulario: os dois sao ignorados enquanto
 * se digita em outro campo, senao escrever "/" num endereco ou um atalho do
 * navegador viraria uma busca.
 *
 * ## O que NAO mudou
 *
 * A consulta e a mesma funcao, contra os mesmos endpoints. As telas listadas
 * chegam prontas de quem monta a navegacao, ja filtradas por papel — esta
 * caixa nao decide permissao, e nao pode: revelar uma tela que a pessoa nao
 * abre seria contar o que existe do outro lado da porta.
 */

/** Espera a digitacao parar — mesmo valor da busca anterior. */
const ESPERA_MS = 250

const ORDEM: readonly TipoDeResultado[] = ['produto', 'cliente', 'venda']

export type TelaBuscavel = {
  href: string
  titulo: string
  /** Onde ela fica, para diferenciar telas de nome parecido. */
  secao?: string
}

type Item = {
  chave: string
  titulo: string
  detalhe: string | undefined
  href: string
}

/** Sem acento e sem caixa: quem procura "financeiro" digita "financeiro". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export default function BuscaSpotlight({ telas }: { telas: readonly TelaBuscavel[] }) {
  const router = useRouter()
  const semMovimento = useReducedMotion()

  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [registros, setRegistros] = useState<Resultado[]>([])
  const [ativo, setAtivo] = useState(0)

  const campoRef = useRef<HTMLInputElement>(null)

  const busca = termo.trim()
  const curto = busca.length < MINIMO_DA_BUSCA

  /* --- Telas: filtram na hora, sem ida ao servidor --- */
  const telasAchadas = useMemo(() => {
    const alvo = normalizar(busca)
    const casa = telas.filter(
      (t) => alvo === '' || normalizar(`${t.titulo} ${t.secao ?? ''}`).includes(alvo),
    )
    return casa.map<Item>((t) => ({
      chave: `tela:${t.href}`,
      titulo: t.titulo,
      detalhe: t.secao,
      href: t.href,
    }))
  }, [telas, busca])

  /* --- Registros: a mesma consulta de antes, com a mesma espera --- */
  useEffect(() => {
    /*
     * Sai sem limpar nada. Limpar aqui seria `setState` sincrono no corpo do
     * efeito — um render inteiro jogado fora a cada tecla, e o lint reprova.
     * O que ja estava guardado fica invisivel pela guarda do render abaixo, e
     * volta a valer se a pessoa apagar uma letra e escrever de novo.
     */
    if (!aberto || curto) return

    /*
     * Sem a espera, "cafe" dispara quatro rodadas de consulta, e a resposta da
     * segunda pode chegar depois da quarta — deixando a lista de "caf" sob a
     * palavra "cafe". O `cancelado` cuida do que ja partiu.
     */
    let cancelado = false
    const t = setTimeout(() => {
      void (async () => {
        const achados = await buscar(busca)
        if (!cancelado) setRegistros(achados)
      })()
    }, ESPERA_MS)

    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [aberto, busca, curto])

  /* A lista achatada e a que o teclado percorre: os grupos abaixo sao so
     apresentacao, e duas listas separadas fariam a seta pular buraco. */
  const grupos = useMemo(() => {
    /* A guarda: termo curto nao MOSTRA registro, mesmo que ainda haja algum
       guardado da consulta anterior. */
    const achados = curto ? [] : registros

    const porTipo = ORDEM.map((tipo) => ({
      rotulo: ROTULO_DO_TIPO[tipo],
      itens: achados
        .filter((r) => r.tipo === tipo)
        .map<Item>((r) => ({
          chave: `${r.tipo}:${r.href}`,
          titulo: r.titulo,
          detalhe: r.apoio,
          href: r.href,
        })),
    })).filter((g) => g.itens.length > 0)

    return [{ rotulo: 'Telas', itens: telasAchadas }, ...porTipo].filter((g) => g.itens.length > 0)
  }, [telasAchadas, registros, curto])

  const itens = useMemo(() => grupos.flatMap((g) => g.itens), [grupos])

  const fechar = useCallback(() => {
    setAberto(false)
    setTermo('')
    setRegistros([])
    setAtivo(0)
  }, [])

  const abrir = useCallback(() => {
    setAberto(true)
    setAtivo(0)
  }, [])

  /* --- `/` e Ctrl/Cmd+K abrem de qualquer lugar --- */
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      const editando =
        alvo?.tagName === 'INPUT' ||
        alvo?.tagName === 'TEXTAREA' ||
        alvo?.tagName === 'SELECT' ||
        alvo?.isContentEditable === true

      const ehK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      /* O `/` so vale fora de campo; o Ctrl+K vale sempre, porque a
         combinacao nao produz caractere e ninguem a digita sem querer. */
      const ehBarra = e.key === '/' && !editando

      if (!ehK && !ehBarra) return

      e.preventDefault()
      abrir()
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [abrir])

  /* O foco entra na caixa assim que ela abre. `requestAnimationFrame` porque
     o campo so existe depois que a animacao monta o overlay. */
  useEffect(() => {
    if (!aberto) return
    const id = requestAnimationFrame(() => campoRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [aberto])

  /* O indice ativo nao pode sobreviver a uma lista que encolheu. */
  const ativoSeguro = itens.length === 0 ? 0 : Math.min(ativo, itens.length - 1)

  function escolher(item: Item) {
    fechar()
    /* `router.push`, e nao `<a href>`: e tela do proprio app, e recarregar a
       pagina inteira jogaria fora a sessao ja carregada e o estado do painel. */
    router.push(item.href)
  }

  function aoTeclarNaCaixa(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      fechar()
      return
    }

    if (itens.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      /* Circula: de baixo volta ao topo, em vez de bater numa parede. */
      setAtivo((i) => (i + 1) % itens.length)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => (i - 1 + itens.length) % itens.length)
      return
    }

    if (e.key === 'Enter') {
      const escolhido = itens[ativoSeguro]
      if (escolhido === undefined) return
      e.preventDefault()
      escolher(escolhido)
    }
  }

  let indice = -1

  return (
    <>
      <button type="button" className={styles.gatilho} onClick={abrir}>
        <IconSearch size={18} />
        <span className={styles.gatilhoTexto}>Buscar tela, cliente, produto ou venda</span>
        <kbd className={styles.tecla}>Ctrl K</kbd>
      </button>

      <AnimatePresence>
        {aberto ? (
          <motion.div
            className={styles.fundo}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: semMovimento ? 0 : 0.16 }}
            onMouseDown={(e) => {
              /* So o clique NO fundo fecha: `mousedown` que comeca dentro da
                 caixa e termina fora (selecionar texto) nao pode fechar. */
              if (e.target === e.currentTarget) fechar()
            }}
          >
            <motion.div
              className={styles.caixa}
              role="dialog"
              aria-modal="true"
              aria-label="Busca"
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -4 }}
              transition={
                semMovimento ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }
              }
              onKeyDown={aoTeclarNaCaixa}
            >
              <div className={styles.campo}>
                <IconSearch size={19} />
                <input
                  ref={campoRef}
                  type="text"
                  value={termo}
                  onChange={(e) => {
                    setTermo(e.target.value)
                    setAtivo(0)
                  }}
                  placeholder="Buscar tela, cliente, produto ou venda"
                  aria-label="Buscar tela, cliente, produto ou venda"
                  role="combobox"
                  aria-expanded={itens.length > 0}
                  aria-controls="spotlight-resultados"
                  aria-autocomplete="list"
                  {...(itens[ativoSeguro] === undefined
                    ? {}
                    : { 'aria-activedescendant': `spotlight-${itens[ativoSeguro].chave}` })}
                />
                <kbd className={styles.tecla}>Esc</kbd>
              </div>

              <div className={styles.resultados} id="spotlight-resultados" role="listbox">
                {itens.length === 0 ? (
                  <p className={styles.vazio}>
                    {curto
                      ? 'Digite para buscar clientes, produtos e vendas.'
                      : `Nada encontrado para "${busca}".`}
                  </p>
                ) : (
                  grupos.map((grupo) => (
                    <div key={grupo.rotulo} className={styles.grupo}>
                      <span className={styles.grupoRotulo}>{grupo.rotulo}</span>

                      {grupo.itens.map((item) => {
                        indice += 1
                        const estaAtivo = indice === ativoSeguro
                        const meu = indice

                        return (
                          <button
                            key={item.chave}
                            type="button"
                            id={`spotlight-${item.chave}`}
                            role="option"
                            aria-selected={estaAtivo}
                            className={`${styles.item} ${estaAtivo ? styles.itemAtivo : ''}`}
                            onMouseEnter={() => setAtivo(meu)}
                            onClick={() => escolher(item)}
                          >
                            <span className={styles.itemTitulo}>{item.titulo}</span>
                            {item.detalhe === undefined ? null : (
                              <span className={styles.itemDetalhe}>{item.detalhe}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
