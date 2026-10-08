'use client'

import { useEffect, useRef, useState } from 'react'
import {
  type Baixa,
  carregarBaixas,
  estornarBaixa,
  FORMAS_DE_RECEBIMENTO,
  type TipoDeTitulo,
} from '@/lib/financeiro-api'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/auth/Fields'
import { IconClose } from '@/components/Icons'
import styles from './financeiro.module.css'

/** O motivo e obrigatorio no servidor, e o minimo la sao 3 caracteres. */
const MOTIVO_MINIMO = 3

const rotuloDaForma = (m: string | null) =>
  m === null ? null : (FORMAS_DE_RECEBIMENTO.find((f) => f.valor === m)?.rotulo ?? m)

/**
 * Estorno de baixa — RF-067.
 *
 * ## Por que este dialogo lista baixas
 *
 * O que existia aqui era um `ConfirmarDialog` de "estornar o titulo", e essa
 * pergunta nao tem resposta: um titulo pode ter varias baixas — a parcial de
 * ontem e o resto de hoje —, e o servidor estorna UMA. O confirmar antigo
 * chamava uma funcao falsa que respondia `ok` sem tocar no banco, e por isso a
 * ambiguidade nunca aparecia.
 *
 * Com a api de verdade, a escolha e inevitavel. Com uma baixa so — o caso
 * comum — ela ja vem marcada e o dialogo continua sendo "confirmar".
 *
 * ## O historico inteiro aparece, inclusive o que nao da para estornar
 *
 * Linhas de estorno (negativas) e baixas ja estornadas ficam visiveis, apagadas
 * e sem radio. Esconde-las faria a soma da lista discordar do saldo do titulo, e
 * quem abre este dialogo para entender por que o saldo mudou veria justamente o
 * pedaco que explica a mudanca faltando.
 */
