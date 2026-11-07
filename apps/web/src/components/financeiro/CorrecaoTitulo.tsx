'use client'

import { useEffect, useRef, useState } from 'react'
import { cancelarTitulo, corrigirTitulo, type CorrecaoDeTitulo } from '@/lib/financeiro-api'
import { carregarPlano, type ContaContabil } from '@/lib/contabilidade-api'
import { centavosDoTexto } from '@/lib/valor'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { LegendaObrigatorio, MarcaObrigatorio } from '@/components/ui/UI'
import { IconClose } from '@/components/Icons'
import styles from './financeiro.module.css'
import { useDialogo } from '@/components/app/useDialogo'

/** O minimo do servidor para o motivo do cancelamento. */
const MOTIVO_MINIMO = 3

export type TituloCorrigivel = {
  id: string
  contraparte: string
  descricao: string
  vencimento: string
  valorCents: number
  /** O plano de conta atual — so a pagar tem. */
  accountId?: string | null
}

const paraTexto = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/**
 * Corrigir ou cancelar um titulo lancado errado — NR-150.
 *
 * So aparece para titulo SEM baixa (e, no a receber, so o avulso): com
 * dinheiro registrado, o caminho e estornar antes. O servidor confere de novo,
 * e o erro dele aparece aqui dentro.
 *
 * Manda so o que MUDOU: corrigir o vencimento nao reenvia o valor, e a trilha
 * mostra exatamente o que foi alterado.
 */
