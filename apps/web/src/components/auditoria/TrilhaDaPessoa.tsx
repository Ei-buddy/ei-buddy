'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  listarTrilha,
  ROTULO_ACAO,
  ROTULO_CANAL,
  ROTULO_ENTIDADE,
  type AcaoDaTrilha,
  type PaginaDaTrilha,
  type RegistroDaTrilha,
} from '@/lib/auditoria-api'
import { formatDateTime } from '@/lib/format'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  FormGrid,
  Input,
  PageHeader,
  Select,
} from '@/components/ui/UI'
import { IconArrowLeft } from '@/components/Icons'
import styles from './auditoria.module.css'

const TAMANHO_DA_PAGINA = 50

/**
 * O que UMA pessoa fez na loja — US-061.
 *
 * Segunda metade da tela de auditoria: a primeira escolhe a pessoa, esta
 * mostra a trilha dela. A separacao e o que tira a poluicao — a trilha de
 * todo mundo junta e ilegivel numa loja com movimento, e ninguem abre a
 * auditoria sem ter em mente de quem esta atras.
 *
 * O nome sai da primeira linha que voltar, e nao de uma consulta a parte:
 * quem tem trilha aqui tem pelo menos um registro, e o registro ja carrega o
 * nome (inclusive de quem saiu da loja).
 */
