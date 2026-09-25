'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, FormGrid, Input } from '@/components/ui/UI'
import { lancarContaAReceber } from '@/lib/financeiro-api'
import styles from './detalhe.module.css'

/**
 * Lancar um titulo a receber de dentro da ficha — RF-065, NR-072.
 *
 * O botao "Lancar pendencia" existia e abria um aviso: "Lancamento de pendencia
 * entra com o modulo de Contas a Receber". O modulo entrou — a propria secao
 * logo acima ja LE os titulos do cliente pela api desde a NR-072 —, e o botao
 * ficou para tras dizendo que ainda nao dava.
 *
 * ## Uma linha, sem parcelamento
 *
 * A RF-065 nao pede parcelamento para o avulso, e `lancarContaAReceber` reflete
 * isso. Quem precisa de varias parcelas lanca uma venda, que e onde o
 * parcelamento mora.
 *
 * ## O cliente ja vem preenchido, e nao da para trocar
 *
 * O titulo nasce amarrado a ficha aberta. Um seletor de cliente aqui deixaria
 * lancar a divida de um na ficha de outro — e a tela seguinte mostraria uma
 * pendencia que nao aparece em lugar nenhum.
 */

/** O minimo do contrato: `description` pede dois caracteres. */
const DESCRICAO_MINIMA = 2

/** Hoje pelo relogio do navegador — so como valor INICIAL do vencimento. */
function hoje(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export default function NovaPendencia({
  clienteId,
  onLancada,
  onCancelar,
}: {
  clienteId: string
  onLancada: () => void
  onCancelar: () => void
}) {
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(hoje)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /* Aceita virgula: o lojista digita "12,50" — trocar por ponto e trabalho da
     borda, nao dele. */
  const emCentavos = Math.round(Number(valor.replace(',', '.')) * 100)
  const valorValido = Number.isFinite(emCentavos) && emCentavos > 0

  const podeEnviar =
    descricao.trim().length >= DESCRICAO_MINIMA && valorValido && vencimento !== '' && !enviando

  async function enviar() {
    setEnviando(true)
    setErro(null)

    const r = await lancarContaAReceber({
      description: descricao.trim(),
      amountCents: emCentavos,
      dueDate: vencimento,
      customerId: clienteId,
    })
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onLancada()
  }

  return (
    <div className={styles.novoContato}>
      {erro === null ? null : <p className={styles.privacidadeErro}>{erro}</p>}

      <FormGrid>
        <Field label="Do que se trata" htmlFor="pendencia-descricao" span={12}>
          <Input
            id="pendencia-descricao"
            value={descricao}
            maxLength={280}
            placeholder="Conserto do freezer"
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Field>

        <Field label="Valor (R$)" htmlFor="pendencia-valor" span={4}>
          <Input
            id="pendencia-valor"
            value={valor}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => setValor(e.target.value)}
          />
        </Field>

        <Field label="Vence em" htmlFor="pendencia-vencimento" span={4}>
          <Input
            id="pendencia-vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
          />
        </Field>
      </FormGrid>

      <div className={styles.privacidadeAcoes}>
        <Button disabled={!podeEnviar} onClick={() => void enviar()}>
          {enviando ? 'Lançando…' : 'Lançar pendência'}
        </Button>
        <Button variant="ghost" disabled={enviando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