export default function EstornoDialog({
  tipo,
  tituloId,
  contraparte,
  descricao,
  onEstornado,
  onCancelar,
}: {
  tipo: TipoDeTitulo
  tituloId: string
  contraparte: string
  descricao: string
  /** A tela recarrega a lista: o saldo e o status quem decide e o servidor. */
  onEstornado: (mensagem: string) => void
  onCancelar: () => void
}) {
  const [baixas, setBaixas] = useState<Baixa[] | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !processando) onCancelar()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onCancelar, processando])

  useEffect(() => {
    let cancelado = false

    void (async () => {
      const r = await carregarBaixas(tipo, tituloId)
      if (cancelado) return

      if (!r.ok) {
        setErroCarga(r.erro)
        setBaixas([])
        return
      }

      setBaixas(r.dados)

      /*
       * Ja marca a primeira estornavel. A lista vem da mais recente para a mais
       * antiga, e "a ultima baixa foi errada" e o motivo de quase toda visita a
       * este dialogo — deixar tudo desmarcado cobraria um clique que ja se sabe
       * qual e.
       */
      const jaEstornadas = new Set(r.dados.map((b) => b.reversesId).filter((id) => id !== null))
      const primeira = r.dados.find((b) => b.amountCents > 0 && !jaEstornadas.has(b.id))
      setEscolhida(primeira?.id ?? null)
    })()

    return () => {
      cancelado = true
    }
  }, [tipo, tituloId])

  const jaEstornadas = new Set((baixas ?? []).map((b) => b.reversesId).filter((id) => id !== null))
  const podeEstornar = (b: Baixa) => b.amountCents > 0 && !jaEstornadas.has(b.id)
  const estornaveis = (baixas ?? []).filter(podeEstornar)

  const motivoValido = motivo.trim().length >= MOTIVO_MINIMO
  const podeConfirmar = escolhida !== null && motivoValido && !processando

  async function confirmar() {
    if (escolhida === null) return

    setProcessando(true)
    setErro(null)

    const r = await estornarBaixa(escolhida, motivo.trim())
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    /* O valor vem do servidor, negativo. O modulo e o que foi devolvido. */
    onEstornado(`Estorno de ${formatMoney(Math.abs(r.dados.amountCents) / 100)} registrado.`)
  }

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={() => !processando && onCancelar()}
        aria-label="Fechar"
      />

      <div
        ref={ref}
        className={`${styles.dialogPainel} ${styles.dialogLargo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="estorno-titulo"
        tabIndex={-1}
      >
        <header className={styles.dialogCabecalho}>
          <h2 id="estorno-titulo" className={styles.dialogTitulo}>
            Estornar baixa
          </h2>
          <button
            type="button"
            className={styles.dialogFechar}
            onClick={onCancelar}
            disabled={processando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className={styles.baixaAlvo}>
          <strong>{contraparte}</strong>
          <span>{descricao}</span>
        </div>

        {baixas === null ? (
          <SkeletonLinhas />
        ) : erroCarga !== null ? (
          <EmptyState title="Não deu para carregar as baixas" description={erroCarga} />
        ) : baixas.length === 0 ? (
          <EmptyState
            title="Este título não tem baixas"
            description="Não há nada para estornar. Se o saldo parece errado, recarregue a lista."
          />
        ) : (
          <>
            <ul className={styles.estornoLista}>
              {baixas.map((b) => {
                const estornavel = podeEstornar(b)
                const negativa = b.amountCents < 0
                const marcada = escolhida === b.id

                /*
                 * Um so `key` por linha e a chave e o id da BAIXA, nunca o
                 * indice: a lista recarrega depois do estorno e a ordem muda.
                 */
                return (
                  <li key={b.id}>
                    <label
                      className={[
                        styles.estornoItem,
                        marcada ? styles.estornoItemAtivo : '',
                        estornavel ? '' : styles.estornoItemInerte,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className={styles.estornoItemTopo}>
                        <span>
                          {/* Sem radio quando ha uma estornavel so: nao ha
                              escolha a fazer, e o controle sugeriria que ha. */}
                          {estornavel && estornaveis.length > 1 ? (
                            <input
                              type="radio"
                              name="baixa-a-estornar"
                              className={styles.estornoItemRadio}
                              checked={marcada}
                              onChange={() => setEscolhida(b.id)}
                              disabled={processando}
                            />
                          ) : null}
                          <span
                            className={`${styles.estornoItemValor} ${
                              negativa ? styles.estornoItemNegativo : ''
                            }`}
                          >
                            {negativa ? '−' : ''}
                            {formatMoney(Math.abs(b.amountCents) / 100)}
                          </span>
                        </span>
                        <span className={styles.estornoItemData}>{formatDate(b.settledOn)}</span>
                      </span>

                      <span className={styles.estornoItemDetalhe}>
                        {negativa
                          ? 'Estorno'
                          : jaEstornadas.has(b.id)
                            ? 'Baixa já estornada'
                            : [rotuloDaForma(b.method), b.bankAccount]
                                .filter(Boolean)
                                .join(' · ') || 'Baixa'}
                        {b.notes !== null && b.notes !== '' ? ` — ${b.notes}` : ''}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>

            {estornaveis.length === 0 ? (
              <p className={styles.baixaRestante}>
                Todas as baixas deste título já foram estornadas. Para baixar de novo, lance uma
                baixa — o estorno de um estorno não existe.
              </p>
            ) : (
              <label className={styles.estornoMotivo}>
                <span>Motivo do estorno</span>
                <textarea
                  className={styles.estornoMotivoInput}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: pagamento lançado na conta errada"
                  maxLength={280}
                  disabled={processando}
                />
                {/* Nao e burocracia: o motivo fica na trilha, e a pergunta que
                    traz alguem ao historico e "por que esse saldo mudou". */}
              </label>
            )}
          </>
        )}

        {erro !== null ? (
          <p className={styles.baixaErro} role="alert">
            {erro}
          </p>
        ) : null}

        <div className={styles.dialogAcoes}>
          <Button variant="secondary" onClick={onCancelar} disabled={processando}>
            {estornaveis.length === 0 ? 'Fechar' : 'Cancelar'}
          </Button>
          {estornaveis.length > 0 ? (
            <Button variant="danger" onClick={confirmar} disabled={!podeConfirmar}>
              {processando ? (
                <>
                  <Spinner size={15} />
                  Estornando...
                </>
              ) : (
                'Estornar'
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
