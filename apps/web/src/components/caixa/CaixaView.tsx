'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  abrirCaixa,
  carregarCaixa,
  carregarHistoricoDoCaixa,
  fecharCaixa,
  movimentarCaixa,
  ROTULO_FORMA,
  type ResumoDoCaixa,
  type SessaoDeCaixa,
} from '@/lib/caixa-api'
import { formatCentavos } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { Card, EmptyState, Field, FormGrid, Input, PageHeader, Stat } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './caixa.module.css'

const quando = (iso: string) =>
  new Date(iso)
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(', ', ' ')

/**
 * Abertura e fechamento de caixa — NR-157.
 *
 * A gaveta: abre com o troco inicial, as vendas em dinheiro entram sozinhas,
 * sangria e suprimento pedem motivo, e o fechamento compara o esperado com o
 * contado. Pix, cartao e carteira aparecem para conferir com a maquininha —
 * nao entram na gaveta.
 */
export default function CaixaView() {
  const [caixa, setCaixa] = useState<ResumoDoCaixa | null | undefined>(undefined)
  const [historico, setHistorico] = useState<SessaoDeCaixa[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    const [c, h] = await Promise.all([carregarCaixa(), carregarHistoricoDoCaixa()])
    if (c.ok) {
      setCaixa(c.dados)
      setErro(null)
    } else setErro(c.erro)
    if (h.ok) setHistorico(h.dados.filter((s) => s.status === 'closed'))
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  const avisar = (msg: string, tone: 'success' | 'error' = 'success') => setToast({ msg, tone })

  return (
    <>
      <PageHeader title="Caixa" subtitle="Abertura, sangria, suprimento e fechamento da gaveta" />

      {erro !== null ? (
        <Card>
          <EmptyState title="Não deu para carregar o caixa" description={erro} />
        </Card>
      ) : caixa === undefined ? (
        <Card>
          <EmptyState title="Carregando..." />
        </Card>
      ) : caixa === null ? (
        <AbrirCaixa
          aoAbrir={() => {
            avisar('Caixa aberto.')
            void carregar()
          }}
          aoErrar={(m) => avisar(m, 'error')}
        />
      ) : (
        <CaixaAberto
          caixa={caixa}
          aoMudar={(m) => {
            avisar(m)
            void carregar()
          }}
          aoErrar={(m) => avisar(m, 'error')}
        />
      )}

      <Card title="Caixas fechados">
        {historico.length === 0 ? (
          <p className={styles.vazio}>Nenhum caixa fechado ainda.</p>
        ) : (
          <ul className={styles.historico}>
            {historico.map((s) => {
              const dif = (s.countedCents ?? 0) - (s.expectedCents ?? 0)
              return (
                <li key={s.id} className={styles.linhaHistorico}>
                  <span>
                    <strong>{quando(s.openedAt)}</strong>
                    <small>até {s.closedAt ? quando(s.closedAt) : '—'}</small>
                  </span>
                  <span>esperado {formatCentavos(s.expectedCents ?? 0)}</span>
                  <span>contado {formatCentavos(s.countedCents ?? 0)}</span>
                  <strong className={dif === 0 ? styles.ok : dif > 0 ? styles.sobra : styles.falta}>
                    {dif === 0
                      ? 'bateu'
                      : `${dif > 0 ? 'sobra' : 'falta'} ${formatCentavos(Math.abs(dif))}`}
                  </strong>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

function AbrirCaixa({ aoAbrir, aoErrar }: { aoAbrir: () => void; aoErrar: (m: string) => void }) {
  const [troco, setTroco] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function abrir(e: FormEvent) {
    e.preventDefault()
    const cents = troco.trim() === '' ? 0 : centavosDoTexto(troco)
    if (cents === null || cents < 0) return aoErrar('Troco inicial inválido.')
    setSalvando(true)
    const r = await abrirCaixa(cents)
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)
    aoAbrir()
  }

  return (
    <Card title="O caixa está fechado">
      <form onSubmit={abrir} noValidate>
        <p className={styles.ajuda}>
          Conte o dinheiro que está na gaveta para começar o dia. As vendas em dinheiro entram
          sozinhas a partir da abertura.
        </p>
        <FormGrid>
          <Field label="Troco inicial" span={4} htmlFor="caixa-troco" obrigatorio>
            <Input
              id="caixa-troco"
              value={troco}
              onChange={(e) => setTroco(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
            />
          </Field>
        </FormGrid>
        <div className={styles.acoes}>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Abrindo...' : 'Abrir caixa'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function CaixaAberto({
  caixa,
  aoMudar,
  aoErrar,
}: {
  caixa: ResumoDoCaixa
  aoMudar: (m: string) => void
  aoErrar: (m: string) => void
}) {
  const dinheiro = caixa.salesByMethod.find((p) => p.method === 'cash')?.amountCents ?? 0
  const outras = caixa.salesByMethod.filter((p) => p.method !== 'cash')

  const [tipo, setTipo] = useState<'withdrawal' | 'deposit'>('withdrawal')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function movimentar(e: FormEvent) {
    e.preventDefault()
    const cents = centavosDoTexto(valor)
    if (cents === null || cents <= 0) return aoErrar('Informe um valor maior que zero.')
    if (motivo.trim().length < 3) return aoErrar('Diga o motivo.')
    setSalvando(true)
    const r = await movimentarCaixa(tipo, cents, motivo)
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)
    setValor('')
    setMotivo('')
    aoMudar(tipo === 'withdrawal' ? 'Sangria registrada.' : 'Suprimento registrado.')
  }

  async function fechar(e: FormEvent) {
    e.preventDefault()
    const cents = centavosDoTexto(contado)
    if (cents === null || cents < 0) return aoErrar('Informe quanto há na gaveta.')
    setSalvando(true)
    const r = await fecharCaixa(cents, obs)
    setSalvando(false)
    if (!r.ok) return aoErrar(r.erro)
    const dif = cents - (r.dados.session.expectedCents ?? 0)
    aoMudar(
      dif === 0
        ? 'Caixa fechado. Bateu certinho.'
        : `Caixa fechado com ${dif > 0 ? 'sobra' : 'falta'} de ${formatCentavos(Math.abs(dif))}.`,
    )
  }

  return (
    <>
      <div className="statRow">
        <Stat
          label="Troco inicial"
          value={formatCentavos(caixa.session.openingCents)}
          hint={`aberto ${quando(caixa.session.openedAt)}`}
        />
        <Stat
          label="Vendas em dinheiro"
          value={formatCentavos(dinheiro)}
          hint={`${caixa.salesCount} venda(s) no caixa, todas as formas`}
        />
        <Stat
          label="Sangria / suprimento"
          value={formatCentavos(caixa.depositsCents - caixa.withdrawalsCents)}
          hint={`−${formatCentavos(caixa.withdrawalsCents)} · +${formatCentavos(caixa.depositsCents)}`}
        />
        <Stat
          label="Esperado na gaveta"
          value={formatCentavos(caixa.expectedCashCents)}
          tone="positive"
        />
      </div>

      <div className={styles.grade}>
        <Card title="Sangria ou suprimento">
          <form onSubmit={movimentar} noValidate>
            <div className={styles.tipos} role="group" aria-label="Tipo de movimento">
              {(
                [
                  ['withdrawal', 'Sangria (tirar)'],
                  ['deposit', 'Suprimento (pôr)'],
                ] as const
              ).map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  className={`${styles.tipo} ${tipo === v ? styles.tipoAtivo : ''}`}
                  aria-pressed={tipo === v}
                  onClick={() => setTipo(v)}
                >
                  {r}
                </button>
              ))}
            </div>
            <FormGrid>
              <Field label="Valor" span={4} htmlFor="mov-valor" obrigatorio>
                <Input
                  id="mov-valor"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Motivo" span={8} htmlFor="mov-motivo" obrigatorio>
                <Input
                  id="mov-motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Depósito no banco, troco extra..."
                  maxLength={280}
                />
              </Field>
            </FormGrid>
            <div className={styles.acoes}>
              <Button type="submit" variant="secondary" disabled={salvando}>
                Registrar
              </Button>
            </div>
          </form>

          {caixa.movements.length > 0 ? (
            <ul className={styles.movimentos}>
              {caixa.movements.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.kind === 'withdrawal' ? 'Sangria' : 'Suprimento'} · {m.reason}
                  </span>
                  <strong>
                    {m.kind === 'withdrawal' ? '−' : '+'}
                    {formatCentavos(m.amountCents)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="Conferir com a maquininha">
          {outras.length === 0 ? (
            <p className={styles.vazio}>Nenhuma venda em Pix, cartão ou carteira neste caixa.</p>
          ) : (
            <ul className={styles.movimentos}>
              {outras.map((p) => (
                <li key={p.method}>
                  <span>{ROTULO_FORMA[p.method]}</span>
                  <strong>{formatCentavos(p.amountCents)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Fechar caixa">
        <form onSubmit={fechar} noValidate>
          <p className={styles.ajuda}>
            Conte o dinheiro da gaveta. O sistema compara com os{' '}
            <strong>{formatCentavos(caixa.expectedCashCents)}</strong> esperados.
          </p>
          <FormGrid>
            <Field label="Contado na gaveta" span={4} htmlFor="caixa-contado" obrigatorio>
              <Input
                id="caixa-contado"
                value={contado}
                onChange={(e) => setContado(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Observação" span={8} htmlFor="caixa-obs">
              <Input
                id="caixa-obs"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                maxLength={500}
              />
            </Field>
          </FormGrid>
          <div className={styles.acoes}>
            <Button type="submit" disabled={salvando}>
              Fechar caixa
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}
