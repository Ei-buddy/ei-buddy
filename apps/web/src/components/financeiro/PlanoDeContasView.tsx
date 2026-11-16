'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarCustosFixos,
  criarCustoFixo,
  type CustoFixo,
  type DadosCustoFixo,
  editarCustoFixo,
  excluirCustoFixo,
  gerarContasDeCustosFixos,
} from '@/lib/financeiro-api'
import {
  apagarConta,
  carregarPlano,
  type ContaContabil,
  criarConta,
  type FiltroDoPlano,
  type OrdemDoPlano,
  planoNaTela,
  ROTULO_DO_TIPO,
  type TipoDeConta,
} from '@/lib/contabilidade-api'
import { formatDate, formatMoney, hoje } from '@/lib/format'
import {
  anoEMes,
  anosDoSeletor,
  competencia,
  competenciaPorExtenso,
  NOMES_DOS_MESES,
  primeiroMesDoAno,
  vencimentoNoMes,
} from '@/lib/competencia'
import { useDialogo } from '@/components/app/useDialogo'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconCalendar, IconPlus, IconTrash } from '@/components/Icons'
import { COMANDOS_PLANO_CONTAS } from '@/lib/comandos'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import CustosVariaveis from './CustosVariaveis'
import styles from './financeiro.module.css'
import { reaisDoTexto } from '@/lib/valor'

