'use client'

import Link from 'next/link'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { listarClientes, type ClienteDaLista } from '@/lib/clientes-api'
import { maskDocumento } from '@/lib/validation'
import styles from './busca-de-cliente.module.css'

export type ClienteEscolhido = { id: string; nome: string }

/** Quantos aparecem por vez: o bastante para achar, pouco para nao virar uma pagina. */
export const ACHADOS_POR_VEZ = 8

/**
 * Escolher cliente buscando no servidor — NR-217.
 *
 * Achado do QA: o formulario do CRM era um `<select>` com a PRIMEIRA pagina
 * de clientes (24). Da 25a em diante a loja nao conseguia vincular o cliente
 * ao card. Aqui a busca vai ao servidor a cada digitacao (nome, CPF/CNPJ ou
 * celular), como no PDV e no orcamento.
 *
 * Enter com um achado so ja escolhe; Esc fecha a lista.
 */
export default function BuscaDeCliente({
  valor,
  onEscolher,
  classeDoCampo,
  rotulo = 'Cliente',
}: {
  valor: ClienteEscolhido | null
  onEscolher: (cliente: ClienteEscolhido | null) => void
  /** Para o campo ter a cara do formulario onde esta. */
  classeDoCampo?: string
  rotulo?: string
}) {
  const [termo, setTermo] = useState('')
  const [aberta, setAberta] = useState(false)
  const [achados, setAchados] = useState<ClienteDaLista[] | null>(null)
  const idDaLista = useId()

  /*
   * Busca depois de a digitacao parar, e so a resposta do termo ATUAL vale:
   * a de "Mar" chegando depois da de "Maria" pintaria a lista errada.
   */
  useEffect(() => {
    if (!aberta) return
    let valendo = true
    const t = setTimeout(() => {
      void listarClientes({ termo: termo.trim() }).then((r) => {
        if (valendo) setAchados(r.ok ? r.dados.clientes.slice(0, ACHADOS_POR_VEZ) : [])
      })
    }, 200)
    return () => {
      valendo = false
      clearTimeout(t)
    }
  }, [termo, aberta])

  function escolher(c: ClienteDaLista) {
    onEscolher({ id: c.id, nome: c.nome })
    setTermo('')
    setAberta(false)
    setAchados(null)
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      /* Com a lista aberta, o Esc e dela: fecha so a lista, e o dialogo em
         volta ve o `preventDefault` e fica (ver `useDialogo`). Com a lista
         fechada, o Esc segue para o dialogo, como em qualquer campo. */
      if (aberta) e.preventDefault()
      setAberta(false)
      return
    }
    if (e.key !== 'Enter') return
    /* Enter nunca envia o formulario em volta: aqui ele escolhe ou abre. */
    e.preventDefault()
    if (aberta && achados?.length === 1) escolher(achados[0]!)
    else setAberta(true)
  }

  if (valor !== null) {
    return (
      <div className={styles.escolhido}>
        <strong>{valor.nome}</strong>
        <span className={styles.acoes}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onEscolher(null)
              setAberta(true)
            }}
          >
            Trocar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEscolher(null)}>
            Sem cliente
          </Button>
        </span>
      </div>
    )
  }

  return (
    <div className={styles.raiz}>
      <input
        className={classeDoCampo}
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value)
          setAberta(true)
        }}
        onFocus={() => setAberta(true)}
        onKeyDown={aoTeclar}
        placeholder="Busque por nome, CPF/CNPJ ou celular"
        autoComplete="off"
        aria-label={rotulo}
        role="combobox"
        aria-expanded={aberta && achados !== null}
        aria-controls={idDaLista}
      />

      {aberta && achados !== null ? (
        <ul
          id={idDaLista}
          className={styles.lista}
          role="listbox"
          aria-label="Clientes cadastrados"
        >
          {achados.length === 0 ? (
            <li className={styles.vazio}>
              Nenhum cliente encontrado.{' '}
              <Link href="/app/clientes/novo" target="_blank">
                Cadastrar cliente
              </Link>{' '}
              e depois buscar de novo.
            </li>
          ) : (
            achados.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button type="button" className={styles.item} onClick={() => escolher(c)}>
                  <span>{c.nome}</span>
                  <small>
                    {c.documento
                      ? maskDocumento(c.documento, c.documento.length > 11 ? 'juridica' : 'fisica')
                      : (c.celular ?? 'sem documento')}
                  </small>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
