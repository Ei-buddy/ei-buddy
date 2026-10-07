'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  cancelarEvento,
  criarEvento,
  editarEvento,
  DIAS_SEMANA,
  hoje,
  LEMBRETES,
  listarEventos,
  montarMes,
  NOMES_MESES,
  pontasDaGrade,
  type Evento,
} from '@/lib/agenda-api'
import { formatDate } from '@/lib/format'
import { Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import { IconClose, IconPlus } from '@/components/Icons'
import styles from './agenda.module.css'

export default function AgendaView() {
  /*
   * "Hoje" e calculado uma vez na montagem, e nao a cada render.
   *
   * Era a constante `'2026-08-24'`, e a agenda abria congelada naquele dia
   * para sempre. Recalcular a cada render tambem nao serve: a data mudaria no
   * meio de uma interacao para quem deixa a tela aberta na virada, e o dia
   * selecionado pularia sozinho.
   */
  const [referencia] = useState(hoje)
  const [ano, setAno] = useState(() => Number(referencia.slice(0, 4)))
  const [mes, setMes] = useState(() => Number(referencia.slice(5, 7)) - 1)
  const [diaSelecionado, setDiaSelecionado] = useState(referencia)

  const [eventos, setEventos] = useState<Evento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const [criando, setCriando] = useState(false)
  const [cancelando, setCancelando] = useState<Evento | null>(null)
  /* Editar usa o mesmo formulario do cadastro — NR-152. */
  const [editando, setEditando] = useState<Evento | null>(null)
  const [processando, setProcessando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const grade = useMemo(() => montarMes(ano, mes, referencia), [ano, mes, referencia])

  /*
   * O intervalo vem das PONTAS DA GRADE, e nao do mes civil.
   *
   * A grade mostra as bordas das semanas vizinhas; pedir so de 1 a 31 deixaria
   * aqueles dias sem pontinho, e o dia 30 do mes passado apareceria vazio com
   * um compromisso marcado nele.
   */
  const { de, ate } = useMemo(() => pontasDaGrade(grade), [grade])

  const buscar = useCallback(async () => {
    const r = await listarEventos(de, ate)
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    setEventos(r.dados)
  }, [de, ate])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  const porDia = useMemo(() => {
    const mapa = new Map<string, Evento[]>()
    for (const e of eventos) {
      const lista = mapa.get(e.data) ?? []
      lista.push(e)
      mapa.set(e.data, lista)
    }
    /* Ordena por horario dentro de cada dia. */
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    }
    return mapa
  }, [eventos])

  const proximos = useMemo(
    () =>
      eventos
        .filter((e) => e.data >= referencia)
        .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio))
        .slice(0, 5),
    [eventos, referencia],
  )

  const doDia = porDia.get(diaSelecionado) ?? []
  const eventosHoje = porDia.get(referencia) ?? []

  function mudarMes(delta: number) {
    const d = new Date(Date.UTC(ano, mes + delta, 1))
    setAno(d.getUTCFullYear())
    setMes(d.getUTCMonth())
  }

  async function confirmarCancelamento() {
    if (!cancelando) return

    setProcessando(true)
    const r = await cancelarEvento(cancelando.id)
    setProcessando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    /* Some da lista porque o cancelado nao volta na agenda — mas continua
       existindo no banco, e e por isso que o botao diz "cancelar". */
    setEventos((atual) => atual.filter((e) => e.id !== cancelando.id))
    setCancelando(null)
    setToast({ msg: 'Compromisso cancelado.', tone: 'success' })
  }

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Compromissos, entregas e vencimentos"
        actions={
          <Button onClick={() => setCriando(true)}>
            <IconPlus size={17} />
            Novo compromisso
          </Button>
        }
      />

      {erroCarga ? (
        <Card>
          <EmptyState
            title="Não foi possível carregar a agenda"
            description={erroCarga}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  void buscar()
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className={styles.grid}>
        {/* --- Calendario --- */}
        <Card className={styles.calendarioCard}>
          <div className={styles.calendarioTopo}>
            <button
              type="button"
              className={styles.navMes}
              onClick={() => mudarMes(-1)}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <h2 className={styles.mesTitulo}>
              {NOMES_MESES[mes]} de {ano}
            </h2>
            <button
              type="button"
              className={styles.navMes}
              onClick={() => mudarMes(1)}
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>

          <div className={styles.semana} aria-hidden="true">
            {DIAS_SEMANA.map((d) => (
              <span key={d} className={styles.diaSemana}>
                {d}
              </span>
            ))}
          </div>

          <div className={styles.mes}>
            {grade.map((d) => {
              const doDiaLista = porDia.get(d.data) ?? []
              const selecionado = d.data === diaSelecionado

              return (
                <button
                  key={d.data}
                  type="button"
                  className={`${styles.dia} ${d.doMes ? '' : styles.diaForaDoMes} ${
                    d.hoje ? styles.diaHoje : ''
                  } ${selecionado ? styles.diaSelecionado : ''}`}
                  onClick={() => setDiaSelecionado(d.data)}
                  aria-label={`${d.dia} — ${doDiaLista.length} compromisso(s)`}
                  aria-pressed={selecionado}
                >
                  <span className={styles.diaNumero}>{d.dia}</span>
                  {doDiaLista.length > 0 ? (
                    <span className={styles.diaMarcas} aria-hidden="true">
                      {doDiaLista.slice(0, 3).map((e) => (
                        <span key={e.id} className={styles.diaMarca} />
                      ))}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Card>

        {/* --- Dia selecionado --- */}
        <Card title={`Compromissos de ${formatDate(diaSelecionado)}`}>
          {carregando ? (
            <SkeletonLinhas />
          ) : doDia.length === 0 ? (
            <EmptyState
              title="Nada marcado"
              description="Nenhum compromisso neste dia."
              action={
                <Button variant="secondary" onClick={() => setCriando(true)}>
                  <IconPlus size={16} />
                  Marcar algo
                </Button>
              }
            />
          ) : (
            <ul className={styles.eventos}>
              {doDia.map((e) => (
                <li key={e.id} className={styles.evento}>
                  <span className={styles.eventoHora}>
                    {e.horaInicio}
                    {/* Sem hora de fim e o caso normal — "pagar aluguel as 10h"
                        nao dura nada. Melhor vazio que uma duracao inventada. */}
                    {e.horaFim === null ? null : <span>{e.horaFim}</span>}
                  </span>

                  <span className={styles.eventoPrincipal}>
                    <strong>{e.titulo}</strong>
                    {e.descricao ? <span>{e.descricao}</span> : null}
                    {e.local ? <span className={styles.eventoLocal}>{e.local}</span> : null}
                  </span>

                  <span className={styles.eventoTags}>
                    <button
                      type="button"
                      className={styles.eventoEditar}
                      onClick={() => setEditando(e)}
                      aria-label={`Editar ${e.titulo}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={styles.eventoExcluir}
                      onClick={() => setCancelando(e)}
                      aria-label={`Cancelar ${e.titulo}`}
                    >
                      <IconClose size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- Proximos --- */}
        <Card title="Próximos compromissos" className={styles.proximosCard}>
          {eventosHoje.length > 0 ? (
            <p className={styles.destaqueHoje}>
              <strong>{eventosHoje.length}</strong> compromisso(s) hoje
            </p>
          ) : null}

          {proximos.length === 0 ? (
            <EmptyState
              title="Agenda livre"
              /* "Neste periodo" e nao "daqui pra frente": a busca cobre o mes
                 visivel, e prometer o futuro inteiro seria mentira. */
              description="Nada marcado no período mostrado."
            />
          ) : (
            <ul className={styles.proximos}>
              {proximos.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={styles.proximo}
                    onClick={() => {
                      setDiaSelecionado(e.data)
                      const [a, m] = [Number(e.data.slice(0, 4)), Number(e.data.slice(5, 7)) - 1]
                      setAno(a)
                      setMes(m)
                    }}
                  >
                    <span className={styles.proximoData}>
                      <strong>{e.data.slice(8, 10)}</strong>
                      <span>{NOMES_MESES[Number(e.data.slice(5, 7)) - 1]!.slice(0, 3)}</span>
                    </span>
                    <span className={styles.proximoTexto}>
                      <strong>{e.titulo}</strong>
                      <span>
                        {e.data === referencia ? 'hoje' : formatDate(e.data)} · {e.horaInicio}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {criando ? (
        <FormCompromisso
          dataInicial={diaSelecionado}
          onCriado={(novo) => {
            /*
             * Entra na lista com o que o SERVIDOR devolveu, e nao com o que foi
             * digitado: o id e o instante gravado vem de la, e montar o
             * compromisso aqui faria a tela discordar do banco ate o proximo
             * carregamento.
             */
            setEventos((atual) => [...atual, novo])
            setCriando(false)
            setToast({ msg: 'Compromisso criado.', tone: 'success' })
          }}
          onCancelar={() => setCriando(false)}
        />
      ) : null}

      {editando ? (
        <FormCompromisso
          dataInicial={editando.data}
          editando={editando}
          onCriado={(salvo) => {
            /* Troca pelo que o servidor devolveu — a data pode ter mudado de dia. */
            setEventos((atual) => atual.map((e) => (e.id === salvo.id ? salvo : e)))
            setDiaSelecionado(salvo.data)
            setEditando(null)
            setToast({ msg: 'Compromisso salvo.', tone: 'success' })
          }}
          onCancelar={() => setEditando(null)}
        />
      ) : null}

      {cancelando ? (
        <ConfirmarDialog
          titulo="Cancelar compromisso"
          descricao="O compromisso sai da agenda. O registro dele continua guardado."
          tom="perigo"
          rotuloConfirmar="Cancelar compromisso"
          processando={processando}
          detalhe={
            <div className={styles.excluirDetalhe}>
              <strong>{cancelando.titulo}</strong>
              <span>
                {formatDate(cancelando.data)} · {cancelando.horaInicio}
              </span>
            </div>
          }
          onConfirmar={confirmarCancelamento}
          onCancelar={() => setCancelando(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Formulario de compromisso
 * ================================================================== */

function FormCompromisso({
  dataInicial,
  editando,
  onCriado,
  onCancelar,
}: {
  dataInicial: string
  /** Presente = editar este compromisso (NR-152); ausente = marcar um novo. */
  editando?: Evento
  onCriado: (evento: Evento) => void
  onCancelar: () => void
}) {
  const [titulo, setTitulo] = useState(editando?.titulo ?? '')
  const [descricao, setDescricao] = useState(editando?.descricao ?? '')
  const [data, setData] = useState(dataInicial)
  const [horaInicio, setHoraInicio] = useState(editando?.horaInicio ?? '09:00')
  const [horaFim, setHoraFim] = useState(
    editando === undefined ? '10:00' : (editando.horaFim ?? ''),
  )
  const [local, setLocal] = useState(editando?.local ?? '')
  const [lembrete, setLembrete] = useState<number | null>(
    editando === undefined ? 30 : editando.lembreteMinutos,
  )

  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)

    /*
     * As conferencias obvias ficam aqui para o erro chegar sem ida a rede. As
     * MESMAS regras existem no contrato e no banco — nao e duplicacao inutil:
     * a importacao e o WhatsApp entram por outro caminho, e a ultima linha de
     * defesa precisa estar onde o dado mora.
     */
    if (titulo.trim().length < 2) {
      setErro('Informe o título do compromisso.')
      return
    }
    if (data === '') {
      setErro('Escolha a data.')
      return
    }
    if (horaFim !== '' && horaFim <= horaInicio) {
      setErro('O horário de fim precisa ser depois do início.')
      return
    }

    setSalvando(true)
    const dados = {
      titulo,
      descricao,
      data,
      horaInicio,
      horaFim,
      local,
      lembreteMinutos: lembrete,
    }
    const r =
      editando === undefined ? await criarEvento(dados) : await editarEvento(editando.id, dados)
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
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-compromisso"
      >
        <h2 id="novo-compromisso" className={styles.dialogTitulo}>
          {editando === undefined ? 'Novo compromisso' : 'Editar compromisso'}
        </h2>

        <form onSubmit={salvar} noValidate className={styles.formCampos}>
          <label className={styles.campo}>
            <span>Titulo</span>
            <input
              className={styles.input}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Entrega, reunião, cobrança..."
              autoFocus
            />
          </label>

          <label className={styles.campo}>
            <span>Data</span>
            <input
              type="date"
              className={styles.input}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </label>

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>Início</span>
              <input
                type="time"
                className={styles.input}
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
              />
            </label>

            <label className={styles.campo}>
              {/* Vazio e uma resposta: o compromisso pontual nao tem fim. */}
              <span>Fim (opcional)</span>
              <input
                type="time"
                className={styles.input}
                value={horaFim}
                onChange={(e) => setHoraFim(e.target.value)}
              />
            </label>
          </div>

          <label className={styles.campo}>
            <span>Local ou link</span>
            <input
              className={styles.input}
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Endereço ou link da reunião"
            />
          </label>

          <label className={styles.campo}>
            <span>Lembrete no WhatsApp</span>
            <select
              className={styles.input}
              value={lembrete === null ? '' : String(lembrete)}
              onChange={(e) => setLembrete(e.target.value ? Number(e.target.value) : null)}
            >
              {LEMBRETES.map((l) => (
                <option key={l.rotulo} value={l.valor === null ? '' : String(l.valor)}>
                  {l.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.campo}>
            <span>Descricao</span>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
            />
          </label>

          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}

          <div className={styles.dialogAcoes}>
            <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
              Fechar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? (
                <>
                  <Spinner size={15} />
                  Salvando...
                </>
              ) : editando === undefined ? (
                'Criar compromisso'
              ) : (
                'Salvar alterações'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
