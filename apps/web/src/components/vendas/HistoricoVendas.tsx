'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarHistorico,
  FORMAS,
  type PaginaDoHistorico,
  type VendaDoHistorico,
} from '@/lib/vendas-api'
import { formatDateTime, formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { ButtonLink, Button } from '@/components/ui/Button'
import { IconPlus, IconSearch } from '@/components/Icons'
import { COMANDOS_VENDAS } from '@/lib/comandos'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './vendas.module.css'

/**
 * O historico de vendas — NR-027, US-021.
 *
 * Esta tela mostrava `lib/mock-data`: o lojista fechava uma venda e o historico
 * continuava sendo o de outra pessoa. Agora busca, periodo e paginacao
 * acontecem no banco.
 *
 * ## Os numeros do topo NAO saem da pagina
 *
 * Faturamento, liquido e ticket medio vem do servidor, sobre o filtro inteiro.
 * Somados aqui a partir das vinte vendas carregadas, dariam um faturamento
 * varias vezes menor assim que o historico passasse de uma pagina — e um numero
 * que parece certo e o pior tipo de errado.
 *
 * ## O filtro de status saiu
 *
 * Ele separava "concluidas" de "estornadas", e o estorno nao existe (RF-043).
 * Enquanto nao existir, o filtro tem um lado sempre vazio e o outro sempre
 * igual a lista inteira — dois botoes que nao mudam nada. Volta com o estorno.
 */

const POR_PAGINA = 20

/** Espera antes de buscar o que esta sendo digitado. */
const ESPERA_DA_BUSCA_MS = 350

/** Os recortes de periodo da barra, em dias para tras a partir de hoje. */
const PERIODOS = [
  { valor: 0, rotulo: 'Qualquer período' },
  { valor: 1, rotulo: 'Hoje e ontem' },
  { valor: 7, rotulo: '7 dias' },
  { valor: 30, rotulo: '30 dias' },
] as const

/**
 * `de`/`ate` para um recorte em dias.
 *
 * Campos LOCAIS, nunca `toISOString`: no fuso do Brasil a meia-noite de hoje
 * ainda e ontem em UTC, e o periodo comecaria um dia antes.
 */
function periodoDe(dias: number): { de: string; ate: string } {
  if (dias === 0) return { de: '', ate: '' }

  const dois = (n: number) => String(n).padStart(2, '0')
  const iso = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`

  const hoje = new Date()
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (dias - 1))

  return { de: iso(inicio), ate: iso(hoje) }
}

const ROTULO_DO_STATUS: Record<VendaDoHistorico['status'], string> = {
  open: 'Aberta',
  settled: 'Quitada',
  cancelled: 'Cancelada',
  returned: 'Devolvida',
}

const TOM_DO_STATUS: Record<VendaDoHistorico['status'], 'success' | 'danger' | 'warning'> = {
  open: 'warning',
  settled: 'success',
  cancelled: 'danger',
  returned: 'danger',
}

export default function HistoricoVendas() {
  const [busca, setBusca] = useState('')
  const [periodo, setPeriodo] = useState(0)
  const [pagina, setPagina] = useState(1)

  const [dados, setDados] = useState<PaginaDoHistorico | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  /* A resposta que chega fora de ordem e descartada: numa rede lenta, a busca
     de "mar" pode voltar depois da de "maria" e pintar a tela com o resultado
     do termo anterior. */
  const pedido = useRef(0)

  const buscar = useCallback(async (termo: string, dias: number, qualPagina: number) => {
    const meu = ++pedido.current
    const { de, ate } = periodoDe(dias)

    const r = await carregarHistorico({ termo, de, ate, pagina: qualPagina, porPagina: POR_PAGINA })

    if (meu !== pedido.current) return

    setCarregando(false)

    if (!r.ok) {
      setErro(r.error)
      return
    }

    setErro(null)
    setDados(r.dados)
  }, [])

  /* O efeito so AGENDA: `setState` sincrono dentro de efeito encadeia renders,
     e quem liga o `carregando` e quem mexeu no filtro. */
  useEffect(() => {
    const t = setTimeout(() => {
      void buscar(busca, periodo, pagina)
    }, ESPERA_DA_BUSCA_MS)

    return () => clearTimeout(t)
  }, [busca, periodo, pagina, buscar])

  /* Trocar busca ou periodo volta para a primeira pagina: continuar na pagina 4
     de um resultado que agora tem uma mostraria vazio, e o lojista concluiria
     que a busca nao achou nada. */
  const mudarBusca = (valor: string) => {
    setCarregando(true)
    setBusca(valor)
    setPagina(1)
  }

  const mudarPeriodo = (dias: number) => {
    setCarregando(true)
    setPeriodo(dias)
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
    setPagina(1)
  }

  const total = dados?.total ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA))
  const filtrando = busca.trim() !== '' || periodo > 0
  const resumo = dados?.resumo

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle="Histórico de vendas fechadas"
        actions={
          <>
            {/* O mesmo periodo e busca da lista — NR-155. */}
            <BotoesExportar
              lista="vendas"
              filtros={{
                q: busca.trim(),
                from: periodoDe(periodo).de,
                to: periodoDe(periodo).ate,
              }}
            />
            <ButtonLink href="/app/vendas/nova">
              <IconPlus size={17} />
              Nova venda
            </ButtonLink>
          </>
        }
      />

      <div className="statRow">
        <Stat
          label="Faturamento bruto"
          value={resumo ? formatMoney(resumo.faturamento) : '—'}
          hint={resumo ? `${resumo.quantidade} vendas` : 'carregando'}
        />
        <Stat
          label="Faturamento líquido"
          value={resumo ? formatMoney(resumo.liquido) : '—'}
          hint="sem desconto, imposto e taxa de cartão"
          tone="positive"
        />
        <Stat
          label="Ticket médio (bruto)"
          /* Nulo, e nao zero: "ticket medio R$ 0,00" diria que houve venda de
             valor nenhum. O travessao diz que nao houve venda. */
          value={resumo?.ticketMedio == null ? '—' : formatMoney(resumo.ticketMedio)}
        />
      </div>

      <Card>
        <div className={styles.historicoBarra}>
          <label className={styles.busca}>
            <IconSearch size={17} />
            <input
              type="search"
              value={busca}
              onChange={(e) => mudarBusca(e.target.value)}
              placeholder="Buscar por cliente, número ou produto"
              aria-label="Buscar venda"
            />
          </label>

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
            title="Não deu para carregar o histórico"
            description={erro}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  setErro(null)
                  void buscar(busca, periodo, pagina)
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : carregando && dados === null ? (
          <SkeletonLinhas />
        ) : total === 0 ? (
          filtrando ? (
            <EmptyState
              title="Nenhuma venda encontrada"
              description="Ajuste a busca ou o período."
              action={
                <Button variant="secondary" onClick={limparFiltros}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nenhuma venda ainda"
              description="Abra o PDV e registre a primeira venda."
              mascote
              action={
                <ButtonLink href="/app/vendas/nova">
                  <IconPlus size={16} />
                  Nova venda
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <ul className={styles.historico} aria-busy={carregando}>
              {(dados?.vendas ?? []).map((v) => (
                <li key={v.id}>
                  <Link href={`/app/vendas/${v.id}`} className={styles.vendaLinha}>
                    <span className={styles.vendaNumero}>#{v.numero}</span>

                    <span className={styles.vendaPrincipal}>
                      {/* Venda de balcao vem sem cliente — RF-033. O rotulo diz
                          isso; um nome inventado faria parecer identificada. */}
                      <strong>{v.clienteNome ?? 'Venda de balcao'}</strong>
                      <span>
                        {formatDateTime(v.data)}
                        {v.pagamentos.length > 0
                          ? ` · ${v.pagamentos
                              .map((p) => FORMAS.find((f) => f.valor === p.forma)?.rotulo)
                              .filter(Boolean)
                              .join(' + ')}`
                          : ''}
                      </span>
                    </span>

                    <span className={styles.vendaNota}>
                      {v.notaNumero !== null ? (
                        <Badge tone="info">NFC-e {v.notaNumero}</Badge>
                      ) : (
                        <Badge>Sem nota</Badge>
                      )}
                    </span>

                    <span className={styles.vendaStatus}>
                      <Badge tone={TOM_DO_STATUS[v.status]}>{ROTULO_DO_STATUS[v.status]}</Badge>
                    </span>

                    <span className={styles.vendaTotal}>{formatMoney(v.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <Paginacao
              pagina={pagina}
              ultimaPagina={ultimaPagina}
              total={total}
              nesta={dados?.vendas.length ?? 0}
              carregando={carregando}
              onIr={irParaPagina}
            />
          </>
        )}
      </Card>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={COMANDOS_VENDAS} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * "21–40 de 340" e os dois botoes.
 *
 * Some quando ha uma pagina so: um paginador com os dois botoes desligados nao
 * informa nada e ocupa espaco.
 */
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
  if (ultimaPagina <= 1) {
    return (
      <p className={styles.paginacaoResumo}>
        {total} {total === 1 ? 'venda' : 'vendas'}
      </p>
    )
  }

  const primeiro = (pagina - 1) * POR_PAGINA + 1

  return (
    <div className={styles.paginacao}>
      <p className={styles.paginacaoResumo}>
        {primeiro}–{primeiro + nesta - 1} de {total}
      </p>

      <div className={styles.paginacaoBotoes}>
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
