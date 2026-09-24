'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { IconPlus, IconSearch } from '@/components/Icons'
import styles from './campoTag.module.css'

/**
 * Campo "(T)" do mapeamento: selecao com autocomplete e criacao no fluxo.
 *
 * Criar aqui, sem sair da tela, e o ponto central: mandar a pessoa para
 * outro cadastro no meio de um lancamento e onde ela costuma desistir.
 *
 * Usado por categoria, fornecedor, plano de contas, banco e cliente.
 */
export default function CampoTag({
  valor,
  opcoes,
  onChange,
  onCriar,
  placeholder = 'Buscar ou criar',
  ariaLabel,
  invalido = false,
}: {
  valor: string
  opcoes: string[]
  onChange: (valor: string) => void
  /** Chamado quando um valor novo e criado — o pai guarda na lista. */
  onCriar: (valor: string) => void
  placeholder?: string
  ariaLabel: string
  invalido?: boolean
}) {
  const id = useId()
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [destacado, setDestacado] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase()
    if (!t) return opcoes
    return opcoes.filter((o) => o.toLowerCase().includes(t))
  }, [opcoes, termo])

  /* So oferece criar quando o texto nao bate exatamente com nada. */
  const podeCriar =
    termo.trim().length > 0 && !opcoes.some((o) => o.toLowerCase() === termo.trim().toLowerCase())

  const totalItens = filtradas.length + (podeCriar ? 1 : 0)

  function escolher(opcao: string) {
    onChange(opcao)
    setTermo('')
    setAberto(false)
  }

  function criar() {
    const limpo = termo.trim()
    if (!limpo) return
    onCriar(limpo)
    escolher(limpo)
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAberto(true)
      setDestacado((d) => (d + 1) % Math.max(totalItens, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestacado((d) => (d - 1 + totalItens) % Math.max(totalItens, 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (destacado < filtradas.length) {
        escolher(filtradas[destacado])
      } else if (podeCriar) {
        criar()
      }
      return
    }
    if (e.key === 'Escape') {
      setAberto(false)
      setTermo('')
    }
  }

  /* Fecha ao sair do campo, mas so depois do clique na lista ser
     processado — por isso o atraso curto.

     O que foi digitado FICA. Antes, digitar "Mercearia" e passar para o
     proximo campo com Tab apagava o texto em silencio — so valia quem clicava
     em "Criar" ou apertava Enter. Na primeira categoria da loja, a lista esta
     vazia e o campo e obrigatorio: o cadastro de produto travava em "Informe a
     categoria" com a categoria escrita na tela. Esc continua descartando. */
  function aoSairDoFoco(e: React.FocusEvent) {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return
    const limpo = termo.trim()
    if (aberto && limpo !== '') {
      const existente = opcoes.find((o) => o.toLowerCase() === limpo.toLowerCase())
      if (existente === undefined) onCriar(limpo)
      onChange(existente ?? limpo)
    }
    setAberto(false)
    setTermo('')
  }

  return (
    <div className={styles.wrap} ref={wrapRef} onBlur={aoSairDoFoco}>
      <div className={`${styles.campo} ${invalido ? styles.campoInvalido : ''}`}>
        <IconSearch size={16} />
        <input
          id={id}
          className={styles.input}
          value={aberto ? termo : valor}
          onChange={(e) => {
            setTermo(e.target.value)
            setAberto(true)
            setDestacado(0)
          }}
          onFocus={() => {
            setAberto(true)
            setTermo('')
            setDestacado(0)
          }}
          onKeyDown={aoTeclar}
          placeholder={valor || placeholder}
          aria-label={ariaLabel}
          aria-expanded={aberto}
          aria-autocomplete="list"
          role="combobox"
          aria-controls={`${id}-lista`}
          autoComplete="off"
        />
        {valor && !aberto ? (
          <button
            type="button"
            className={styles.limpar}
            onClick={() => onChange('')}
            aria-label={`Limpar ${ariaLabel}`}
          >
            ×
          </button>
        ) : null}
      </div>

      {aberto ? (
        <ul className={styles.lista} id={`${id}-lista`} role="listbox">
          {filtradas.map((opcao, i) => (
            <li key={opcao} role="option" aria-selected={valor === opcao}>
              <button
                type="button"
                className={`${styles.opcao} ${i === destacado ? styles.opcaoAtiva : ''}`}
                onMouseEnter={() => setDestacado(i)}
                onClick={() => escolher(opcao)}
              >
                {opcao}
              </button>
            </li>
          ))}

          {podeCriar ? (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                className={`${styles.criar} ${destacado === filtradas.length ? styles.opcaoAtiva : ''}`}
                onMouseEnter={() => setDestacado(filtradas.length)}
                onClick={criar}
              >
                <IconPlus size={14} />
                Criar &ldquo;{termo.trim()}&rdquo;
              </button>
            </li>
          ) : null}

          {filtradas.length === 0 && !podeCriar ? (
            <li className={styles.vazio}>Nada encontrado</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