export default function CorrecaoTitulo({
  tipo,
  modo,
  titulo,
  onFeito,
  onFechar,
}: {
  tipo: 'pagar' | 'receber'
  /** `classificar`: so o plano de conta — vale em conta ja paga. */
  modo: 'corrigir' | 'cancelar' | 'classificar'
  titulo: TituloCorrigivel
  onFeito: (mensagem: string) => void
  onFechar: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pagar = tipo === 'pagar'

  const [fornecedor, setFornecedor] = useState(titulo.contraparte)
  const [descricao, setDescricao] = useState(titulo.descricao)
  const [valor, setValor] = useState(paraTexto(titulo.valorCents))
  const [vencimento, setVencimento] = useState(titulo.vencimento)
  const [motivo, setMotivo] = useState('')
  const [plano, setPlano] = useState(titulo.accountId ?? '')
  const [planos, setPlanos] = useState<ContaContabil[] | null>(null)

  /* O plano de conta na correcao — achado do QA: "quando for corrigir o contas
     a pagar ter como atribuir a um plano de contas". */
  useEffect(() => {
    if (!pagar || modo === 'cancelar') return
    void carregarPlano().then((r) => setPlanos(r.ok ? r.dados.accounts : []))
  }, [pagar, modo])

  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useDialogo(ref, onFechar, salvando)

  async function confirmar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)

    if (modo === 'cancelar') {
      if (motivo.trim().length < MOTIVO_MINIMO) {
        setErro('Diga por que está cancelando.')
        return
      }
      setSalvando(true)
      const r = await cancelarTitulo(tipo, titulo.id, motivo.trim())
      setSalvando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      onFeito('Lançamento cancelado.')
      return
    }

    const planoMudou = pagar && plano !== (titulo.accountId ?? '')

    if (modo === 'classificar') {
      if (!planoMudou) {
        onFechar()
        return
      }
      setSalvando(true)
      const r = await corrigirTitulo(tipo, titulo.id, { accountId: plano === '' ? null : plano })
      setSalvando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      onFeito('Plano de conta atualizado.')
      return
    }

    const cents = centavosDoTexto(valor)
    if (cents === null || cents <= 0) {
      setErro('Informe um valor maior que zero.')
      return
    }
    if (pagar && fornecedor.trim().length < 2) {
      setErro('Informe o fornecedor.')
      return
    }
    if (descricao.trim().length < 2) {
      setErro('Descreva o lançamento.')
      return
    }
    if (!vencimento) {
      setErro('Informe a data de vencimento.')
      return
    }

    const mudancas: CorrecaoDeTitulo = {}
    if (pagar && fornecedor.trim() !== titulo.contraparte) mudancas.supplier = fornecedor.trim()
    if (descricao.trim() !== titulo.descricao) mudancas.description = descricao.trim()
    if (cents !== titulo.valorCents) mudancas.amountCents = cents
    if (vencimento !== titulo.vencimento) mudancas.dueDate = vencimento
    if (planoMudou) mudancas.accountId = plano === '' ? null : plano

    if (Object.keys(mudancas).length === 0) {
      onFechar()
      return
    }

    setSalvando(true)
    const r = await corrigirTitulo(tipo, titulo.id, mudancas)
    setSalvando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    onFeito('Lançamento corrigido.')
  }

  const cancelar = modo === 'cancelar'

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !salvando && onFechar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={`${styles.dialogPainel} ${cancelar ? '' : styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="correcao-titulo"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="correcao-titulo" className={styles.dialogTitulo}>
            {cancelar
              ? 'Cancelar lançamento'
              : modo === 'classificar'
                ? 'Plano de conta'
                : 'Corrigir lançamento'}
          </h2>
          <button
            type="button"
            className={styles.dialogFechar}
            onClick={onFechar}
            disabled={salvando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <form onSubmit={confirmar} noValidate className={styles.formCampos}>
          {cancelar ? (
            <>
              <p className={styles.baixaRestante}>
                {titulo.contraparte} · {titulo.descricao}. O lançamento sai das contas em aberto,
                mas continua no histórico com o motivo.
              </p>
              <label className={styles.estornoMotivo}>
                <span>
                  Motivo do cancelamento
                  <MarcaObrigatorio />
                </span>
                <textarea
                  aria-required
                  className={styles.estornoMotivoInput}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: lançado em dobro"
                  maxLength={280}
                  disabled={salvando}
                />
              </label>
            </>
          ) : modo === 'classificar' ? (
            <p className={styles.baixaRestante}>
              {titulo.contraparte} · {titulo.descricao}. A conta já tem pagamento, então só a
              classificação muda — ela decide onde a conta entra no DRE.
            </p>
          ) : (
            <>
              <LegendaObrigatorio />
              {pagar ? (
                <label className={styles.campo}>
                  <span>
                    Fornecedor
                    <MarcaObrigatorio />
                  </span>
                  <input
                    aria-required
                    className={styles.input}
                    value={fornecedor}
                    onChange={(e) => setFornecedor(e.target.value)}
                    maxLength={140}
                  />
                </label>
              ) : null}

              <div className={styles.formLinha}>
                <label className={styles.campo}>
                  <span>
                    Data de vencimento
                    <MarcaObrigatorio />
                  </span>
                  <input
                    aria-required
                    type="date"
                    className={styles.input}
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                  />
                </label>

                <label className={styles.campo}>
                  <span>
                    Valor
                    <MarcaObrigatorio />
                  </span>
                  <input
                    aria-required
                    className={styles.input}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>

              <label className={styles.campo}>
                <span>
                  {pagar ? 'O que é' : 'Referente a'}
                  <MarcaObrigatorio />
                </span>
                <input
                  aria-required
                  className={styles.input}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  maxLength={280}
                />
              </label>
            </>
          )}

          {pagar && !cancelar ? (
            <label className={styles.campo}>
              <span>Plano de conta</span>
              <select
                className={styles.input}
                value={plano}
                onChange={(e) => setPlano(e.target.value)}
                aria-label="Plano de conta"
                disabled={planos === null}
              >
                <option value="">{planos === null ? 'Carregando...' : 'Sem classificação'}</option>
                {(planos ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {erro !== null ? (
            <p className={styles.baixaErro} role="alert">
              {erro}
            </p>
          ) : null}

          <div className={styles.dialogAcoes}>
            <Button variant="secondary" onClick={onFechar} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" variant={cancelar ? 'danger' : 'primary'} disabled={salvando}>
              {salvando ? (
                <>
                  <Spinner size={15} />
                  Salvando...
                </>
              ) : cancelar ? (
                'Cancelar lançamento'
              ) : modo === 'classificar' ? (
                'Salvar plano de conta'
              ) : (
                'Salvar correção'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
