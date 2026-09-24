'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, FormGrid, Input, Select } from '@/components/ui/UI'
import { lancarContato, type TipoDeContato } from '@/lib/clientes-api'
import styles from './detalhe.module.css'

/**
 * Lancar um contato de dentro da ficha — RF-011, NR-072.
 *
 * O botao "Novo contato" existia e abria um aviso: "Lancamento de contato entra
 * com o modulo de CRM". Nao entrou — o CRM que existe (NR-109) e um quadro de
 * oportunidades da loja, e nao o diario de quem falou com quem.
 *
 * ## Um formulario embutido, e nao um dialogo
 *
 * Quem esta na ficha acabou de desligar o telefone e quer anotar uma linha. Um
 * modal tira a ficha da frente justamente na hora em que ela e a referencia do
 * que se vai escrever ("ele falou do pedido 8891"), e ainda pede um clique a
 * mais para fechar.
 *
 * ## A data vem preenchida com hoje, e da para mudar
 *
 * O caso comum e anotar o que acabou de acontecer. Mas o lojista tambem lanca
 * na segunda a ligacao do sabado, e e por isso que o campo existe: a ficha
 * ordena pelo dia do FATO.
 */

const TIPOS: { valor: TipoDeContato; rotulo: string }[] = [
  { valor: 'ligacao', rotulo: 'Ligação' },
  { valor: 'whatsapp', rotulo: 'WhatsApp' },
  { valor: 'visita', rotulo: 'Visita' },
  { valor: 'observacao', rotulo: 'Observação' },
]

/** O minimo do contrato: `description` pede tres caracteres. */
const DESCRICAO_MINIMA = 3

/** Hoje pelo relogio do navegador — so como valor INICIAL do campo. */
function hoje(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export default function NovoContato({
  clienteId,
  onLancado,
  onCancelar,
}: {
  clienteId: string
  onLancado: () => void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState<TipoDeContato>('ligacao')
  const [descricao, setDescricao] = useState('')
  const [data, setData] = useState(hoje)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const podeEnviar = descricao.trim().length >= DESCRICAO_MINIMA && data !== '' && !enviando

  async function enviar() {
    setEnviando(true)
    setErro(null)

    const r = await lancarContato(clienteId, { tipo, descricao, data })
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onLancado()
  }

  return (
    <div className={styles.novoContato}>
      {erro === null ? null : <p className={styles.privacidadeErro}>{erro}</p>}

      <FormGrid>
        <Field label="Tipo" htmlFor="contato-tipo" span={4}>
          <Select
            id="contato-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDeContato)}
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Quando" htmlFor="contato-data" span={4}>
          <Input
            id="contato-data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </Field>

        <Field label="O que aconteceu" htmlFor="contato-descricao" span={12}>
          <Input
            id="contato-descricao"
            value={descricao}
            maxLength={500}
            placeholder="Confirmou o pedido 8891 para o dia 25."
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Field>
      </FormGrid>

      <div className={styles.privacidadeAcoes}>
        <Button disabled={!podeEnviar} onClick={() => void enviar()}>
          {enviando ? 'Salvando…' : 'Salvar contato'}
        </Button>
        <Button variant="ghost" disabled={enviando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
