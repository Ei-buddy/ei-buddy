'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listarClientes } from '@/lib/clientes-api'
import {
  COLUNAS,
  criarCard,
  listarCards,
  moverCard,
  type CardCrm,
  type ColunaId,
  type DadosCard,
  type TipoCard,
} from '@/lib/crm-api'
import { listarEquipe, type MembroDaEquipe } from '@/lib/equipe-api'
import { daysUntil, formatDate, hoje } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconCalendar, IconList, IconPlus, IconUsers } from '@/components/Icons'
import { useDialogo } from '@/components/app/useDialogo'
import CardDetalhe from './CardDetalhe'
import styles from './crm.module.css'

type Visao = 'quadro' | 'lista'

export default function CrmQuadro() {
  const [cards, setCards] = useState<CardCrm[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [visao, setVisao] = useState<Visao>('quadro')

  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [periodo, setPeriodo] = useState(0)

  const [aberto, setAberto] = useState<CardCrm | null>(null)
  /* Qual formulario abrir: pendencia ou contato — NR-213. */
  const [criando, setCriando] = useState<TipoCard | null>(null)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [colunaAlvo, setColunaAlvo] = useState<ColunaId | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const buscar = useCallback(async () => {
    const r = await listarCards()
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    setCards(r.dados)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  const nomesClientes = useMemo(
    () =>
      [...new Set(cards.map((c) => c.clienteNome).filter((n): n is string => n !== null))].sort(),
    [cards],
  )

  const filtrados = useMemo(() => {
    return cards.filter((c) => {
      if (filtroCliente && c.clienteNome !== filtroCliente) return false
      if (filtroTipo && c.tipo !== filtroTipo) return false
      if (periodo > 0 && Math.abs(daysUntil(c.data)) > periodo) return false
      return true
    })
  }, [cards, filtroCliente, filtroTipo, periodo])

  const porColuna = (coluna: ColunaId) => filtrados.filter((c) => c.coluna === coluna)

  /* ---------------------------------------------------------------- *
   * Mover card
   * ---------------------------------------------------------------- */

  async function mover(id: string, coluna: ColunaId) {
    const card = cards.find((c) => c.id === id)
    if (!card || card.coluna === coluna) return

    /* Move na tela antes da resposta: arrastar precisa parecer imediato.
       Se a chamada falhar, desfazemos. */
    setCards((atual) => atual.map((c) => (c.id === id ? { ...c, coluna } : c)))

    const r = await moverCard(id, coluna)

    if (!r.ok) {
      setCards((atual) => atual.map((c) => (c.id === id ? { ...c, coluna: card.coluna } : c)))
      setToast({ msg: 'Não foi possível mover o card.', tone: 'error' })
    }
  }

  const contagem = {
    afazer: cards.filter((c) => c.coluna === 'afazer').length,
    andamento: cards.filter((c) => c.coluna === 'andamento').length,
    concluido: cards.filter((c) => c.coluna === 'concluido').length,
  }

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Pendências e contatos lançados por aqui"
        actions={
          /* Achado do QA: "depois que uma pendencia e cadastrada nao e mais
             possivel cadastrar um contato". O unico botao dizia "Nova
             pendencia", e o contato ficava escondido num seletor dentro do
             formulario. Agora os dois caminhos estao a vista. */
          <>
            <Button variant="secondary" onClick={() => setCriando('contato')}>
              <IconPlus size={17} />
              Novo contato
            </Button>
            <Button onClick={() => setCriando('pendencia')}>
              <IconPlus size={17} />
              Nova pendência
            </Button>
          </>
        }
      />

      {cards.length > 0 && !carregando ? (
        <div className="statRow">
          <Stat
            label="A fazer"
            value={String(contagem.afazer)}
            tone={contagem.afazer ? 'warning' : 'neutral'}
          />
          <Stat label="Em andamento" value={String(contagem.andamento)} />
          <Stat label="Concluídos" value={String(contagem.concluido)} tone="positive" />
        </div>
      ) : null}

      <Card>
        {/*
          Carregando, vazio e quebrado sao TRES coisas diferentes — mesmo
          criterio da tela de suporte: mostrar o vazio antes da lista chegar
          faria a pessoa lancar um card repetido achando que sumiu.
        */}
        {carregando ? (
          <SkeletonLinhas />
        ) : erroCarga !== null ? (
          <EmptyState
            title="Não deu para carregar o quadro"
            description={erroCarga}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  setErroCarga(null)
                  void buscar()
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : (
          <>
            {/* --- Filtros e alternador de visao --- */}
            <div className={styles.barra}>
              <div className={styles.filtros}>
                <select
                  className={styles.select}
                  value={filtroCliente}
                  onChange={(e) => setFiltroCliente(e.target.value)}
                  aria-label="Filtrar por cliente"
                >
                  <option value="">Todos os clientes</option>
                  {nomesClientes.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                <select
                  className={styles.select}
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value)}
                  aria-label="Filtrar por tipo"
                >
                  <option value="">Pendências e contatos</option>
                  <option value="pendencia">Só pendências</option>
                  <option value="contato">So contatos</option>
                </select>

                <select
                  className={styles.select}
                  value={periodo}
                  onChange={(e) => setPeriodo(Number(e.target.value))}
                  aria-label="Filtrar por período"
                >
                  <option value={0}>Qualquer data</option>
                  <option value={7}>Últimos/próximos 7 dias</option>
                  <option value={30}>30 dias</option>
                  <option value={90}>90 dias</option>
                </select>
              </div>

              {/* No mobile o quadro rola na horizontal; a lista e a alternativa */}
              <div className={styles.visoes} role="group" aria-label="Modo de visualização">
                <button
                  type="button"
                  className={`${styles.visao} ${visao === 'quadro' ? styles.visaoAtiva : ''}`}
                  onClick={() => setVisao('quadro')}
                  aria-pressed={visao === 'quadro'}
                >
                  Quadro
                </button>
                <button
                  type="button"
                  className={`${styles.visao} ${visao === 'lista' ? styles.visaoAtiva : ''}`}
                  onClick={() => setVisao('lista')}
                  aria-pressed={visao === 'lista'}
                >
                  <IconList size={14} />
                  Lista
                </button>
              </div>
            </div>

            {filtrados.length === 0 ? (
              cards.length === 0 ? (
                <EmptyState
                  title="Nada no CRM ainda"
                  description="Lance uma pendência ou um contato para começar a acompanhar."
                  mascote
                  action={
                    <Button onClick={() => setCriando('pendencia')}>
                      <IconPlus size={16} />
                      Lançar a primeira
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Nenhum card com estes filtros"
                  description="Ajuste os filtros para ver outros cards."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFiltroCliente('')
                        setFiltroTipo('')
                        setPeriodo(0)
                      }}
                    >
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : visao === 'quadro' ? (
              /* ============ Quadro Kanban ============ */
              <div className={styles.quadro}>
                {COLUNAS.map((coluna) => (
                  <section
                    key={coluna.id}
                    className={`${styles.coluna} ${colunaAlvo === coluna.id ? styles.colunaAlvo : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setColunaAlvo(coluna.id)
                    }}
                    onDragLeave={() => setColunaAlvo(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setColunaAlvo(null)
                      if (arrastando) void mover(arrastando, coluna.id)
                      setArrastando(null)
                    }}
                  >
                    <header className={styles.colunaCabecalho}>
                      <h2 className={styles.colunaTitulo}>{coluna.titulo}</h2>
                      <span className={styles.colunaContador}>{porColuna(coluna.id).length}</span>
                    </header>

                    <ul className={styles.cards}>
                      {porColuna(coluna.id).map((card) => (
                        <li key={card.id}>
                          <CardKanban
                            card={card}
                            onAbrir={() => setAberto(card)}
                            onMover={(destino) => void mover(card.id, destino)}
                            onArrastarInicio={() => setArrastando(card.id)}
                            onArrastarFim={() => {
                              setArrastando(null)
                              setColunaAlvo(null)
                            }}
                            arrastando={arrastando === card.id}
                          />
                        </li>
                      ))}

                      {porColuna(coluna.id).length === 0 ? (
                        <li className={styles.colunaVazia}>Nada aqui</li>
                      ) : null}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              /* ============ Lista ============ */
              <ul className={styles.lista}>
                {filtrados.map((card) => {
                  const coluna = COLUNAS.find((c) => c.id === card.coluna)
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        className={styles.listaItem}
                        onClick={() => setAberto(card)}
                      >
                        <span className={styles.listaPrincipal}>
                          <strong>{card.titulo}</strong>
                          <span>
                            {card.clienteNome ?? 'Sem cliente'} · {formatDate(card.data)}
                          </span>
                        </span>
                        <Badge
                          tone={
                            card.coluna === 'concluido'
                              ? 'success'
                              : card.coluna === 'andamento'
                                ? 'info'
                                : 'warning'
                          }
                        >
                          {coluna?.titulo}
                        </Badge>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {aberto ? (
        <CardDetalhe
          card={aberto}
          onFechar={() => setAberto(null)}
          onAtualizar={(atualizado) => {
            setCards((atual) => atual.map((c) => (c.id === atualizado.id ? atualizado : c)))
            setAberto(atualizado)
          }}
          onExcluido={(id) => {
            setCards((atual) => atual.filter((c) => c.id !== id))
            setAberto(null)
            setToast({ msg: 'Card excluído.', tone: 'success' })
          }}
        />
      ) : null}

      {criando !== null ? (
        <FormCard
          tipoInicial={criando}
          onCriado={(novo) => {
            setCards((atual) => [novo, ...atual])
            setCriando(null)
            setToast({
              msg:
                novo.tipo === 'contato'
                  ? 'Contato criado em A fazer.'
                  : 'Pendência criada em A fazer.',
              tone: 'success',
            })
          }}
          onCancelar={() => setCriando(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Card do quadro
 * ================================================================== */

function CardKanban({
  card,
  onAbrir,
  onMover,
  onArrastarInicio,
  onArrastarFim,
  arrastando,
}: {
  card: CardCrm
  onAbrir: () => void
  onMover: (destino: ColunaId) => void
  onArrastarInicio: () => void
  onArrastarFim: () => void
  arrastando: boolean
}) {
  const atrasado = card.coluna !== 'concluido' && daysUntil(card.data) < 0

  return (
    <div
      className={`${styles.card} ${arrastando ? styles.cardArrastando : ''}`}
      draggable
      onDragStart={onArrastarInicio}
      onDragEnd={onArrastarFim}
    >
      <button type="button" className={styles.cardCorpo} onClick={onAbrir}>
        <span className={styles.cardTopo}>
          <Badge tone={card.tipo === 'pendencia' ? 'warning' : 'info'}>
            {card.tipo === 'pendencia' ? 'Pendência' : 'Contato'}
          </Badge>
          {atrasado ? <Badge tone="danger">Atrasado</Badge> : null}
        </span>

        <strong className={styles.cardTitulo}>{card.titulo}</strong>

        <span className={styles.cardCliente}>
          <IconUsers size={13} />
          {card.clienteNome ?? 'Sem cliente'}
        </span>

        <span className={styles.cardRodape}>
          <span className={styles.cardData}>
            <IconCalendar size={12} />
            {formatDate(card.data)}
          </span>
          {card.responsavelNome ? (
            <span className={styles.cardResponsavel}>{card.responsavelNome.split(' ')[0]}</span>
          ) : (
            <span className={styles.cardSemResponsavel}>sem responsável</span>
          )}
        </span>
      </button>

      {/* Arrastar nao funciona no toque nem no teclado — este seletor e o
          caminho acessivel para a mesma acao. */}
      <label className={styles.cardMover}>
        <span className={styles.cardMoverRotulo}>Mover para</span>
        <select
          className={styles.cardMoverSelect}
          value={card.coluna}
          onChange={(e) => onMover(e.target.value as ColunaId)}
          aria-label={`Mover ${card.titulo} para outra coluna`}
        >
          {COLUNAS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titulo}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/* ================================================================== *
 * Formulario de novo card
 * ================================================================== */

function FormCard({
  tipoInicial,
  onCriado,
  onCancelar,
}: {
  tipoInicial: TipoCard
  onCriado: (card: CardCrm) => void
  onCancelar: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipo, setTipo] = useState<TipoCard>(tipoInicial)
  const [clienteId, setClienteId] = useState('')
  /* O campo de data do cartao novo abria em 24/08/2026 — a pessoa tinha de
     corrigir a data em todo cartao que criasse. */
  const [data, setData] = useState(hoje())
  const [responsavelId, setResponsavelId] = useState('')

  /* Cliente e responsavel vem da api, e nao de `mock-data` — um id INVENTADO
     aqui seria pior que a lista vazia: o card gravaria um vinculo que nao
     existe. */
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([])
  const [equipe, setEquipe] = useState<MembroDaEquipe[]>([])

  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  /* Esc fecha e a pagina nao rola por baixo, como nos outros dialogos. */
  const painel = useRef<HTMLDivElement>(null)
  useDialogo(painel, onCancelar, salvando)

  useEffect(() => {
    /* `async` explicito: o `setState` vem depois do await, nunca sincrono no
       corpo do efeito. */
    void (async () => {
      const [rClientes, rEquipe] = await Promise.all([listarClientes({}), listarEquipe()])
      if (rClientes.ok)
        setClientes(rClientes.dados.clientes.map((c) => ({ id: c.id, nome: c.nome })))
      if (rEquipe.ok) setEquipe(rEquipe.dados)
    })()
  }, [])

  async function salvar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)

    if (titulo.trim().length < 2) {
      setErro('Informe o título.')
      return
    }

    setSalvando(true)

    const dados: DadosCard = {
      titulo,
      descricao,
      tipo,
      clienteId: clienteId === '' ? null : clienteId,
      data,
      responsavelId: responsavelId === '' ? null : responsavelId,
    }
    const r = await criarCard(dados)
    setSalvando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onCriado(r.dados)
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
        ref={painel}
        tabIndex={-1}
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-card"
      >
        <h2 id="novo-card" className={styles.dialogTitulo}>
          Nova pendência ou contato
        </h2>

        <form onSubmit={salvar} noValidate className={styles.formCampos}>
          <div className={styles.tipoToggle} role="group" aria-label="Tipo">
            <button
              type="button"
              className={`${styles.tipoBotao} ${tipo === 'pendencia' ? styles.tipoAtivo : ''}`}
              onClick={() => setTipo('pendencia')}
              aria-pressed={tipo === 'pendencia'}
            >
              Pendência
            </button>
            <button
              type="button"
              className={`${styles.tipoBotao} ${tipo === 'contato' ? styles.tipoAtivo : ''}`}
              onClick={() => setTipo('contato')}
              aria-pressed={tipo === 'contato'}
            >
              Contato
            </button>
          </div>

          <label className={styles.campo}>
            <span>Título</span>
            <input
              className={styles.input}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Cobrar pedido 8874"
              autoFocus
            />
          </label>

          <label className={styles.campo}>
            <span>Descrição</span>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que precisa ser feito"
              rows={3}
            />
          </label>

          <label className={styles.campo}>
            <span>Cliente</span>
            <select
              className={styles.select}
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              aria-label="Cliente"
            >
              <option value="">Sem cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>Data</span>
              <input
                type="date"
                className={styles.input}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </label>

            <label className={styles.campo}>
              <span>Responsável</span>
              <select
                className={styles.select}
                value={responsavelId}
                onChange={(e) => setResponsavelId(e.target.value)}
                aria-label="Responsável"
              >
                <option value="">Ninguém ainda</option>
                {equipe.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
              {/* Achado do QA: "por que so aparece o Gustavo como responsavel?"
                  A lista e de quem tem acesso a loja; com uma pessoa so na
                  equipe, so ela aparece. */}
              {equipe.length <= 1 ? (
                <small className={styles.campoDica}>
                  Aparece quem tem acesso à loja. Para incluir alguém, convide em{' '}
                  <a href="/app/conexoes">Conexões</a>.
                </small>
              ) : null}
            </label>
          </div>

          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
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
                  Criando...
                </>
              ) : (
                'Criar card'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
