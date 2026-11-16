'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarOrcamentos,
  conversao,
  ROTULO_DA_SITUACAO,
  ROTULO_SITUACAO,
  SITUACOES,
  situacaoDe,
  type PaginaDeOrcamentos,
  type SituacaoDoOrcamento,
} from '@/lib/orcamentos-api'
import { formatCentavos, formatDate, hoje } from '@/lib/format'
import { PERIODOS, periodoDe } from '@/lib/periodos'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import { IconSearch } from '@/components/Icons'
import Toast from '@/components/ui/Toast'
import OrcamentoForm from './OrcamentoForm'
import styles from './orcamentos.module.css'

/**
 * Orcamentos — NR-159.
 *
 * A proposta ao cliente: nao baixa estoque nem lanca financeiro. Os precos
 * ficam gravados. Na ficha, o orcamento sai no papel (imprimir), vai pelo
 * WhatsApp ou vira venda no PDV com o carrinho ja montado.
 *
 * ## Painel e busca — NR-210
 *
 * Achado do QA: "deve ter um painel, como na venda, do total de orcamentos em
 * aberto, como tambem um filtro de busca como ha na venda". O painel e a
 * busca vem do servidor, sobre TODOS os orcamentos (antes a lista trazia os
 * 100 mais recentes, e um total somado ali deixaria os antigos de fora). A
 * situacao escolhida recorta so a lista: escolher "Vencidos" nao zera o "Em
 * aberto" do painel.
 */

const POR_PAGINA = 20

/** Espera antes de buscar o que esta sendo digitado — a mesma das vendas. */
const ESPERA_DA_BUSCA_MS = 350

const quantos = (n: number) => `${n} ${n === 1 ? 'orçamento' : 'orçamentos'}`

const TOM: Record<SituacaoDoOrcamento, 'success' | 'neutral' | 'warning' | 'info'> = {
  open: 'info',
  expired: 'warning',
  converted: 'success',
  cancelled: 'neutral',
}

