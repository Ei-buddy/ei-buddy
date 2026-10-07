'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { carregarPlano } from '@/lib/contabilidade-api'
import {
  baixarTitulo,
  carregarContasAPagar,
  carregarContasAReceber,
  type ContaAPagar,
  type ContaAReceber,
  type DadosDaBaixa,
  exportar,
  ROTULO_SITUACAO,
  situacaoDoTitulo,
  type SituacaoVisual,
} from '@/lib/financeiro-api'
import type { StatusTitulo } from '@/lib/types'
import { daysUntil, describeDueDate, formatCentavos, formatDate, formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { IconFilter, IconPlus, IconUpload } from '@/components/Icons'
import { COMANDOS_PAGAR, COMANDOS_RECEBER } from '@/lib/comandos'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import BaixaDialog from './BaixaDialog'
import CorrecaoTitulo from './CorrecaoTitulo'
import EstornoDialog from './EstornoDialog'
import FormularioTitulo from './FormularioTitulo'
import styles from './financeiro.module.css'

/** Forma comum entre conta a pagar e a receber, para a lista trabalhar. */
/**
 * O status da api para o vocabulario da tela.
 *
 * Os dois modelos discordam num ponto que importa: o web trata `vencido` como
 * STATUS, e a api o calcula a partir da data — la e faixa, nao estado. Uma
 * conta vencida continua `open` no servidor.
 *
 * Entao `vencido` sai daqui pela DATA, e nao do campo. Mapear `open` para
 * `aberto` sempre faria a tela perder o destaque de atraso; inventar um status
 * `vencido` no servidor faria a mesma conta mudar de estado a meia-noite sem
 * ninguem tocar nela.
 */
function statusDaApi(status: string, vencimento: string): StatusTitulo {
  if (status === 'settled') return 'pago'
  if (status === 'partially_settled') return 'parcial'
  return daysUntil(vencimento) < 0 ? 'vencido' : 'aberto'
}

function paraLinhaAPagar(c: ContaAPagar, nomeDaConta: (accountId: string | null) => string): Linha {
  return {
    id: c.id,
    contraparte: c.supplier,
    descricao: c.description,
    vencimento: c.dueDate,
    valorCents: c.amountCents,
    valorBaixadoCents: c.settledAmountCents,
    status: statusDaApi(c.status, c.dueDate),
    /* A classificacao e id de conta (NR-077) — o plano vem carregado junto
       com a lista, exatamente para resolver o nome aqui. */
    classificacao: nomeDaConta(c.accountId),
    mutavel: c.settledAmountCents === 0,
  }
}

/**
 * O recebivel da api para a linha da tela — NR-081.
 *
 * Esta conversao nao existia: a tela de contas a receber era alimentada por
 * dado de exemplo, ao lado de uma tela de contas a pagar real.
 *
 * `customerName` nulo e o balcao permitindo venda sem identificar o cliente —
 * nao um dado faltando por erro.
 *
 * A coluna que na tela de pagar mostra o plano de conta aqui mostra a PARCELA,
 * e nao a forma de pagamento: `ReceivableOutput` nao carrega forma, porque ela
 * e fato do pagamento e mora em `payments`. Inventar um rotulo aqui seria a
 * tela afirmando algo que o servidor nao disse.
 */
function paraLinhaAReceber(c: ContaAReceber): Linha {
  return {
    id: c.id,
    contraparte: c.customerName ?? 'Cliente não identificado',
    descricao: c.description,
    vencimento: c.dueDate,
    /* Bruto, e nao `netAmountCents`: e sobre o bruto que a baixa e conferida no
       servidor. Mostrar o liquido e cobrar o bruto daria um saldo que nao fecha
       com o que a confirmacao aceita. */
    valorCents: c.amountCents,
    valorBaixadoCents: c.settledAmountCents,
    status: statusDaApi(c.status, c.dueDate),
    classificacao: c.installmentCount > 1 ? `${c.installmentNumber}/${c.installmentCount}` : '',
    /* O que veio de venda se resolve na venda (cancelar ou devolver). */
    mutavel: c.saleId === null && c.settledAmountCents === 0,
  }
}

/**
 * A linha como a tela precisa dela.
 *
 * Valores em CENTAVOS, e nao em reais. Eram em reais, e a baixa total passaria
 * `saldo * 100` de volta para a api: em ponto flutuante isso deixa um centavo
 * para tras de vez em quando, e um titulo que fica devendo R$ 0,01 depois de
 * quitado nao sai mais da lista de contas em aberto. Os reais aparecem so na
 * formatacao, dividindo por 100 no ponto de exibir.
 */
type Linha = {
  id: string
  contraparte: string
  descricao: string
  vencimento: string
  valorCents: number
  valorBaixadoCents: number
  status: StatusTitulo
  /** Plano de conta (pagar) ou parcela (receber). */
  classificacao: string
  /** Pode corrigir e cancelar — NR-150. Sem baixa e, no a receber, avulso. */
  mutavel: boolean
}

const TOM_SITUACAO: Record<SituacaoVisual, 'neutral' | 'warning' | 'danger' | 'success' | 'info'> =
  {
    aberto: 'neutral',
    aVencer: 'warning',
    vencido: 'danger',
    quitado: 'success',
    parcial: 'info',
  }

type FiltroStatus = 'todos' | 'aberto' | 'vencido' | 'quitado'

export default function ContasView({ tipo }: { tipo: 'pagar' | 'receber' }) {
  const pagar = tipo === 'pagar'

  /*
   * As DUAS listas vem da api — NR-081.
   *
   * Contas a receber estava no mock: a rota `GET /contas-a-receber` existe
   * desde a NR-074 e o web nao a chamava. Ficavam duas telas irmas, uma com
   * dado do banco e outra com dado inventado, sem nada na interface dizendo
   * qual era qual — e o botao de baixa da tela falsa apontando para ids que nao
   * existem no banco.
   */
  const [linhas, setLinhas] = useState<Linha[]>([])
  /* Pago/recebido no mes, calculado no servidor pela data da baixa. */
  const [quitadoNoMes, setQuitadoNoMes] = useState<{ totalCents: number; count: number } | null>(
    null,
  )
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  /*
   * Fora do efeito porque tres caminhos chamam o MESMO carregamento: a
   * montagem, o botao de "tentar de novo" e o retorno de uma baixa ou estorno.
   * Erro de rede que so oferece recarregar a pagina inteira faz o lojista
   * perder os filtros que acabou de montar.
   */
  const carregar = useCallback(async () => {
    /* O servidor ja agrupa e ja soma. A tela achata para a lista que ela
       desenha, mas NAO recalcula total: somar aqui daria um numero que pode
       divergir do relatorio, e "quanto preciso ter em caixa" nao pode ter
       duas respostas. */
    if (pagar) {
      const [r, planos] = await Promise.all([carregarContasAPagar(), carregarPlano()])
      setCarregando(false)
      if (!r.ok) {
        setErroCarga(r.erro)
        return
      }
      setErroCarga(null)
      /* O plano pode falhar (ex.: sessao instavel) sem travar a lista de
         contas — nesse caso a classificacao fica vazia, como antes. */
      const nomes = new Map(planos.ok ? planos.dados.accounts.map((c) => [c.id, c.name]) : [])
      const nomeDaConta = (accountId: string | null) =>
        accountId === null ? '' : (nomes.get(accountId) ?? '')
      setLinhas(
        r.dados.grupos.flatMap((g) => g.payables.map((p) => paraLinhaAPagar(p, nomeDaConta))),
      )
      setQuitadoNoMes(r.dados.settledThisMonth ?? null)
      return
    }

    const r = await carregarContasAReceber()
    setCarregando(false)
    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }
    setErroCarga(null)
    setLinhas(r.dados.grupos.flatMap((g) => g.receivables.map(paraLinhaAReceber)))
    setQuitadoNoMes(r.dados.settledThisMonth ?? null)
  }, [pagar])

  useEffect(() => {
    /* O `async` explicito e para o lint, e o que ele diz e verdade: todo
       `setState` de `carregar` vem DEPOIS do await, nunca sincrono no corpo
       do efeito. Chamada nua, o compilador do React para no nome da funcao e
       supoe o pior. */
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  /*
   * A primeira carga JA comeca com `carregando`; quem precisa religa-lo e a
   * retentativa. Por isso os dois `setState` moram aqui, num onClick, e nao
   * dentro de `carregar` — chamado pelo efeito, `setCarregando(true)` roda
   * sincrono na montagem e provoca um render em cascata (o lint reprova, e com
   * razao: e um render inteiro jogado fora em toda abertura da tela).
   */
  const tentarDeNovo = () => {
    setCarregando(true)
    setErroCarga(null)
    void carregar()
  }

  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos')
  const [filtroClassificacao, setFiltroClassificacao] = useState('')
  const [filtroContraparte, setFiltroContraparte] = useState('')
  const [ate, setAte] = useState('')

  const [lancando, setLancando] = useState(false)
  const [baixando, setBaixando] = useState<Linha | null>(null)
  const [estornando, setEstornando] = useState<Linha | null>(null)
  const [mudando, setMudando] = useState<{ linha: Linha; modo: 'corrigir' | 'cancelar' } | null>(
    null,
  )
  const [processando, setProcessando] = useState(false)
  /* Nao ha `processandoEstorno`: o `EstornoDialog` cuida do proprio ciclo —
     ele carrega o historico, escolhe a baixa e confirma. O que volta para ca e
     so o desfecho. */
  const [erroDialogo, setErroDialogo] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const classificacoes = useMemo(
    () => [...new Set(linhas.map((l) => l.classificacao))].filter(Boolean).sort(),
    [linhas],
  )
  const contrapartes = useMemo(
    () => [...new Set(linhas.map((l) => l.contraparte))].sort(),
    [linhas],
  )

  const filtradas = useMemo(() => {
    return linhas.filter((l) => {
      const dias = daysUntil(l.vencimento)
      const situacao = situacaoDoTitulo(l.status, l.vencimento, dias)

      if (filtroStatus === 'aberto' && (l.status === 'pago' || situacao === 'vencido')) return false
      if (filtroStatus === 'vencido' && situacao !== 'vencido') return false
      if (filtroStatus === 'quitado' && l.status !== 'pago') return false

      if (filtroClassificacao && l.classificacao !== filtroClassificacao) return false
      if (filtroContraparte && l.contraparte !== filtroContraparte) return false

      /* Filtro "ate" olha o vencimento, nao a emissao: quem pergunta
         "o que vence ate sexta" quer o que ainda deve. */
      if (ate && l.vencimento > ate) return false

      return true
    })
  }, [linhas, filtroStatus, filtroClassificacao, filtroContraparte, ate])

  /* --- Indicadores. Somados em CENTAVOS, formatados em reais no fim. --- */
  const emAberto = linhas.filter((l) => l.status !== 'pago')
  const totalAberto = emAberto.reduce((acc, l) => acc + (l.valorCents - l.valorBaixadoCents), 0)
  const vencidos = emAberto.filter((l) => daysUntil(l.vencimento) < 0)
  const totalVencido = vencidos.reduce((acc, l) => acc + (l.valorCents - l.valorBaixadoCents), 0)

  /* ---------------------------------------------------------------- *
   * Baixa e estorno
   * ---------------------------------------------------------------- */

  /**
   * Baixa de verdade — RF-059, RF-066.
   *
   * ## A lista recarrega em vez de ser remendada
   *
   * O que existia aqui atualizava a linha na memoria com o que a propria tela
   * havia calculado. Com um falso respondendo, dava no mesmo; com o servidor
   * respondendo, nao da: quem decide o novo saldo e o novo status e `core`, com
   * o titulo lido DENTRO da transacao. Se outra pessoa baixou o mesmo titulo
   * enquanto este dialogo estava aberto, o remendo mostraria um saldo que nao
   * existe — e a tela ficaria discordando do banco sem nada avisando.
   *
   * Recarregar custa uma ida a mais. Em troca, o que a tela mostra e sempre o
   * que o servidor tem.
   */
  async function confirmarBaixa(dados: DadosDaBaixa) {
    if (!baixando) return

    setProcessando(true)
    setErroDialogo(null)

    const r = await baixarTitulo(tipo, baixando.id, dados)
    setProcessando(false)

    if (!r.ok) {
      /* O erro fica DENTRO do dialogo, e nao num toast: valor acima do saldo e
         conta em branco sao coisas que a pessoa corrige ali mesmo. Fechar o
         dialogo a obrigaria a preencher tudo de novo. */
      setErroDialogo(r.erro)
      return
    }

    const quitou = baixando.valorBaixadoCents + r.dados.amountCents >= baixando.valorCents

    setBaixando(null)
    setToast({
      msg: quitou
        ? `Título quitado: ${formatMoney(r.dados.amountCents / 100)}.`
        : `Baixa parcial de ${formatMoney(r.dados.amountCents / 100)} registrada.`,
      tone: 'success',
    })

    await carregar()
  }

  const [exportando, setExportando] = useState(false)

  async function exportarLista(formato: 'csv' | 'pdf') {
    setExportando(true)
    const r = await exportar(tipo, formato)
    setExportando(false)
    if (!r.ok) setToast({ msg: r.error, tone: 'error' })
  }

  const limparFiltros = () => {
    setFiltroStatus('todos')
    setFiltroClassificacao('')
    setFiltroContraparte('')
    setAte('')
  }

  const rotuloContraparte = pagar ? 'Fornecedor' : 'Cliente'
  const rotuloClassificacao = pagar ? 'Plano de conta' : 'Tipo'

  return (
    <>
      <PageHeader
        title={pagar ? 'Contas a pagar' : 'Contas a receber'}
        subtitle={pagar ? 'Títulos, vencimentos e baixas' : 'Recebíveis, cobrança e baixas'}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={exportando}
              onClick={() => void exportarLista('csv')}
            >
              <IconUpload size={16} />
              CSV
            </Button>
            <Button
              variant="secondary"
              disabled={exportando}
              onClick={() => void exportarLista('pdf')}
            >
              <IconUpload size={16} />
              PDF
            </Button>
            <Button onClick={() => setLancando(true)}>
              <IconPlus size={17} />
              Novo lancamento
            </Button>
          </>
        }
      />

      <div className="statRow">
        <Stat
          label={pagar ? 'Total a pagar' : 'Total a receber'}
          value={formatCentavos(totalAberto)}
          hint={`${emAberto.length} titulo(s)`}
        />
        <Stat
          label="Vencido"
          value={formatCentavos(totalVencido)}
          hint={vencidos.length ? `${vencidos.length} em atraso` : 'nada em atraso'}
          tone={totalVencido > 0 ? 'warning' : 'positive'}
        />
        <Stat
          label={pagar ? 'Pago no mes' : 'Recebido no mes'}
          /* Do servidor, pela data da BAIXA. Antes saia dos titulos pagos com
             vencimento no mes — que a lista nem traz (so vem o que esta em
             aberto), e o cartao marcava zero com o caixa cheio. */
          value={quitadoNoMes === null ? '—' : formatCentavos(quitadoNoMes.totalCents)}
          hint={quitadoNoMes === null ? undefined : `${quitadoNoMes.count} titulo(s)`}
          tone="positive"
        />
      </div>

      <Card>
        {/* --- Filtros --- */}
        <div className={styles.filtrosLinha} role="group" aria-label="Filtro de situacao">
          {(
            [
              ['todos', 'Todos'],
              ['aberto', 'Em aberto'],
              ['vencido', 'Vencidos'],
              ['quitado', pagar ? 'Pagos' : 'Recebidos'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={`${styles.filtro} ${filtroStatus === valor ? styles.filtroAtivo : ''}`}
              onClick={() => setFiltroStatus(valor)}
              aria-pressed={filtroStatus === valor}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <div className={styles.filtrosCampos}>
          <label className={styles.filtroCampo}>
            <span>{rotuloClassificacao}</span>
            <select
              className={styles.filtroSelect}
              value={filtroClassificacao}
              onChange={(e) => setFiltroClassificacao(e.target.value)}
            >
              <option value="">Todos</option>
              {classificacoes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filtroCampo}>
            <span>{rotuloContraparte}</span>
            <select
              className={styles.filtroSelect}
              value={filtroContraparte}
              onChange={(e) => setFiltroContraparte(e.target.value)}
            >
              <option value="">Todos</option>
              {contrapartes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filtroCampo}>
            <span>Vence ate</span>
            <input
              type="date"
              className={styles.filtroSelect}
              value={ate}
              onChange={(e) => setAte(e.target.value)}
            />
          </label>

          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            <IconFilter size={14} />
            Limpar
          </Button>
        </div>

        {/* --- Lista --- */}
        {carregando ? (
          <SkeletonLinhas />
        ) : erroCarga !== null ? (
          <EmptyState
            title="Não deu para carregar as contas"
            description={erroCarga}
            action={
              <Button variant="secondary" onClick={tentarDeNovo}>
                Tentar de novo
              </Button>
            }
          />
        ) : filtradas.length === 0 ? (
          linhas.length === 0 ? (
            <EmptyState
              title={pagar ? 'Nenhuma conta a pagar' : 'Nenhuma conta a receber'}
              description="Lance o primeiro título para acompanhar vencimentos e baixas."
              mascote
              action={
                <Button onClick={() => setLancando(true)}>
                  <IconPlus size={17} />
                  Novo lancamento
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nenhum título encontrado"
              description="Nenhum resultado para estes filtros."
              action={
                <Button variant="secondary" onClick={limparFiltros}>
                  Limpar filtros
                </Button>
              }
            />
          )
        ) : (
          <ul className={styles.titulos}>
            {filtradas.map((l) => {
              const saldoCents = l.valorCents - l.valorBaixadoCents
              const dias = daysUntil(l.vencimento)
              const situacao = situacaoDoTitulo(l.status, l.vencimento, dias)
              const quitado = l.status === 'pago'

              return (
                <li key={l.id} className={styles.titulo}>
                  <div className={styles.tituloPrincipal}>
                    <strong>{l.contraparte}</strong>
                    <span>
                      {l.descricao} · {l.classificacao || '—'}
                    </span>
                  </div>

                  <div className={styles.tituloVencimento}>
                    <span className={styles.tituloData}>{formatDate(l.vencimento)}</span>
                    <span className={styles.tituloPrazo}>
                      {quitado ? 'baixado' : describeDueDate(l.vencimento)}
                    </span>
                  </div>

                  <div className={styles.tituloSituacao}>
                    <Badge tone={TOM_SITUACAO[situacao]}>{ROTULO_SITUACAO[situacao]}</Badge>
                  </div>

                  <div className={styles.tituloValores}>
                    <strong>
                      {formatMoney((saldoCents > 0 ? saldoCents : l.valorCents) / 100)}
                    </strong>
                    {l.valorBaixadoCents > 0 && !quitado ? (
                      <span>de {formatMoney(l.valorCents / 100)}</span>
                    ) : null}
                  </div>

                  <div className={styles.tituloAcoes}>
                    {l.mutavel ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMudando({ linha: l, modo: 'corrigir' })}
                        >
                          Corrigir
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMudando({ linha: l, modo: 'cancelar' })}
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : null}
                    {quitado || l.valorBaixadoCents > 0 ? (
                      <Button variant="secondary" size="sm" onClick={() => setEstornando(l)}>
                        Estornar
                      </Button>
                    ) : null}
                    {!quitado ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setErroDialogo(null)
                          setBaixando(l)
                        }}
                      >
                        Baixar
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={pagar ? COMANDOS_PAGAR : COMANDOS_RECEBER} />
      </div>

      {/* --- Dialogos --- */}
      {lancando ? (
        <FormularioTitulo
          tipo={tipo}
          contrapartesConhecidas={contrapartes}
          onSalvo={(msg) => {
            setLancando(false)
            setToast({ msg, tone: 'success' })
            void carregar()
          }}
          onCancelar={() => setLancando(false)}
        />
      ) : null}

      {baixando ? (
        <BaixaDialog
          titulo={baixando.contraparte}
          descricao={`${baixando.descricao} · vence ${formatDate(baixando.vencimento)}`}
          saldoCents={baixando.valorCents - baixando.valorBaixadoCents}
          verbo={tipo}
          processando={processando}
          erro={erroDialogo}
          onConfirmar={confirmarBaixa}
          onCancelar={() => {
            setBaixando(null)
            setErroDialogo(null)
          }}
        />
      ) : null}

      {/*
        O estorno virou dialogo proprio (NR-081) e nao mais um "tem certeza?".
        Um titulo pode ter varias baixas e o servidor estorna UMA — a pergunta
        "estornar o titulo" nao tinha resposta. Ele carrega o historico, deixa
        escolher e cobra o motivo, que a trilha guarda.
      */}
      {estornando ? (
        <EstornoDialog
          tipo={tipo}
          tituloId={estornando.id}
          contraparte={estornando.contraparte}
          descricao={`${estornando.descricao} · vence ${formatDate(estornando.vencimento)}`}
          onEstornado={(msg) => {
            setEstornando(null)
            setToast({ msg, tone: 'success' })
            void carregar()
          }}
          onCancelar={() => setEstornando(null)}
        />
      ) : null}

      {mudando ? (
        <CorrecaoTitulo
          tipo={tipo}
          modo={mudando.modo}
          titulo={{
            id: mudando.linha.id,
            contraparte: mudando.linha.contraparte,
            descricao: mudando.linha.descricao,
            vencimento: mudando.linha.vencimento,
            valorCents: mudando.linha.valorCents,
          }}
          onFeito={(msg) => {
            setMudando(null)
            setToast({ msg, tone: 'success' })
            void carregar()
          }}
          onFechar={() => setMudando(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
