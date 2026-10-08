'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carregarFila,
  carregarSugestoes,
  conciliar,
  criarLancamentoDaTransacao,
  desfazerConciliacao,
  importarExtrato,
  type RecorteDaFila,
  type Sugestao,
  type TransacaoBancaria,
} from '@/lib/conciliacao-api'
import { formatDate, formatMoney } from '@/lib/format'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Stat,
  Textarea,
} from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { IconUpload } from '@/components/Icons'
import styles from './conciliacao.module.css'

/**
 * Conciliacao bancaria — NR-076, RF-076 a RF-080.
 *
 * A tela nao decide nada sobre o que casa com o que. A janela de datas, a
 * comparacao com o valor bruto ou com o liquido e a confianca de cada sugestao
 * vem do servidor — repetir qualquer uma dessas regras aqui criaria uma segunda
 * resposta para "isto bate?", e a divergencia apareceria como conferencia feita.
 */

/** Centavos para reais na borda: a tela inteira trabalha em reais. */
const emReais = (centavos: number) => centavos / 100

export default function ConciliacaoView() {
  const [recorte, setRecorte] = useState<RecorteDaFila>('pending')
  const [transacoes, setTransacoes] = useState<TransacaoBancaria[]>([])
  const [pendentes, setPendentes] = useState(0)

  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const [conciliando, setConciliando] = useState<TransacaoBancaria | null>(null)
  const [desfazendo, setDesfazendo] = useState<TransacaoBancaria | null>(null)
  const [importando, setImportando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const arquivoRef = useRef<HTMLInputElement>(null)

  const buscar = useCallback(async (scope: RecorteDaFila) => {
    const r = await carregarFila(scope)
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    setTransacoes(r.dados.transactions)
    setPendentes(r.dados.pendingCount)
  }, [])

  useEffect(() => {
    /* O `async` explicito e para o compilador do React: os `setState` de
       `buscar` vem todos depois do await, nunca sincronos no corpo do efeito. */
    void (async () => {
      await buscar(recorte)
    })()
  }, [recorte, buscar])

  const recarregar = () => {
    setCarregando(true)
    setErroCarga(null)
    void buscar(recorte)
  }

  const trocarRecorte = (novo: RecorteDaFila) => {
    if (novo === recorte) return
    setCarregando(true)
    setRecorte(novo)
  }

  async function aoEscolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0]
    /* Limpa o input ANTES de qualquer await: sem isto, escolher o mesmo arquivo
       de novo nao dispara `change` e a segunda tentativa nao acontece — que e
       justamente o que o lojista faz depois de corrigir o extrato. */
    evento.target.value = ''
    if (arquivo === undefined) return

    setImportando(true)
    const r = await importarExtrato(arquivo)
    setImportando(false)

    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }

    const { imported, ignored } = r.dados

    /* As duas frases contam historias opostas, e a segunda e a resposta certa
       para quem importou duas vezes de proposito para conferir. */
    setToast({
      msg:
        imported === 0 && ignored > 0
          ? `Nenhuma nova: as ${ignored} transações do arquivo já estavam aqui.`
          : `${imported} transações importadas${ignored > 0 ? `, ${ignored} já existiam` : ''}.`,
      tone: 'success',
    })

    recarregar()
  }

  const fila = recorte === 'pending'

  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        subtitle="Confira o extrato contra os lançamentos"
        actions={
          <>
            <input
              ref={arquivoRef}
              type="file"
              accept=".ofx,.csv,text/csv"
              onChange={aoEscolherArquivo}
              className={styles.arquivoOculto}
            />
            <Button onClick={() => arquivoRef.current?.click()} disabled={importando}>
              <IconUpload size={16} />
              {importando ? 'Importando...' : 'Importar extrato'}
            </Button>
          </>
        }
      />

      <Card>
        <Stat
          label="Falta conferir"
          value={String(pendentes)}
          hint={pendentes === 0 ? 'Extrato em dia' : 'transações do extrato sem lançamento'}
        />

        <div className={styles.abas}>
          <button
            type="button"
            className={fila ? styles.abaAtiva : styles.aba}
            onClick={() => trocarRecorte('pending')}
          >
            A conferir
          </button>
          <button
            type="button"
            className={fila ? styles.aba : styles.abaAtiva}
            onClick={() => trocarRecorte('reconciled')}
          >
            Já conciliadas
          </button>
        </div>

        {carregando ? (
          <SkeletonLinhas />
        ) : erroCarga !== null ? (
          <EmptyState
            title="Não deu para carregar o extrato"
            description={erroCarga}
            action={
              <Button variant="secondary" onClick={recarregar}>
                Tentar de novo
              </Button>
            }
          />
        ) : transacoes.length === 0 ? (
          <EmptyState
            title={fila ? 'Nada para conferir' : 'Nenhuma conciliação ainda'}
            description={
              fila
                ? 'Importe um extrato em OFX ou CSV para começar a conferência.'
                : 'As transacoes que voce conciliar aparecem aqui, e podem ser desfeitas.'
            }
          />
        ) : (
          <ul className={styles.transacoes}>
            {transacoes.map((t) => (
              <li key={t.id} className={styles.transacao}>
                <div className={styles.principal}>
                  <strong>{t.description}</strong>
                  <span className={styles.contraparte}>{t.counterparty ?? 'Sem contraparte'}</span>
                </div>

                <div className={styles.data}>{formatDate(t.postedOn)}</div>

                <div
                  className={t.direction === 'debit' ? styles.saida : styles.entrada}
                  /* O sinal e a DIRECAO, e nao o valor: o valor e sempre
                     positivo, aqui e no banco. */
                >
                  {t.direction === 'debit' ? '−' : '+'} {formatMoney(emReais(t.amountCents))}
                </div>

                <div className={styles.acao}>
                  {t.reconciledWith === null ? (
                    <Button variant="secondary" onClick={() => setConciliando(t)}>
                      Conciliar
                    </Button>
                  ) : (
                    <>
                      <Badge tone="success">{t.reconciledWith.counterparty}</Badge>
                      <Button variant="secondary" onClick={() => setDesfazendo(t)}>
                        Desfazer
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {conciliando !== null ? (
        <ConciliarDialog
          transacao={conciliando}
          onFechar={() => setConciliando(null)}
          onPronto={(msg) => {
            setConciliando(null)
            setToast({ msg, tone: 'success' })
            recarregar()
          }}
        />
      ) : null}

      {desfazendo !== null ? (
        <DesfazerDialog
          transacao={desfazendo}
          onFechar={() => setDesfazendo(null)}
          onPronto={() => {
            setDesfazendo(null)
            setToast({
              msg: 'Conciliação desfeita. Os dois voltaram para a fila.',
              tone: 'success',
            })
            recarregar()
          }}
        />
      ) : null}

      {toast !== null ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Escolher o lancamento — RF-078, RF-079.
 *
 * Os dois caminhos no mesmo lugar de proposito: sugestao aceita e lancamento
 * criado na hora. Sem o segundo, quem cai numa transacao que ninguem lancou
 * (tarifa do banco, compra na maquininha do fornecedor) teria de sair daqui,
 * lancar adivinhando valor e data, e voltar.
 */
function ConciliarDialog({
  transacao,
  onFechar,
  onPronto,
}: {
  transacao: TransacaoBancaria
  onFechar: () => void
  onPronto: (msg: string) => void
}) {
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [processando, setProcessando] = useState(false)

  const [criando, setCriando] = useState(false)
  const [contraparte, setContraparte] = useState(transacao.counterparty ?? '')
  const [descricao, setDescricao] = useState(transacao.description)

  useEffect(() => {
    void (async () => {
      const r = await carregarSugestoes(transacao.id)
      setCarregando(false)

      if (!r.ok) {
        setErro(r.erro)
        return
      }

      setSugestoes(r.dados.suggestions)
      /* Nada casa: o caminho util e criar o lancamento, entao ele ja abre.
         Mostrar "nenhuma sugestao" e um botao a mais seria um clique cobrado
         por uma informacao que a tela ja tem. */
      setCriando(r.dados.suggestions.length === 0)
    })()
  }, [transacao.id])

  async function aceitar(s: Sugestao) {
    setProcessando(true)
    setErro(null)

    const r = await conciliar(transacao.id, {
      entryKind: s.entry.entryKind,
      entryId: s.entry.id,
    })
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onPronto(`Conciliado com ${s.entry.counterparty}.`)
  }

  async function criar() {
    setProcessando(true)
    setErro(null)

    const r = await criarLancamentoDaTransacao(transacao.id, {
      counterparty: contraparte.trim(),
      description: descricao.trim(),
    })
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onPronto('Lancamento criado e conciliado.')
  }

  return (
    <div className={styles.dialogRoot} role="dialog" aria-modal="true" aria-label="Conciliar">
      <div className={styles.dialogBackdrop} onClick={onFechar} />
      <div className={styles.dialogPainel}>
        <header className={styles.dialogCabecalho}>
          <div>
            <h2 className={styles.dialogTitulo}>Conciliar transação</h2>
            <p className={styles.dialogResumo}>
              {formatDate(transacao.postedOn)} · {transacao.description} ·{' '}
              {formatMoney(emReais(transacao.amountCents))}
            </p>
          </div>
          <button type="button" className={styles.dialogFechar} onClick={onFechar}>
            ×
          </button>
        </header>

        {carregando ? (
          <p className={styles.aviso}>Procurando lançamentos que batem...</p>
        ) : (
          <>
            {sugestoes.length > 0 ? (
              <ul className={styles.sugestoes}>
                {sugestoes.map((s) => (
                  <li key={`${s.entry.entryKind}-${s.entry.id}`} className={styles.sugestao}>
                    <div className={styles.principal}>
                      <strong>{s.entry.counterparty}</strong>
                      <span className={styles.contraparte}>{s.entry.description}</span>
                    </div>

                    <div className={styles.sugestaoDados}>
                      <span>vence {formatDate(s.entry.dueDate)}</span>
                      <span>
                        {s.daysApart === 0 ? 'mesmo dia' : `${s.daysApart} dia(s) de diferença`}
                      </span>
                      {/* So quando difere: o liquido explica por que o extrato
                          traz menos que o titulo (taxa da adquirente, RF-036).
                          Repetir o mesmo numero duas vezes seria ruido. */}
                      {s.expectedAmountCents === s.entry.amountCents ? null : (
                        <span>
                          {formatMoney(emReais(s.entry.amountCents))} bruto, liquido previsto{' '}
                          {formatMoney(emReais(s.expectedAmountCents))}
                        </span>
                      )}
                    </div>

                    <Button onClick={() => void aceitar(s)} disabled={processando}>
                      Conciliar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.aviso}>
                Nenhum lançamento bate com esta transação. Crie-o a partir dela abaixo.
              </p>
            )}

            {criando ? (
              <div className={styles.formCriar}>
                <p className={styles.aviso}>
                  Valor e data saem do extrato e não podem ser mudados aqui — é o que garante que o
                  lançamento corresponde à linha que você está conciliando.
                </p>

                <Field label="Fornecedor ou origem">
                  <Input
                    value={contraparte}
                    onChange={(e) => setContraparte(e.target.value)}
                    placeholder="Quem esta do outro lado"
                  />
                </Field>

                <Field label="Descrição">
                  <Textarea
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    rows={2}
                    placeholder="Para que serviu"
                  />
                </Field>
              </div>
            ) : (
              <button type="button" className={styles.alternativa} onClick={() => setCriando(true)}>
                Nenhuma serve — criar o lançamento a partir desta transação
              </button>
            )}
          </>
        )}

        {erro !== null ? <p className={styles.erro}>{erro}</p> : null}

        <footer className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onFechar} disabled={processando}>
            Cancelar
          </Button>
          {criando ? (
            <Button
              onClick={() => void criar()}
              disabled={processando || contraparte.trim().length < 2 || descricao.trim().length < 2}
            >
              Criar e conciliar
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

/**
 * Desfazer — RF-080.
 *
 * O motivo e obrigatorio, e o campo nasce vazio de proposito: um padrao como
 * "correcao" seria aceito por todo mundo sem pensar, e a trilha registraria que
 * alguem desfez sem dizer por que — que e a unica pergunta que se faz depois.
 */
function DesfazerDialog({
  transacao,
  onFechar,
  onPronto,
}: {
  transacao: TransacaoBancaria
  onFechar: () => void
  onPronto: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar() {
    setProcessando(true)
    setErro(null)

    const r = await desfazerConciliacao(transacao.id, motivo.trim())
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    onPronto()
  }

  return (
    <div className={styles.dialogRoot} role="dialog" aria-modal="true" aria-label="Desfazer">
      <div className={styles.dialogBackdrop} onClick={onFechar} />
      <div className={styles.dialogPainel}>
        <header className={styles.dialogCabecalho}>
          <div>
            <h2 className={styles.dialogTitulo}>Desfazer conciliação</h2>
            {/* O que ela conciliou, e nao so o valor: "desfazer R$ 340,00" nao
                diz se e essa mesmo. */}
            <p className={styles.dialogResumo}>
              {transacao.reconciledWith?.counterparty} · {transacao.reconciledWith?.description} ·
              vence {formatDate(transacao.reconciledWith?.dueDate ?? null)}
            </p>
          </div>
          <button type="button" className={styles.dialogFechar} onClick={onFechar}>
            ×
          </button>
        </header>

        <p className={styles.aviso}>
          A transação e o lançamento voltam para a fila. O lançamento NÃO é apagado.
        </p>

        <Field label="Por que esta desfazendo?">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Casei com a conta errada"
          />
        </Field>

        {erro !== null ? <p className={styles.erro}>{erro}</p> : null}

        <footer className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onFechar} disabled={processando}>
            Cancelar
          </Button>
          <Button
            onClick={() => void confirmar()}
            disabled={processando || motivo.trim().length < 3}
          >
            Desfazer
          </Button>
        </footer>
      </div>
    </div>
  )
}