export default function TrilhaDaPessoa({ actorId }: { actorId: string }) {
  const [pagina, setPagina] = useState<PaginaDaTrilha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const [entidade, setEntidade] = useState('')
  const [acao, setAcao] = useState<AcaoDaTrilha | ''>('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [paginaAtual, setPaginaAtual] = useState(1)

  /* O efeito so busca; quem mexe no filtro liga `carregando` — setState
     sincrono no corpo do efeito renderiza em cascata. */
  useEffect(() => {
    void (async () => {
      const r = await listarTrilha({
        actorId,
        ...(entidade === '' ? {} : { entity: entidade }),
        ...(acao === '' ? {} : { action: acao }),
        /* O dia escolhido e o dia LOCAL de quem olha: "hoje" no Brasil comeca
           tres horas depois do "hoje" em UTC. */
        ...(de === '' ? {} : { from: new Date(`${de}T00:00:00`).toISOString() }),
        ...(ate === '' ? {} : { to: new Date(`${ate}T23:59:59.999`).toISOString() }),
        page: paginaAtual,
        pageSize: TAMANHO_DA_PAGINA,
      })
      setCarregando(false)
      if (r.ok) {
        setErro(null)
        setPagina(r.dados)
      } else {
        setErro(r.erro)
      }
    })()
  }, [actorId, entidade, acao, de, ate, paginaAtual])

  /** Toda mudanca de filtro volta para a primeira pagina. */
  function filtrar(aplicar: () => void) {
    setCarregando(true)
    setPaginaAtual(1)
    aplicar()
  }

  const ultimaPagina = Math.max(1, Math.ceil((pagina?.total ?? 0) / TAMANHO_DA_PAGINA))
  const temFiltro = entidade !== '' || acao !== '' || de !== '' || ate !== ''
  const nome = pagina?.entries[0]?.actorName ?? null

  return (
    <>
      <Link href="/app/auditoria" className={styles.voltar}>
        <IconArrowLeft size={16} />
        Todas as pessoas
      </Link>

      <PageHeader
        title={nome ?? 'Usuário removido'}
        subtitle={
          pagina === null
            ? 'Auditoria'
            : `${pagina.total} ${pagina.total === 1 ? 'ação registrada' : 'ações registradas'} nesta loja.`
        }
      />

      <Card>
        <FormGrid>
          <Field label="O quê" htmlFor="filtro-entidade" span={3}>
            <Select
              id="filtro-entidade"
              value={entidade}
              onChange={(e) => filtrar(() => setEntidade(e.target.value))}
            >
              <option value="">Tudo</option>
              {Object.entries(ROTULO_ENTIDADE).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Ação" htmlFor="filtro-acao" span={3}>
            <Select
              id="filtro-acao"
              value={acao}
              onChange={(e) => filtrar(() => setAcao(e.target.value as AcaoDaTrilha | ''))}
            >
              <option value="">Todas</option>
              {Object.entries(ROTULO_ACAO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="De" htmlFor="filtro-de" span={3}>
            <Input
              id="filtro-de"
              type="date"
              value={de}
              max={ate === '' ? undefined : ate}
              onChange={(e) => filtrar(() => setDe(e.target.value))}
            />
          </Field>

          <Field label="Até" htmlFor="filtro-ate" span={3}>
            <Input
              id="filtro-ate"
              type="date"
              value={ate}
              min={de === '' ? undefined : de}
              onChange={(e) => filtrar(() => setAte(e.target.value))}
            />
          </Field>
        </FormGrid>

        {temFiltro ? (
          <div className={styles.chips}>
            <button
              type="button"
              className={styles.limpar}
              onClick={() =>
                filtrar(() => {
                  setEntidade('')
                  setAcao('')
                  setDe('')
                  setAte('')
                })
              }
            >
              Limpar filtros
            </button>
          </div>
        ) : null}

        {erro !== null ? (
          <EmptyState title="Não deu para carregar a trilha" description={erro} />
        ) : carregando && pagina === null ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : pagina === null || pagina.entries.length === 0 ? (
          <EmptyState
            title="Nenhum registro encontrado"
            description={
              temFiltro ? 'Tente afrouxar os filtros.' : 'Esta pessoa não tem ações registradas.'
            }
          />
        ) : (
          <ul className={`${styles.lista} ${carregando ? styles.atualizando : ''}`}>
            {pagina.entries.map((r) => (
              <Linha key={r.id} registro={r} />
            ))}
          </ul>
        )}

        {pagina !== null && ultimaPagina > 1 ? (
          <div className={styles.paginacao}>
            <button
              type="button"
              className={styles.paginacaoBotao}
              disabled={paginaAtual <= 1}
              onClick={() => {
                setCarregando(true)
                setPaginaAtual((p) => p - 1)
              }}
            >
              Anterior
            </button>
            <span className={styles.paginacaoInfo}>
              Página {paginaAtual} de {ultimaPagina} · {pagina.total} registro(s)
            </span>
            <button
              type="button"
              className={styles.paginacaoBotao}
              disabled={paginaAtual >= ultimaPagina}
              onClick={() => {
                setCarregando(true)
                setPaginaAtual((p) => p + 1)
              }}
            >
              Próxima
            </button>
          </div>
        ) : null}
      </Card>
    </>
  )
}

/**
 * Uma acao da pessoa.
 *
 * Sem o nome de quem fez: a tela inteira e de uma pessoa so, e repetir o nome
 * em cada linha seria a poluicao que esta separacao veio resolver.
 */
function Linha({ registro: r }: { registro: RegistroDaTrilha }) {
  const mudancas = diferencas(r.before, r.after)

  return (
    <li className={styles.item}>
      <div className={styles.cabecalho}>
        <span className={styles.oque}>
          {ROTULO_ACAO[r.action] ?? r.action} ·{' '}
          <strong>{ROTULO_ENTIDADE[r.entity] ?? r.entity}</strong>
        </span>
        <span className={styles.meta}>
          <Badge tone="neutral">{ROTULO_CANAL[r.channel] ?? r.channel}</Badge>
          <time dateTime={r.occurredAt}>{formatDateTime(r.occurredAt)}</time>
        </span>
      </div>

      {mudancas.length > 0 ? (
        <details className={styles.detalhes}>
          <summary>{mudancas.length === 1 ? '1 campo' : `${mudancas.length} campos`}</summary>
          <dl className={styles.campos}>
            {mudancas.map((m) => (
              <div key={m.campo} className={styles.campo}>
                <dt>{m.campo}</dt>
                <dd>
                  {m.antes !== undefined ? (
                    <>
                      <span className={styles.antes}>{exibir(m.antes)}</span>
                      <span aria-label="mudou para"> → </span>
                    </>
                  ) : null}
                  <span className={styles.depois}>{exibir(m.depois)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </li>
  )
}

type Mudanca = { campo: string; antes: unknown; depois: unknown }

/**
 * So o que mudou.
 *
 * A trilha guarda mapas de campo; mostrar os dois inteiros obrigaria o dono a
 * comparar a olho. Campo igual nos dois lados fica de fora — e contexto, nao
 * mudanca.
 */
function diferencas(
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown> | null,
): Mudanca[] {
  const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])
  const lista: Mudanca[] = []
  for (const campo of campos) {
    const a = antes === null ? undefined : antes[campo]
    const d = depois === null ? undefined : depois[campo]
    if (antes !== null && depois !== null && JSON.stringify(a) === JSON.stringify(d)) continue
    lista.push({ campo, antes: a, depois: d })
  }
  return lista
}

function exibir(valor: unknown): string {
  if (valor === undefined || valor === null) return '—'
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  return JSON.stringify(valor)
}