export default function PlanoDeContasView() {
  const [contas, setContas] = useState<ContaContabil[]>([])
  const [carregandoPlano, setCarregandoPlano] = useState(true)
  const [erroPlano, setErroPlano] = useState<string | null>(null)

  const [custos, setCustos] = useState<CustoFixo[]>([])
  const [carregandoCustos, setCarregandoCustos] = useState(true)
  const [erroCustos, setErroCustos] = useState<string | null>(null)

  const [novoNome, setNovoNome] = useState('')
  const [novoTipo, setNovoTipo] = useState<TipoDeConta>('expense')
  const [salvandoPlano, setSalvandoPlano] = useState(false)
  const [apagando, setApagando] = useState<ContaContabil | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<FiltroDoPlano>('todos')
  const [ordemPlano, setOrdemPlano] = useState<OrdemDoPlano>('tipo')
  const contasNaTela = planoNaTela(contas, filtroTipo, ordemPlano)

  const [editando, setEditando] = useState<CustoFixo | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [excluindo, setExcluindo] = useState<CustoFixo | null>(null)
  const [gerando, setGerando] = useState(false)
  const [gerarAberto, setGerarAberto] = useState(false)
  const [processando, setProcessando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const buscarPlano = useCallback(async () => {
    const r = await carregarPlano()
    setCarregandoPlano(false)

    if (!r.ok) {
      setErroPlano(r.erro)
      return
    }

    setErroPlano(null)
    setContas(r.dados.accounts)
  }, [])

  const buscarCustos = useCallback(async () => {
    const r = await carregarCustosFixos()
    setCarregandoCustos(false)

    if (!r.ok) {
      setErroCustos(r.erro)
      return
    }

    setErroCustos(null)
    setCustos(r.dados)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await. */
    void (async () => {
      await Promise.all([buscarPlano(), buscarCustos()])
    })()
  }, [buscarPlano, buscarCustos])

  const totalCustosFixos = custos.reduce((acc, c) => acc + c.valorCents, 0) / 100

  /* ---------------------------------------------------------------- *
   * Plano de conta
   * ---------------------------------------------------------------- */

  async function criarPlano(event: React.FormEvent) {
    event.preventDefault()

    setSalvandoPlano(true)
    const r = await criarConta({ name: novoNome.trim(), type: novoTipo })
    setSalvandoPlano(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    /* Recarrega em vez de empurrar na lista: a ORDEM e do servidor (receita,
       deducao, custo, despesa) e reproduzi-la aqui daria um segundo lugar para
       ela mudar de ideia. */
    setNovoNome('')
    await buscarPlano()
    setToast({ msg: 'Conta criada.', tone: 'success' })
  }

  /* Nome proprio: `confirmarExclusao` ja e a de custos fixos, logo abaixo.
     Duas funcoes com o mesmo nome no mesmo escopo compilam ate o TypeScript
     reclamar — e em JavaScript puro a segunda simplesmente vence. */
  async function confirmarExclusaoDeConta() {
    if (apagando === null) return

    setProcessando(true)
    const r = await apagarConta(apagando.id)
    setProcessando(false)
    setApagando(null)

    if (!r.ok) {
      /* A recusa da RF-082 chega com o NUMERO de lancamentos na mensagem —
         "esta conta tem 42 lancamentos" diz que ele ia mexer em coisa seria. */
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    await buscarPlano()
    setToast({ msg: 'Conta apagada.', tone: 'success' })
  }

  /* ---------------------------------------------------------------- *
   * Custos fixos
   * ---------------------------------------------------------------- */

  async function confirmarExclusao() {
    if (!excluindo) return

    setProcessando(true)
    const r = await excluirCustoFixo(excluindo.id)
    setProcessando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    setCustos((c) => c.filter((x) => x.id !== excluindo.id))
    setExcluindo(null)
    setToast({ msg: 'Custo fixo excluido.', tone: 'success' })
  }

  /**
   * Gera as contas a pagar no mes e ano escolhidos — achado do QA: "perguntar
   * para qual mes e ano". A janela vem com o mes atual marcado.
   */
  async function gerarContas(competenciaEscolhida: string) {
    setGerando(true)
    const r = await gerarContasDeCustosFixos(competenciaEscolhida)
    setGerando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    setGerarAberto(false)
    const quando = competenciaPorExtenso(competenciaEscolhida)
    setToast({
      msg:
        r.dados.jaExistiam > 0
          ? `${r.dados.geradas} conta(s) gerada(s) para ${quando}. ${r.dados.jaExistiam} já existiam nesse mês e foram puladas.`
          : `${r.dados.geradas} conta(s) a pagar gerada(s) para ${quando}.`,
      tone: 'success',
    })
  }

  return (
    <>
      <PageHeader
        title="Plano de contas"
        subtitle="Estrutura de receitas e despesas, e custos fixos e variáveis do negócio"
        actions={
          <Button onClick={() => setGerarAberto(true)} disabled={gerando || custos.length === 0}>
            {gerando ? (
              <>
                <Spinner size={15} />
                Gerando...
              </>
            ) : (
              <>
                <IconCalendar size={16} />
                Gerar contas a pagar
              </>
            )}
          </Button>
        }
      />

      <div className="statRow">
        <Stat label="Contas no plano" value={String(contas.length)} />
        <Stat
          label="Custos fixos"
          value={String(custos.length)}
          hint={formatMoney(totalCustosFixos) + ' por mes'}
        />
        {/* O gasto por conta mora no DRE, que soma o periodo escolhido. Repetir
            um "gasto no mes" aqui daria dois numeros para a mesma pergunta, e
            eles divergiriam no primeiro dia em que os periodos nao batessem. */}
        <Stat
          label="Contas de despesa"
          value={String(contas.filter((c) => c.type === 'expense').length)}
          hint="o resultado do período está no DRE"
        />
      </div>

      <div className={styles.duasColunas}>
        {/* --- Planos --- */}
        <Card title="Plano de contas">
          {/* QA: "Plano de contas — como cadastrar um?". A tela dizia so
              "Nome da conta"; o tipo e o que decide onde ela cai no DRE. */}
          <p className={styles.novoPlanoAjuda}>
            Para criar uma conta, digite o nome (ex.: Aluguel, Embalagens), escolha o tipo e toque
            em Criar. O tipo decide onde ela entra no DRE: receita soma, dedução, custo e despesa
            diminuem o resultado. Depois, use a conta nas contas a pagar e a receber.
          </p>
          <form onSubmit={criarPlano} className={styles.novoPlano}>
            <input
              className={styles.input}
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome da conta (ex.: Aluguel)"
              aria-label="Nome da conta"
              maxLength={80}
            />
            <select
              className={styles.input}
              value={novoTipo}
              onChange={(e) => setNovoTipo(e.target.value as TipoDeConta)}
              aria-label="Tipo da conta"
            >
              {/* Os quatro tipos, sempre. O tipo decide de que lado do DRE a
                  conta entra, e nao ha padrao seguro: uma receita cadastrada
                  como despesa inverte o resultado do mes. */}
              {(Object.keys(ROTULO_DO_TIPO) as TipoDeConta[]).map((t) => (
                <option key={t} value={t}>
                  {ROTULO_DO_TIPO[t]}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={salvandoPlano || novoNome.trim().length < 2}>
              {salvandoPlano ? <Spinner size={15} /> : <IconPlus size={16} />}
              Criar
            </Button>
          </form>

          {carregandoPlano ? (
            <SkeletonLinhas />
          ) : erroPlano !== null ? (
            <EmptyState
              title="Não deu para carregar o plano"
              description={erroPlano}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCarregandoPlano(true)
                    setErroPlano(null)
                    void buscarPlano()
                  }}
                >
                  Tentar de novo
                </Button>
              }
            />
          ) : (
            <>
              {/* Filtrar por tipo e ordenar por nome — achado do QA. */}
              <div className={styles.planoFerramentas}>
                <div className={styles.filtrosLinha} role="group" aria-label="Filtrar por tipo">
                  {(['todos', ...(Object.keys(ROTULO_DO_TIPO) as TipoDeConta[])] as const).map(
                    (t) => (
                      <button
                        key={t}
                        type="button"
                        className={`${styles.filtro} ${filtroTipo === t ? styles.filtroAtivo : ''}`}
                        onClick={() => setFiltroTipo(t)}
                        aria-pressed={filtroTipo === t}
                      >
                        {t === 'todos' ? 'Todos' : ROTULO_DO_TIPO[t]}{' '}
                        <span className={styles.filtroContagem}>
                          {t === 'todos'
                            ? contas.length
                            : contas.filter((c) => c.type === t).length}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <label className={styles.planoOrdem}>
                  <span>Ordenar</span>
                  <select
                    className={styles.input}
                    value={ordemPlano}
                    onChange={(e) => setOrdemPlano(e.target.value as OrdemDoPlano)}
                    aria-label="Ordenar o plano de contas"
                  >
                    <option value="tipo">Por tipo (ordem do DRE)</option>
                    <option value="nome">Nome (A–Z)</option>
                    <option value="nome-desc">Nome (Z–A)</option>
                  </select>
                </label>
              </div>
              {contasNaTela.length === 0 ? (
                <p className={styles.planoVazio}>
                  Nenhuma conta do tipo{' '}
                  {filtroTipo === 'todos' ? '' : ROTULO_DO_TIPO[filtroTipo].toLowerCase()} ainda.
                </p>
              ) : null}
              <ul className={styles.planos} aria-label="Contas do plano">
                {contasNaTela.map((c) => (
                  <li key={c.id} className={styles.plano}>
                    <span className={styles.planoNome}>
                      <strong>{c.name}</strong>
                      <Badge tone={c.type === 'revenue' ? 'success' : 'neutral'}>
                        {ROTULO_DO_TIPO[c.type]}
                      </Badge>
                    </span>
                    {/* Conta do plano padrao nao tem botao de apagar — RF-081.
                      Mostra-lo e deixar a api recusar seria oferecer uma acao
                      que nunca funciona. */}
                    {c.isDefault ? (
                      <span className={styles.planoValor}>padrão</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.custoExcluir}
                        onClick={() => setApagando(c)}
                        aria-label={`Apagar ${c.name}`}
                      >
                        <IconTrash size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* --- Custos fixos --- */}
        <Card
          title="Custos fixos"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditando(null)
                setFormAberto(true)
              }}
            >
              <IconPlus size={14} />
              Novo
            </Button>
          }
        >
          {carregandoCustos ? (
            <SkeletonLinhas />
          ) : erroCustos !== null ? (
            <EmptyState
              title="Não deu para carregar os custos fixos"
              description={erroCustos}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCarregandoCustos(true)
                    setErroCustos(null)
                    void buscarCustos()
                  }}
                >
                  Tentar de novo
                </Button>
              }
            />
          ) : custos.length === 0 ? (
            <EmptyState
              title="Nenhum custo fixo"
              description="Cadastre aluguel, energia, contabilidade — o que se repete todo mês. Depois dá para gerar as contas a pagar de uma vez."
              mascote
              action={
                <Button onClick={() => setFormAberto(true)}>
                  <IconPlus size={16} />
                  Cadastrar custo fixo
                </Button>
              }
            />
          ) : (
            <ul className={styles.custos}>
              {custos.map((c) => (
                <li key={c.id} className={styles.custo}>
                  <span className={styles.custoDia}>dia {c.diaVencimento}</span>

                  <span className={styles.custoPrincipal}>
                    <strong>{c.nome}</strong>
                    <span>{c.planoContasNome ?? 'Sem classificação'}</span>
                  </span>

                  <span className={styles.custoValor}>{formatMoney(c.valorCents / 100)}</span>

                  <span className={styles.custoAcoes}>
                    <button
                      type="button"
                      className={styles.custoBotao}
                      onClick={() => {
                        setEditando(c)
                        setFormAberto(true)
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={`${styles.custoBotao} ${styles.custoExcluir}`}
                      onClick={() => setExcluindo(c)}
                      aria-label={`Excluir ${c.nome}`}
                    >
                      <IconTrash size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <CustosVariaveis />
      </div>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={COMANDOS_PLANO_CONTAS} />
      </div>

      {formAberto ? (
        <FormCustoFixo
          custo={editando}
          contas={contas}
          onSalvo={(salvo, continuar) => {
            setCustos((atual) =>
              editando ? atual.map((c) => (c.id === salvo.id ? salvo : c)) : [...atual, salvo],
            )
            /* Cadastro em sequencia — achado do QA: a janela fica aberta, limpa,
               para o proximo. O aviso vem dentro dela. */
            if (continuar) return
            setFormAberto(false)
            setEditando(null)
            setToast({
              msg: editando ? 'Custo fixo atualizado.' : 'Custo fixo cadastrado.',
              tone: 'success',
            })
          }}
          onCancelar={() => {
            setFormAberto(false)
            setEditando(null)
          }}
        />
      ) : null}

      {gerarAberto ? (
        <GerarContasDialog
          custos={custos}
          gerando={gerando}
          onGerar={(c) => void gerarContas(c)}
          onCancelar={() => setGerarAberto(false)}
        />
      ) : null}

      {apagando !== null ? (
        <ConfirmarDialog
          titulo="Apagar esta conta?"
          descricao={`"${apagando.name}" sai do plano. Se ela tiver lançamentos, a operação é recusada — o histórico não muda de classificação sozinho.`}
          rotuloConfirmar="Apagar"
          tom="perigo"
          processando={processando}
          onConfirmar={() => void confirmarExclusaoDeConta()}
          onCancelar={() => setApagando(null)}
        />
      ) : null}

      {excluindo ? (
        <ConfirmarDialog
          titulo="Excluir custo fixo"
          descricao="O custo deixa de gerar contas a pagar nos próximos meses. Contas já lançadas continuam como estão."
          tom="perigo"
          rotuloConfirmar="Excluir"
          processando={processando}
          detalhe={
            <div className={styles.estornoDetalhe}>
              <strong>{excluindo.nome}</strong>
              <span>
                {formatMoney(excluindo.valorCents / 100)} · todo dia {excluindo.diaVencimento}
              </span>
            </div>
          }
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Formulario de custo fixo
 * ================================================================== */

function FormCustoFixo({
  custo,
  contas,
  onSalvo,
  onCancelar,
}: {
  custo: CustoFixo | null
  /** O plano de contas DE VERDADE, ja carregado pela tela. */
  contas: ContaContabil[]
  /** `continuar`: cadastro em sequencia, a janela fica aberta. */
  onSalvo: (custo: CustoFixo, continuar: boolean) => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(custo?.nome ?? '')
  /* Novo custo ja vem com "continuar" marcado: quem abre o cadastro costuma
     ter varios para lancar (aluguel, energia, internet, contador...). */
  const [continuar, setContinuar] = useState(custo === null)
  const [ultimoSalvo, setUltimoSalvo] = useState<string | null>(null)
  const nomeRef = useRef<HTMLInputElement>(null)
  /* Plano de contas em ordem alfabetica — achado do QA. */
  const contasEmOrdem = planoNaTela(contas, 'todos', 'nome')
  const [dia, setDia] = useState(String(custo?.diaVencimento ?? ''))
  const [valor, setValor] = useState(custo ? String(custo.valorCents / 100).replace('.', ',') : '')
  const [contaId, setContaId] = useState(custo?.planoContasId ?? '')

  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)
    setSalvando(true)

    const dados: DadosCustoFixo = {
      nome,
      diaVencimento: Number(dia),
      valorCents: Math.round(reaisDoTexto(valor) * 100),
      planoContasId: contaId === '' ? null : contaId,
    }

    const r = custo ? await editarCustoFixo(custo.id, dados) : await criarCustoFixo(dados)
    setSalvando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    const seguir = custo === null && continuar
    onSalvo(r.dados, seguir)
    if (seguir) {
      setUltimoSalvo(r.dados.nome)
      setNome('')
      setDia('')
      setValor('')
      setContaId('')
      nomeRef.current?.focus()
    }
  }

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={onCancelar}
        aria-label="Fechar"
      />

      <div
        className={`${styles.dialogPainel} ${styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
      >
        <header className={styles.dialogCabecalho}>
          <h2 className={styles.dialogTitulo}>{custo ? 'Editar custo fixo' : 'Novo custo fixo'}</h2>
        </header>

        <form onSubmit={salvar} noValidate className={styles.formCampos}>
          <label className={styles.campo}>
            <span>Nome</span>
            <input
              className={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Aluguel do ponto"
              autoFocus
              ref={nomeRef}
            />
          </label>

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>Dia do vencimento</span>
              <input
                className={styles.input}
                value={dia}
                onChange={(e) => setDia(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="5"
                inputMode="numeric"
              />
            </label>

            <label className={styles.campo}>
              <span>Valor</span>
              <input
                className={styles.input}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </label>
          </div>

          <label className={styles.campo}>
            <span>Plano de conta</span>
            <select
              className={styles.input}
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              aria-label="Plano de conta"
            >
              <option value="">Sem classificação</option>
              {contasEmOrdem.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {custo === null ? (
            <label className={styles.continuar}>
              <input
                type="checkbox"
                checked={continuar}
                onChange={(e) => setContinuar(e.target.checked)}
              />
              Continuar cadastrando depois de salvar
            </label>
          ) : null}

          {ultimoSalvo !== null ? (
            <p className={styles.salvoNaSequencia} role="status">
              “{ultimoSalvo}” cadastrado. Pode lançar o próximo.
            </p>
          ) : null}

          {erro ? (
            <p className={styles.baixaErro} role="alert">
              {erro}
            </p>
          ) : null}

          <div className={styles.dialogAcoes}>
            <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
              {ultimoSalvo !== null ? 'Fechar' : 'Cancelar'}
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? (
                <>
                  <Spinner size={15} />
                  Salvando...
                </>
              ) : custo === null && continuar ? (
                'Salvar e continuar'
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ================================================================== *
 * Gerar contas a pagar — mes e ano (achado do QA)
 * ================================================================== */

/**
 * "Perguntar para qual mes e ano, trazer os campos preenchidos com os meses e
 * o ano a partir desse, como se fosse um seletor." A janela abre no mes atual;
 * os seletores so oferecem do mes atual em diante, e a previa mostra cada
 * conta com o vencimento daquele mes ANTES de gerar.
 */
function GerarContasDialog({
  custos,
  gerando,
  onGerar,
  onCancelar,
}: {
  custos: CustoFixo[]
  gerando: boolean
  onGerar: (competencia: string) => void
  onCancelar: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogo(ref, onCancelar, gerando)

  const dia = hoje()
  const atual = anoEMes(dia)
  const [ano, setAno] = useState(atual.ano)
  const [mes, setMes] = useState(atual.mes)
  const escolhida = competencia(ano, mes)
  const total = custos.reduce((acc, c) => acc + c.valorCents, 0)

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !gerando && onCancelar()}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div
        ref={ref}
        className={`${styles.dialogPainel} ${styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gerar-titulo"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="gerar-titulo" className={styles.dialogTitulo}>
            Gerar contas a pagar
          </h2>
        </header>

        <p className={styles.gerarAjuda}>
          Escolha o mês: cada custo fixo vira uma conta a pagar com vencimento no dia dele, nesse
          mês. Gerar de novo no mesmo mês não duplica.
        </p>

        <div className={styles.formLinha}>
          <label className={styles.campo}>
            <span>Mês</span>
            <select
              className={styles.input}
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              aria-label="Mês"
            >
              {NOMES_DOS_MESES.map((nome, i) =>
                i + 1 >= primeiroMesDoAno(dia, ano) ? (
                  <option key={nome} value={i + 1}>
                    {nome}
                  </option>
                ) : null,
              )}
            </select>
          </label>
          <label className={styles.campo}>
            <span>Ano</span>
            <select
              className={styles.input}
              value={ano}
              onChange={(e) => {
                const novo = Number(e.target.value)
                setAno(novo)
                /* Voltou para o ano atual com um mes que ja passou: o mes atual. */
                setMes((m) => Math.max(m, primeiroMesDoAno(dia, novo)))
              }}
              aria-label="Ano"
            >
              {anosDoSeletor(dia).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className={styles.gerarPrevia} aria-label="Contas que serão geradas">
          {custos.map((c) => (
            <li key={c.id}>
              <span>{c.nome}</span>
              <span>vence {formatDate(vencimentoNoMes(c.diaVencimento, escolhida))}</span>
              <strong>{formatMoney(c.valorCents / 100)}</strong>
            </li>
          ))}
          <li className={styles.gerarTotal}>
            <span>Total de {competenciaPorExtenso(escolhida)}</span>
            <span />
            <strong>{formatMoney(total / 100)}</strong>
          </li>
        </ul>

        <div className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onCancelar} disabled={gerando}>
            Cancelar
          </Button>
          <Button onClick={() => onGerar(escolhida)} disabled={gerando || custos.length === 0}>
            {gerando ? (
              <>
                <Spinner size={15} />
                Gerando...
              </>
            ) : (
              `Gerar ${custos.length} ${custos.length === 1 ? 'conta' : 'contas'}`
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