export default function OrcamentosView() {
  const [busca, setBusca] = useState('')
  const [periodo, setPeriodo] = useState(0)
  const [situacao, setSituacao] = useState<SituacaoDoOrcamento | ''>('')
  const [pagina, setPagina] = useState(1)
  /* Sobe quando um orcamento novo e salvo: refaz a busca com o mesmo filtro. */
  const [versao, setVersao] = useState(0)

  const [dados, setDados] = useState<PaginaDeOrcamentos | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  /* A resposta que chega fora de ordem e descartada: a busca de "jo" pode
     voltar depois da de "joana" e pintar a tela com o termo anterior. */
  const pedido = useRef(0)

  const buscar = useCallback(
    async (termo: string, dias: number, qual: SituacaoDoOrcamento | '', p: number) => {
      const meu = ++pedido.current
      const { de, ate } = periodoDe(dias)
      const r = await carregarOrcamentos({
        termo,
        situacao: qual,
        de,
        ate,
        pagina: p,
        porPagina: POR_PAGINA,
      })
      if (meu !== pedido.current) return
      setCarregando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      setErro(null)
      setDados(r.dados)
    },
    [],
  )

  /* O efeito so AGENDA; quem liga o `carregando` e quem mexeu no filtro. */
  useEffect(() => {
    const t = setTimeout(() => void buscar(busca, periodo, situacao, pagina), ESPERA_DA_BUSCA_MS)
    return () => clearTimeout(t)
  }, [busca, periodo, situacao, pagina, versao, buscar])

  /* Mexer no filtro volta para a primeira pagina: ficar na 4 de um resultado
     que agora tem uma mostraria a lista vazia. */
  const mudarBusca = (v: string) => {
    setCarregando(true)
    setBusca(v)
    setPagina(1)
  }
  const mudarPeriodo = (v: number) => {
    setCarregando(true)
    setPeriodo(v)
    setPagina(1)
  }
  const mudarSituacao = (v: SituacaoDoOrcamento | '') => {
    setCarregando(true)
    setSituacao(v)
    setPagina(1)
  }
  const irParaPagina = (p: number) => {
    setCarregando(true)
    setPagina(p)
  }
  const limparFiltros = () => {
    setCarregando(true)
    setBusca('')
    setPeriodo(0)
    setSituacao('')
    setPagina(1)
  }

  const dia = hoje()
  const resumo = dados?.resumo
  const total = dados?.total ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA))
  const filtrando = busca.trim() !== '' || periodo > 0 || situacao !== ''
  const taxa = resumo ? conversao(resumo) : null
  const todos = resumo ? SITUACOES.reduce((n, s) => n + resumo[s].count, 0) : null

  return (
    <>
      <PageHeader
        title="Orçamentos"
        subtitle="Proposta ao cliente: não baixa estoque e vira venda quando ele aceitar"
      />

      {/* O painel — NR-210. Mesma busca e periodo da lista. */}
      <div className="statRow" aria-label="Painel dos orçamentos">
        <Stat
          label="Em aberto"
          value={resumo ? formatCentavos(resumo.open.totalCents) : '—'}
          hint={resumo ? `${quantos(resumo.open.count)} no prazo` : 'carregando'}
          tone="positive"
        />
        <Stat
          label="Vencidos"
          value={resumo ? formatCentavos(resumo.expired.totalCents) : '—'}
          hint={resumo ? `${quantos(resumo.expired.count)} sem resposta no prazo` : 'carregando'}
          tone={resumo !== undefined && resumo.expired.count > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Viraram venda"
          value={resumo ? formatCentavos(resumo.converted.totalCents) : '—'}
          hint={
            resumo
              ? `${quantos(resumo.converted.count)}${taxa === null ? '' : ` · conversão de ${taxa}%`}`
              : 'carregando'
          }
        />
      </div>

      <OrcamentoForm
        aoSalvar={(o) => {
          setToast({ msg: `Orçamento nº ${o.number} criado.`, tone: 'success' })
          setCarregando(true)
          setVersao((v) => v + 1)
        }}
        aoErrar={(msg) => setToast({ msg, tone: 'error' })}
      />

      <Card title="Orçamentos">
        <div className={styles.barra}>
          <label className={styles.busca}>
            <IconSearch size={17} />
            <input
              type="search"
              value={busca}
              onChange={(e) => mudarBusca(e.target.value)}
              placeholder="Buscar por cliente, número ou produto"
              aria-label="Buscar orçamento"
            />
          </label>

          <select
            className={styles.select}
            value={situacao}
            onChange={(e) => mudarSituacao(e.target.value as SituacaoDoOrcamento | '')}
            aria-label="Situação"
          >
            <option value="">Todas as situações{todos === null ? '' : ` (${todos})`}</option>
            {SITUACOES.map((s) => (
              <option key={s} value={s}>
                {ROTULO_DA_SITUACAO[s]}
                {resumo ? ` (${resumo[s].count})` : ''}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={periodo}
            onChange={(e) => mudarPeriodo(Number(e.target.value))}
            aria-label="Período"
          >
            {PERIODOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>

        {erro !== null ? (
          <EmptyState
            title="Não deu para carregar os orçamentos"
            description={erro}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  setErro(null)
                  void buscar(busca, periodo, situacao, pagina)
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : carregando && dados === null ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : total === 0 ? (
          filtrando ? (
            <EmptyState
              title="Nenhum orçamento encontrado"
              description="Ajuste a busca, a situação ou o período."
              action={
                <Button variant="secondary" onClick={limparFiltros}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <p className={styles.vazio}>Nenhum orçamento ainda.</p>
          )
        ) : (
          <>
            <ul className={styles.lista} aria-busy={carregando}>
              {(dados?.orcamentos ?? []).map((o) => {
                const s = situacaoDe(o, dia)
                return (
                  <li key={o.id} className={styles.orcamento}>
                    <span className={styles.info}>
                      <strong>
                        Nº {o.number}
                        {o.customerName ? ` · ${o.customerName}` : ''}
                      </strong>
                      <small>
                        {o.items.length} {o.items.length === 1 ? 'item' : 'itens'} · válido até{' '}
                        {formatDate(o.validUntil)}
                      </small>
                    </span>
                    <Badge tone={TOM[s]}>
                      {s === 'expired' ? 'Vencido' : ROTULO_SITUACAO[o.status]}
                    </Badge>
                    <strong className={styles.valor}>{formatCentavos(o.totalCents)}</strong>
                    <span className={styles.botoes}>
                      <ButtonLink href={`/app/orcamentos/${o.id}`} variant="secondary" size="sm">
                        Abrir
                      </ButtonLink>
                      {/* Achado do QA: do orcamento direto para a venda, com o
                          carrinho e o cliente montados. */}
                      {o.status === 'open' ? (
                        <ButtonLink href={`/app/vendas/nova?orcamento=${o.id}`} size="sm">
                          Vender
                        </ButtonLink>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>

            <Paginacao
              pagina={pagina}
              ultimaPagina={ultimaPagina}
              total={total}
              nesta={dados?.orcamentos.length ?? 0}
              carregando={carregando}
              onIr={irParaPagina}
            />
          </>
        )}
      </Card>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/** "21–40 de 57" e os dois botoes; com uma pagina so, so a contagem. */
function Paginacao({
  pagina,
  ultimaPagina,
  total,
  nesta,
  carregando,
  onIr,
}: {
  pagina: number
  ultimaPagina: number
  total: number
  nesta: number
  carregando: boolean
  onIr: (p: number) => void
}) {
  if (ultimaPagina <= 1) return <p className={styles.paginacaoResumo}>{quantos(total)}</p>

  const primeiro = (pagina - 1) * POR_PAGINA + 1
  return (
    <div className={styles.paginacao}>
      <p className={styles.paginacaoResumo}>
        {primeiro}–{primeiro + nesta - 1} de {total}
      </p>
      <div className={styles.botoes}>
        <Button
          variant="secondary"
          onClick={() => onIr(pagina - 1)}
          disabled={pagina <= 1 || carregando}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          onClick={() => onIr(pagina + 1)}
          disabled={pagina >= ultimaPagina || carregando}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}
