'use client'

import { useEffect, useRef, useState } from 'react'
import { carregarPlano, criarConta, type ContaContabil } from '@/lib/contabilidade-api'
import { lancarContaAPagar, lancarContaAReceber } from '@/lib/financeiro-api'
import { listarClientes } from '@/lib/clientes-api'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconClose } from '@/components/Icons'
import CampoTag from '@/components/app/CampoTag'
import styles from './financeiro.module.css'
import { reaisDoTexto } from '@/lib/valor'

/**
 * Lancamento de titulo, a pagar ou a receber — NR-074, RF-055, RF-065.
 *
 * As duas telas compartilham este formulario porque a estrutura e quase a
 * mesma — muda a contraparte (fornecedor em texto livre x cliente cadastrado)
 * e se ha plano de conta.
 *
 * Tres campos do mock NAO TEM ONDE IR no schema real, e saem daqui: banco
 * (e dado de BAIXA — `bankAccount` — nunca de lancamento), emissao (so
 * `dueDate` existe; nao ha coluna para data de emissao separada) e tipo de
 * recebimento (forma de pagamento tambem e fato da baixa, `method`). Coleta-los
 * e descarta-los era o proprio defeito que esta tela tinha.
 */
export default function FormularioTitulo({
  tipo,
  contrapartesConhecidas,
  onSalvo,
  onCancelar,
}: {
  tipo: 'pagar' | 'receber'
  /** Nomes de quem ja apareceu na lista — sugestao real, e nao inventada. */
  contrapartesConhecidas: string[]
  onSalvo: (mensagem: string) => void
  onCancelar: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const [plano, setPlano] = useState('')
  /** Fornecedor: texto livre (nao ha cadastro). Cliente: id de verdade. */
  const [fornecedor, setFornecedor] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')

  const [fornecedores, setFornecedores] = useState(contrapartesConhecidas)
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([])

  /*
   * O plano de conta e o plano de contas DE VERDADE (`GET /contas-contabeis`).
   * `CampoTag` so conhece nome (string); resolver para `accountId` acontece
   * no envio (`contaPeloNome`), e nao aqui — criar a conta so quando o
   * formulario for de fato enviado evita sobrar uma conta vazia se a pessoa
   * desistir no meio do preenchimento.
   */
  const [contas, setContas] = useState<ContaContabil[]>([])
  /* Nomes digitados nesta sessao que ainda nao existem de verdade — so para a
     sugestao reaparecer se a pessoa abrir o campo de novo. */
  const [planosNovos, setPlanosNovos] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      if (tipo === 'pagar') {
        const r = await carregarPlano()
        if (r.ok) {
          setContas(r.dados.accounts.filter((c) => c.type === 'cost' || c.type === 'expense'))
        }
        return
      }

      const r = await listarClientes({})
      if (r.ok) setClientes(r.dados.clientes.map((c) => ({ id: c.id, nome: c.nome })))
    })()
  }, [tipo])

  const [erros, setErros] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !salvando) onCancelar()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onCancelar, salvando])

  /**
   * O id da conta pelo NOME digitado — criando de verdade se o nome nao bate
   * com nenhuma conta existente.
   */
  async function contaPeloNome(nome: string): Promise<{ ok: true; id: string } | { ok: false }> {
    const existente = contas.find((c) => c.name.toLowerCase() === nome.trim().toLowerCase())
    if (existente) return { ok: true, id: existente.id }

    const criada = await criarConta({ name: nome.trim(), type: 'expense' })
    return criada.ok ? { ok: true, id: criada.dados.id } : { ok: false }
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault()

    const novos: Record<string, string> = {}
    if (tipo === 'pagar') {
      if (!fornecedor) novos.contraparte = 'Escolha o fornecedor.'
      if (!plano) novos.plano = 'Escolha o plano de conta.'
    }
    if (!vencimento) novos.vencimento = 'Informe a data de vencimento.'
    if (reaisDoTexto(valor) <= 0) novos.valor = 'Informe um valor maior que zero.'
    if (!descricao.trim()) {
      novos.descricao = tipo === 'pagar' ? 'Descreva o que é.' : 'Informe a que se refere.'
    }

    setErros(novos)
    if (Object.keys(novos).length > 0) return

    setSalvando(true)

    if (tipo === 'pagar') {
      const conta = await contaPeloNome(plano)
      if (!conta.ok) {
        setSalvando(false)
        setErros({ geral: 'Não foi possível gravar o plano de conta. Tente de novo.' })
        return
      }

      const r = await lancarContaAPagar({
        supplier: fornecedor.trim(),
        description: descricao.trim(),
        amountCents: Math.round(reaisDoTexto(valor) * 100),
        dueDate: vencimento,
        accountId: conta.id,
      })
      setSalvando(false)

      if (!r.ok) {
        setErros({ geral: r.erro })
        return
      }

      onSalvo('Conta a pagar lançada.')
      return
    }

    const r = await lancarContaAReceber({
      description: descricao.trim(),
      amountCents: Math.round(reaisDoTexto(valor) * 100),
      dueDate: vencimento,
      ...(clienteId === '' ? {} : { customerId: clienteId }),
    })
    setSalvando(false)

    if (!r.ok) {
      setErros({ geral: r.erro })
      return
    }

    onSalvo('Conta a receber lançada.')
  }

  const erroDe = (campo: string) =>
    erros[campo] ? (
      <span className={styles.campoErro} role="alert">
        {erros[campo]}
      </span>
    ) : null

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !salvando && onCancelar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={`${styles.dialogPainel} ${styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-form"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="titulo-form" className={styles.dialogTitulo}>
            {tipo === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber'}
          </h2>
          <button
            type="button"
            className={styles.dialogFechar}
            onClick={onCancelar}
            disabled={salvando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <form onSubmit={salvar} noValidate className={styles.formCampos}>
          {tipo === 'pagar' ? (
            <div className={styles.formLinha}>
              <label className={styles.campo}>
                <span>Fornecedor</span>
                <CampoTag
                  valor={fornecedor}
                  opcoes={fornecedores}
                  onChange={setFornecedor}
                  onCriar={(novo) => setFornecedores((f) => [...f, novo])}
                  ariaLabel="Fornecedor"
                  invalido={Boolean(erros.contraparte)}
                />
                {erroDe('contraparte')}
              </label>

              <label className={styles.campo}>
                <span>Plano de conta</span>
                <CampoTag
                  valor={plano}
                  opcoes={[...contas.map((c) => c.name), ...planosNovos]}
                  onChange={setPlano}
                  onCriar={(novo) => setPlanosNovos((p) => [...p, novo])}
                  ariaLabel="Plano de conta"
                  invalido={Boolean(erros.plano)}
                />
                {erroDe('plano')}
              </label>
            </div>
          ) : (
            <label className={styles.campo}>
              <span>Cliente</span>
              <select
                className={styles.input}
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                aria-label="Cliente"
              >
                <option value="">Sem cliente identificado</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>Data de vencimento</span>
              <input
                type="date"
                className={styles.input}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                aria-invalid={Boolean(erros.vencimento)}
              />
              {erroDe('vencimento')}
            </label>

            <label className={styles.campo}>
              <span>Valor</span>
              <input
                className={styles.input}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                aria-invalid={Boolean(erros.valor)}
              />
              {erroDe('valor')}
            </label>
          </div>

          <label className={styles.campo}>
            <span>{tipo === 'pagar' ? 'O que e' : 'Referente a'}</span>
            <input
              className={styles.input}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={
                tipo === 'pagar' ? 'Pedido 4471, aluguel de agosto...' : 'Aluguel, empréstimo...'
              }
              aria-invalid={Boolean(erros.descricao)}
            />
            {erroDe('descricao')}
          </label>

          {erros.geral ? (
            <p className={styles.baixaErro} role="alert">
              {erros.geral}
            </p>
          ) : null}

          <div className={styles.dialogAcoes}>
            <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? (
                <>
                  <Spinner size={15} />
                  Salvando...
                </>
              ) : (
                'Lançar título'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
