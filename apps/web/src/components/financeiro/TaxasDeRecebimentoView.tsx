'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { carregarPerfil } from '@/lib/perfil-api'
import { formatDate } from '@/lib/format'
import {
  BANDEIRAS,
  formularioDe,
  lerTaxasDeRecebimento,
  PARCELAS_DA_TABELA,
  salvarTaxasDeRecebimento,
  taxasDoFormulario,
  type FormularioDeTaxas,
  type TabelaDeTaxas,
} from '@/lib/taxas-api'
import {
  Card,
  Checkbox,
  EmptyState,
  Field,
  FormGrid,
  Input,
  PageHeader,
  Select,
} from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './financeiro.module.css'

type Excecao = FormularioDeTaxas['excecoes'][number]

/**
 * Taxas de recebimento da loja — DEC-027 (NR-224).
 *
 * O que a maquininha cobra em cada forma e em quantos dias o dinheiro cai. A
 * venda grava a taxa calculada com ESTA tabela, e o contas a receber nasce
 * liquido; mudar aqui vale para as proximas vendas, nao refaz as antigas.
 *
 * Todo mundo da loja le (o PDV mostra o liquido com ela); so o responsavel
 * altera — a mesma regra do servidor, repetida aqui para nao oferecer um
 * botao que responderia 403.
 */
