'use client'

import { useEffect, useRef, useState } from 'react'
import { formatMoney, hoje } from '@/lib/format'
import {
  type DadosDaBaixa,
  FORMAS_DE_RECEBIMENTO,
  type FormaDeRecebimento,
  NOMES_BANCOS,
} from '@/lib/financeiro-api'
import { listarContasBancarias } from '@/lib/contas-bancarias-api'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconClose } from '@/components/Icons'
import styles from './financeiro.module.css'
import { centavosDoTexto } from '@/lib/valor'

/**
 * Baixa de titulo — total ou parcial.
 *
 * O valor comeca preenchido com o saldo inteiro, porque quitar e o caso
 * comum. A baixa parcial exige digitar o valor de proposito: e a operacao
 * que deixa saldo em aberto, e merece atencao.
 */
export default function BaixaDialog({
  titulo,
  descricao,
  saldoCents,
  verbo,
  processando = false,
  erro,
  onConfirmar,
  onCancelar,
}: {
  titulo: string
  descricao: string
  /**
   * O saldo em CENTAVOS.
   *
   * Era em reais, e a baixa total mandaria `saldo * 100` para a api. Com o
   * arredondamento do ponto flutuante isso deixa um centavo para tras de vez em
   * quando — e um titulo que fica devendo R$ 0,01 depois de quitado nao e
   * detalhe: ele continua na lista de contas em aberto, para sempre.
   */
  saldoCents: number
  /** "pagar" ou "receber" — muda o texto e QUAIS campos aparecem. */
  verbo: 'pagar' | 'receber'
  processando?: boolean
  erro?: string | null
  onConfirmar: (dados: DadosDaBaixa) => void
  onCancelar: () => void
}) {
  const [modo, setModo] = useState<'total' | 'parcial'>('total')
  const [valorParcial, setValorParcial] = useState('')
  /*
   * A data da baixa, e nao "hoje" a forca.
   *
   * Ela e obrigatoria no contrato pelo mesmo motivo que a conta bancaria: a
   * baixa existe para casar com o extrato (RF-059). Lancada com a data em que
   * alguem lembrou de registrar, ela nao casa com nada — e lancar na segunda a
   * conta paga na sexta e o caso normal, nao a excecao.
   */
  const [data, setData] = useState(hoje)
  const [conta, setConta] = useState('')
  const [forma, setForma] = useState<FormaDeRecebimento>('pix')
  /* As contas da LOJA (RF-073). Sem nenhuma cadastrada, a lista volta a ser a
     de sugestoes genericas — a baixa nao pode travar por falta de cadastro. */
  const [contasDaLoja, setContasDaLoja] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void listarContasBancarias().then((r) => {
      const nomes = r.ok ? r.dados.map((c) => c.name) : []
      setContasDaLoja(nomes)
      /* Uma conta so: ja vem escolhida. */
      if (nomes.length === 1) setConta(nomes[0]!)
    })
  }, [])

  const sugestoes = contasDaLoja !== null && contasDaLoja.length > 0 ? contasDaLoja : NOMES_BANCOS

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processando) onCancelar()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onCancelar, processando])

  const pagar = verbo === 'pagar'

  /* Na baixa TOTAL o valor e o saldo exato — nao passa por reais e volta. */
  const valorCents = modo === 'total' ? saldoCents : (centavosDoTexto(valorParcial) ?? 0)
  const restanteCents = saldoCents - valorCents
  /* Sem a tolerancia de um centavo que existia aqui: em inteiros ela nao e
     necessaria, e era ela que deixava passar uma baixa maior que o saldo — que
     o servidor recusa depois, com a pessoa achando que tinha dado certo. */
  const valorValido = valorCents > 0 && valorCents <= saldoCents
  const contaValida = !pagar || conta.trim() !== ''
  const podeConfirmar = valorValido && contaValida && data !== ''

  const rotuloAcao = pagar ? 'Baixar pagamento' : 'Baixar recebimento'

  const confirmar = () =>
    onConfirmar({
      amountCents: valorCents,
      settledOn: data,
      ...(pagar
        ? { bankAccount: conta.trim() }
        : { method: forma, ...(conta.trim() === '' ? {} : { bankAccount: conta.trim() }) }),
    })

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !processando && onCancelar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="baixa-titulo"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="baixa-titulo" className={styles.dialogTitulo}>
            {rotuloAcao}
          </h2>
          <button
            type="button"
            className={styles.dialogFechar}
            onClick={onCancelar}
            disabled={processando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className={styles.baixaAlvo}>
          <strong>{titulo}</strong>
          <span>{descricao}</span>
        </div>

        <div className={styles.baixaSaldo}>
          <span>Saldo em aberto</span>
          <strong>{formatMoney(saldoCents / 100)}</strong>
        </div>

        <div className={styles.baixaModos} role="group" aria-label="Tipo de baixa">
          <button
            type="button"
            className={`${styles.baixaModo} ${modo === 'total' ? styles.baixaModoAtivo : ''}`}
            onClick={() => setModo('total')}
            aria-pressed={modo === 'total'}
          >
            Baixa total
          </button>
          <button
            type="button"
            className={`${styles.baixaModo} ${modo === 'parcial' ? styles.baixaModoAtivo : ''}`}
            onClick={() => setModo('parcial')}
            aria-pressed={modo === 'parcial'}
          >
            Baixa parcial
          </button>
        </div>

        {modo === 'parcial' ? (
          <label className={styles.baixaCampo}>
            <span>Valor {pagar ? 'pago' : 'recebido'} agora</span>
            <input
              className={styles.baixaInput}
              value={valorParcial}
              onChange={(e) => setValorParcial(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              autoFocus
            />
            {valorCents > 0 ? (
              <span className={styles.baixaRestante}>
                {valorCents > saldoCents
                  ? 'Este valor passa do saldo em aberto'
                  : restanteCents > 0
                    ? `Restam ${formatMoney(restanteCents / 100)} em aberto`
                    : 'Este valor quita o titulo'}
              </span>
            ) : null}
          </label>
        ) : null}

        <div className={styles.baixaLinha}>
          <label className={styles.baixaCampo}>
            <span>Data da {pagar ? 'saída' : 'entrada'}</span>
            <input
              type="date"
              className={styles.baixaInput}
              value={data}
              onChange={(e) => setData(e.target.value)}
              max={hoje()}
            />
          </label>

          {pagar ? (
            <label className={styles.baixaCampo}>
              <span>Conta de onde saiu</span>
              <input
                className={styles.baixaInput}
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder="Ex.: Banco do Brasil"
                list="baixa-contas"
                maxLength={140}
              />
              {/* `datalist` e nao `select`: a lista de bancos ajuda, mas a conta
                  pode ser uma que nao esta nela — e a api aceita texto livre. */}
              <datalist id="baixa-contas">
                {sugestoes.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
          ) : (
            <>
              {/* Onde entrou — opcional: dinheiro na gaveta nao tem conta. E o que
                faz o saldo da conta subir com os recebimentos (RF-073). */}
              {contasDaLoja !== null && contasDaLoja.length > 0 ? (
                <label className={styles.baixaCampo}>
                  <span>Conta onde entrou (opcional)</span>
                  <select
                    className={styles.baixaInput}
                    value={conta}
                    onChange={(e) => setConta(e.target.value)}
                  >
                    <option value="">Nenhuma — dinheiro no caixa</option>
                    {contasDaLoja.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={styles.baixaCampo}>
                <span>Como o cliente pagou</span>
                <select
                  className={styles.baixaInput}
                  value={forma}
                  onChange={(e) => setForma(e.target.value as FormaDeRecebimento)}
                >
                  {FORMAS_DE_RECEBIMENTO.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {erro ? (
          <p className={styles.baixaErro} role="alert">
            {erro}
          </p>
        ) : null}

        <div className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onCancelar} disabled={processando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={processando || !podeConfirmar}>
            {processando ? (
              <>
                <Spinner size={15} />
                Registrando...
              </>
            ) : (
              `Confirmar ${formatMoney(valorCents / 100)}`
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
