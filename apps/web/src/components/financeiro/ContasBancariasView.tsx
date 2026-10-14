'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  cadastrarContaBancaria,
  editarContaBancaria,
  excluirContaBancaria,
  listarContasBancarias,
  type ContaBancaria,
} from '@/lib/contas-bancarias-api'
import { formatDate, formatMoney } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { Card, EmptyState, Field, FormGrid, Input, PageHeader } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './financeiro.module.css'

const hoje = () => new Date().toISOString().slice(0, 10)

/**
 * Contas bancarias da loja — RF-073, US-035.
 *
 * O saldo de cada conta e o inicial mais as baixas que citam a conta: e isso que
 * a loja confere contra o extrato. Por isso a baixa passa a oferecer estas
 * contas, e nao mais uma lista de bancos qualquer.
 */
export default function ContasBancariasView() {
  const [contas, setContas] = useState<ContaBancaria[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [numero, setNumero] = useState('')
  const [saldo, setSaldo] = useState('')
  const [data, setData] = useState(hoje)
  const [salvando, setSalvando] = useState(false)
  /* Editar usa o mesmo formulario do cadastro — NR-152. */
  const [editando, setEditando] = useState<ContaBancaria | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    const r = await listarContasBancarias()
    if (r.ok) {
      setContas(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem depois do await, nunca sincronos
       no corpo do efeito. */
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function cadastrar(e: FormEvent) {
    e.preventDefault()
    if (nome.trim().length < 2) {
      setToast({ msg: 'Dê um nome à conta, ex.: "Nubank PJ".', tone: 'error' })
      return
    }
    /* Saldo vazio e zero; negativo e permitido (cheque especial). */
    const texto = saldo.trim()
    const negativo = texto.startsWith('-')
    const cents = texto === '' ? 0 : centavosDoTexto(texto.replace(/^-/, ''))
    if (cents === null) {
      setToast({ msg: 'Saldo inicial inválido.', tone: 'error' })
      return
    }

    setSalvando(true)
    const dados = {
      name: nome.trim(),
      ...(banco.trim() ? { bank: banco.trim() } : {}),
      ...(agencia.trim() ? { agency: agencia.trim() } : {}),
      ...(numero.trim() ? { accountNumber: numero.trim() } : {}),
      openingBalanceCents: negativo ? -cents : cents,
      openingDate: data,
    }
    const r =
      editando === null
        ? await cadastrarContaBancaria(dados)
        : await editarContaBancaria(editando.id, dados)
    setSalvando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    limparFormulario()
    setToast({
      msg: editando === null ? `Conta ${r.dados.name} cadastrada.` : `Conta ${r.dados.name} salva.`,
      tone: 'success',
    })
    void carregar()
  }

  function limparFormulario() {
    setEditando(null)
    setNome('')
    setBanco('')
    setAgencia('')
    setNumero('')
    setSaldo('')
    setData(hoje())
  }

  function editar(conta: ContaBancaria) {
    setEditando(conta)
    setNome(conta.name)
    setBanco(conta.bank ?? '')
    setAgencia(conta.agency ?? '')
    setNumero(conta.accountNumber ?? '')
    setSaldo((conta.openingBalanceCents / 100).toFixed(2).replace('.', ','))
    setData(conta.openingDate)
    document.getElementById('conta-nome')?.focus()
  }

  async function excluir(conta: ContaBancaria) {
    if (
      !window.confirm(`Excluir a conta ${conta.name}? As baixas já lançadas continuam como estão.`)
    ) {
      return
    }
    const r = await excluirContaBancaria(conta.id)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    void carregar()
  }

  const total = (contas ?? []).reduce((acc, c) => acc + c.balanceCents, 0)

  return (
    <>
      <PageHeader
        title="Contas bancárias"
        subtitle="Onde o dinheiro da loja está. O saldo é o inicial mais as baixas lançadas em cada conta."
      />

      <Card
        title={
          contas && contas.length > 0 ? `Saldo total: ${formatMoney(total / 100)}` : 'Suas contas'
        }
      >
        {erro ? (
          <EmptyState title="Não deu para carregar" description={erro} />
        ) : contas === null ? (
          <EmptyState title="Carregando..." />
        ) : contas.length === 0 ? (
          <EmptyState
            mascote
            title="Nenhuma conta cadastrada"
            description="Cadastre a conta da loja com o saldo de hoje, e as baixas passam a dizer em qual conta o dinheiro entrou ou saiu."
          />
        ) : (
          <ul className={styles.contasBancarias}>
            {contas.map((c) => (
              <li key={c.id} className={styles.contaBancaria}>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {[
                      c.bank,
                      c.agency && `ag. ${c.agency}`,
                      c.accountNumber && `cc ${c.accountNumber}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Sem dados do banco'}
                    {` · saldo inicial ${formatMoney(c.openingBalanceCents / 100)} em ${formatDate(c.openingDate)}`}
                  </small>
                </span>
                <strong>{formatMoney(c.balanceCents / 100)}</strong>
                <span className={styles.contaBancariaAcoes}>
                  <Button variant="ghost" size="sm" onClick={() => editar(c)}>
                    Editar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void excluir(c)}>
                    Excluir
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={editando === null ? 'Cadastrar conta' : `Editar ${editando.name}`}>
        <form onSubmit={cadastrar} noValidate>
          <FormGrid>
            <Field label="Nome da conta" span={4} htmlFor="conta-nome">
              <Input
                id="conta-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nubank PJ"
                maxLength={60}
              />
            </Field>
            <Field label="Banco" span={4} htmlFor="conta-banco">
              <Input
                id="conta-banco"
                value={banco}
                onChange={(e) => setBanco(e.target.value)}
                placeholder="Nubank"
                maxLength={60}
              />
            </Field>
            <Field label="Agência" span={2} htmlFor="conta-agencia">
              <Input
                id="conta-agencia"
                value={agencia}
                onChange={(e) => setAgencia(e.target.value)}
                maxLength={20}
              />
            </Field>
            <Field label="Conta" span={2} htmlFor="conta-numero">
              <Input
                id="conta-numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                maxLength={30}
              />
            </Field>
            <Field label="Saldo inicial" span={4} htmlFor="conta-saldo" hint="negativo com -">
              <Input
                id="conta-saldo"
                value={saldo}
                onChange={(e) => setSaldo(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Saldo do dia" span={4} htmlFor="conta-data">
              <Input
                id="conta-data"
                type="date"
                value={data}
                max={hoje()}
                onChange={(e) => setData(e.target.value)}
              />
            </Field>
          </FormGrid>
          <div className={styles.contaAcoes}>
            {editando !== null ? (
              <Button variant="ghost" onClick={limparFormulario} disabled={salvando}>
                Cancelar
              </Button>
            ) : null}
            <Button type="submit" disabled={salvando}>
              {salvando
                ? 'Salvando...'
                : editando === null
                  ? 'Cadastrar conta'
                  : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </Card>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