export default function TaxasDeRecebimentoView() {
  const [tabela, setTabela] = useState<TabelaDeTaxas | null>(null)
  const [form, setForm] = useState<FormularioDeTaxas | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [responsavel, setResponsavel] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  useEffect(() => {
    void (async () => {
      const [r, perfil] = await Promise.all([lerTaxasDeRecebimento(), carregarPerfil()])
      if (r.ok) {
        setTabela(r.dados)
        setForm(formularioDe(r.dados))
      } else setErro(r.erro)
      setResponsavel(perfil.ok && perfil.dados.role === 'owner')
    })()
  }, [])

  const mudar = (parte: Partial<FormularioDeTaxas>) => setForm((f) => (f ? { ...f, ...parte } : f))

  function mudarCredito(i: number, valor: string) {
    setForm((f) => (f ? { ...f, credito: f.credito.map((v, j) => (j === i ? valor : v)) } : f))
  }

  function mudarExcecao(i: number, parte: Partial<Excecao>) {
    setForm((f) =>
      f ? { ...f, excecoes: f.excecoes.map((e, j) => (j === i ? { ...e, ...parte } : e)) } : f,
    )
  }

  function adicionarExcecao() {
    setForm((f) =>
      f
        ? {
            ...f,
            excecoes: [...f.excecoes, { bandeira: 'amex', forma: 'credit', parcelas: 1, taxa: '' }],
          }
        : f,
    )
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (form === null) return
    const montado = taxasDoFormulario(form)
    if (!montado.ok) {
      setToast({ msg: montado.erro, tone: 'error' })
      return
    }
    setSalvando(true)
    const r = await salvarTaxasDeRecebimento(montado.dados)
    setSalvando(false)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setTabela(r.dados)
    setForm(formularioDe(r.dados))
    setToast({ msg: 'Taxas salvas. Valem para as próximas vendas.', tone: 'success' })
  }

  const travado = !responsavel || salvando

  return (
    <>
      <PageHeader
        title="Taxas de recebimento"
        subtitle="O que a maquininha cobra em cada forma de pagamento e em quantos dias o dinheiro cai. A venda grava o valor líquido com estas taxas."
      />

      {erro ? (
        <Card>
          <EmptyState title="Não deu para carregar" description={erro} />
        </Card>
      ) : form === null || tabela === null ? (
        <Card>
          <EmptyState title="Carregando..." />
        </Card>
      ) : (
        <form onSubmit={salvar} noValidate aria-label="Taxas de recebimento">
          <p className={styles.taxasAviso} role="status">
            {tabela.isDefault
              ? 'Estes são os valores padrão: a loja ainda não configurou as suas taxas. Confira com o contrato da sua maquininha e salve.'
              : `Taxas da loja, salvas em ${formatDate(tabela.updatedAt!.slice(0, 10))}. Mudar aqui vale para as próximas vendas; as já feitas continuam como foram gravadas.`}
            {responsavel ? '' : ' Somente o responsável pela loja altera as taxas.'}
          </p>

          <Card title="Pix e débito">
            <FormGrid>
              <Field label="Pix (%)" span={4} htmlFor="taxa-pix">
                <Input
                  id="taxa-pix"
                  value={form.pix}
                  onChange={(e) => mudar({ pix: e.target.value })}
                  inputMode="decimal"
                  disabled={travado}
                />
              </Field>
              <Field label="Débito (%)" span={4} htmlFor="taxa-debito">
                <Input
                  id="taxa-debito"
                  value={form.debito}
                  onChange={(e) => mudar({ debito: e.target.value })}
                  inputMode="decimal"
                  disabled={travado}
                />
              </Field>
              <Field label="Débito cai em (dias)" span={4} htmlFor="dias-debito">
                <Input
                  id="dias-debito"
                  value={form.diasDebito}
                  onChange={(e) => mudar({ diasDebito: e.target.value })}
                  inputMode="numeric"
                  disabled={travado}
                />
              </Field>
            </FormGrid>
          </Card>

          <Card title="Crédito por número de parcelas">
            <p className={styles.taxasAjuda}>
              Deixe em branco as parcelas que a loja não oferece: o caixa só mostra as que têm taxa.
            </p>
            <div className={styles.taxasParcelas}>
              {Array.from({ length: PARCELAS_DA_TABELA }, (_, i) => (
                <Field
                  key={i}
                  label={i === 0 ? 'À vista (%)' : `${i + 1}x (%)`}
                  span={12}
                  htmlFor={`taxa-credito-${i + 1}`}
                >
                  <Input
                    id={`taxa-credito-${i + 1}`}
                    value={form.credito[i] ?? ''}
                    onChange={(e) => mudarCredito(i, e.target.value)}
                    inputMode="decimal"
                    disabled={travado}
                  />
                </Field>
              ))}
            </div>
            <FormGrid>
              <Field
                label="1ª parcela cai em (dias)"
                span={4}
                htmlFor="dias-credito"
                hint="as seguintes, a cada mês"
              >
                <Input
                  id="dias-credito"
                  value={form.diasCredito}
                  onChange={(e) => mudar({ diasCredito: e.target.value })}
                  inputMode="numeric"
                  disabled={travado}
                />
              </Field>
            </FormGrid>
          </Card>

          <Card
            title="Bandeira com taxa diferente"
            action={
              responsavel ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={adicionarExcecao}
                  disabled={salvando}
                >
                  Adicionar bandeira
                </Button>
              ) : null
            }
          >
            {form.excecoes.length === 0 ? (
              <p className={styles.taxasAjuda}>
                Nenhuma: todas as bandeiras usam as taxas acima. Use quando o contrato cobra
                diferente de uma bandeira (por exemplo, Amex).
              </p>
            ) : (
              <ul className={styles.taxasExcecoes}>
                {form.excecoes.map((ex, i) => (
                  <li key={i} className={styles.taxasExcecao}>
                    <Field label="Bandeira" span={12} htmlFor={`excecao-bandeira-${i}`}>
                      <Select
                        id={`excecao-bandeira-${i}`}
                        value={ex.bandeira}
                        onChange={(e) =>
                          mudarExcecao(i, { bandeira: e.target.value as Excecao['bandeira'] })
                        }
                        disabled={travado}
                      >
                        {BANDEIRAS.map((b) => (
                          <option key={b.valor} value={b.valor}>
                            {b.rotulo}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Forma" span={12} htmlFor={`excecao-forma-${i}`}>
                      <Select
                        id={`excecao-forma-${i}`}
                        value={ex.forma}
                        onChange={(e) =>
                          mudarExcecao(i, {
                            forma: e.target.value as Excecao['forma'],
                            parcelas: 1,
                          })
                        }
                        disabled={travado}
                      >
                        <option value="credit">Crédito</option>
                        <option value="debit">Débito</option>
                      </Select>
                    </Field>
                    <Field label="Parcelas" span={12} htmlFor={`excecao-parcelas-${i}`}>
                      <Select
                        id={`excecao-parcelas-${i}`}
                        value={ex.parcelas}
                        onChange={(e) => mudarExcecao(i, { parcelas: Number(e.target.value) })}
                        disabled={travado || ex.forma === 'debit'}
                      >
                        {Array.from({ length: PARCELAS_DA_TABELA }, (_, n) => n + 1).map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? 'À vista' : `${n}x`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Taxa (%)" span={12} htmlFor={`excecao-taxa-${i}`}>
                      <Input
                        id={`excecao-taxa-${i}`}
                        value={ex.taxa}
                        onChange={(e) => mudarExcecao(i, { taxa: e.target.value })}
                        inputMode="decimal"
                        disabled={travado}
                      />
                    </Field>
                    {responsavel ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => mudar({ excecoes: form.excecoes.filter((_, j) => j !== i) })}
                        disabled={salvando}
                        aria-label={`Remover a exceção ${i + 1}`}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Antecipação">
            <p className={styles.taxasAjuda}>
              Por enquanto só guarda o parâmetro: nenhum recebível é antecipado e nenhum vencimento
              muda.
            </p>
            <FormGrid>
              <Field label="Taxa mensal (%)" span={4} htmlFor="taxa-antecipacao">
                <Input
                  id="taxa-antecipacao"
                  value={form.taxaAntecipacao}
                  onChange={(e) => mudar({ taxaAntecipacao: e.target.value })}
                  inputMode="decimal"
                  placeholder="em branco"
                  disabled={travado}
                />
              </Field>
              <Field label="Usar antecipação" span={8}>
                <Checkbox
                  label="A loja antecipa os recebíveis do cartão"
                  checked={form.antecipacao}
                  onChange={(e) => mudar({ antecipacao: e.target.checked })}
                  disabled={travado}
                />
              </Field>
            </FormGrid>
          </Card>

          {responsavel ? (
            <div className={styles.contaAcoes}>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar taxas'}
              </Button>
            </div>
          ) : null}
        </form>
      )}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
