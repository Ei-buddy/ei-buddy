'use client'

import { useEffect, useState } from 'react'
import {
  carregarCustosVariaveis,
  criarCustoVariavel,
  type CustoVariavel,
  excluirCustoVariavel,
} from '@/lib/financeiro-api'
import { Card } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { IconPlus, IconTrash } from '@/components/Icons'
import styles from './financeiro.module.css'

/** Os quatro do TXT — atalho, e nao lista fechada: qualquer nome vale. */
const SUGESTOES = ['Tarifa do cartão', 'Imposto', 'Custo operacional', 'Comissão']

/** "3,5" ou "3.5" em pontos percentuais. `NaN` quando nao da para ler. */
const paraPercentual = (texto: string): number => Number(texto.trim().replace(',', '.'))

const formatarPercentual = (p: number): string =>
  `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/**
 * Custos variaveis — percentual sobre o preco de venda. Topico 6 do TXT.
 *
 * Tarifa do cartao, imposto, custo operacional, comissao: crescem com a venda,
 * entao sao percentual, e nao valor. Valem para todo produto, e a tela de
 * produto mostra quanto eles levam de cada venda.
 *
 * Formulario na propria lista, e nao em dialogo: sao dois campos, e quem
 * cadastra costuma lancar os quatro de uma vez.
 */
export default function CustosVariaveis() {
  const [custos, setCustos] = useState<CustoVariavel[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [nome, setNome] = useState('')
  const [percentual, setPercentual] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    void (async () => {
      const r = await carregarCustosVariaveis()
      setCarregando(false)
      if (r.ok) setCustos(r.dados)
      else setErro(r.erro)
    })()
  }, [])

  const total = custos.reduce((acc, c) => acc + c.percentual, 0)
  const livres = SUGESTOES.filter((s) => !custos.some((c) => c.nome === s))

  async function adicionar(event: React.FormEvent) {
    event.preventDefault()
    const p = paraPercentual(percentual)
    if (nome.trim().length < 2) return setErro('Informe o nome do custo.')
    if (!(p > 0 && p <= 100)) return setErro('Informe um percentual entre 0 e 100.')

    setErro(null)
    setSalvando(true)
    const r = await criarCustoVariavel(nome, p)
    setSalvando(false)

    if (!r.ok) return setErro(r.erro)
    setCustos((c) => [...c, r.dados])
    setNome('')
    setPercentual('')
  }

  async function excluir(custo: CustoVariavel) {
    const r = await excluirCustoVariavel(custo.id)
    if (!r.ok) return setErro(r.erro)
    setCustos((c) => c.filter((x) => x.id !== custo.id))
  }

  return (
    <Card title={`Custos variáveis${custos.length > 0 ? ` · ${formatarPercentual(total)}` : ''}`}>
      <p className={styles.variaveisAjuda}>
        Percentual sobre o preço de venda. Vale para todo produto, e o cadastro de produto mostra
        quanto sobra depois deles.
      </p>

      {carregando ? (
        <SkeletonLinhas />
      ) : custos.length > 0 ? (
        <ul className={styles.custos}>
          {custos.map((c) => (
            <li key={c.id} className={`${styles.custo} ${styles.custoVariavel}`}>
              <span className={styles.custoPrincipal}>
                <strong>{c.nome}</strong>
              </span>
              <span className={styles.custoValor}>{formatarPercentual(c.percentual)}</span>
              <span className={styles.custoAcoes}>
                <button
                  type="button"
                  className={`${styles.custoBotao} ${styles.custoExcluir}`}
                  onClick={() => void excluir(c)}
                  aria-label={`Excluir ${c.nome}`}
                >
                  <IconTrash size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={adicionar} noValidate className={styles.variaveisForm}>
        <label className={styles.campo}>
          <span>Nome</span>
          <input
            className={styles.input}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Tarifa do cartão"
            list="sugestoes-custo-variavel"
          />
          <datalist id="sugestoes-custo-variavel">
            {livres.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={styles.campo}>
          <span>Percentual</span>
          <input
            className={styles.input}
            value={percentual}
            onChange={(e) => setPercentual(e.target.value)}
            placeholder="3,5"
            inputMode="decimal"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={salvando}>
          <IconPlus size={14} />
          Adicionar
        </Button>
      </form>

      {erro ? (
        <p className={styles.baixaErro} role="alert">
          {erro}
        </p>
      ) : null}
    </Card>
  )
}
