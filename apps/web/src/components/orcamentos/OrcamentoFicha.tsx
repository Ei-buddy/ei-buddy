'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { montarOrcamento } from '@/lib/comprovante'
import { carregarEmpresa, type EmpresaCarregada } from '@/lib/empresa-api'
import { formatDate } from '@/lib/format'
import {
  cancelarOrcamento,
  carregarOrcamento,
  ROTULO_SITUACAO,
  type Orcamento,
} from '@/lib/orcamentos-api'
import { maskPhone } from '@/lib/validation'
import { abrirWhatsApp, enderecoDoWeb } from '@/lib/whatsapp'
import { Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import papel from '@/components/vendas/comprovante.module.css'
import styles from './orcamentos.module.css'
import OrcamentoForm from './OrcamentoForm'

const reais = (cents: number) => cents / 100

/**
 * A ficha do orcamento — NR-159.
 *
 * O papel e o mesmo do comprovante (40 colunas): sai na impressora ou vai pelo
 * WhatsApp sem perder o alinhamento. "Converter em venda" abre o PDV com o
 * carrinho montado; a venda segue o caminho normal.
 */
export default function OrcamentoFicha({ id }: { id: string }) {
  const router = useRouter()
  const [orcamento, setOrcamento] = useState<Orcamento | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [empresa, setEmpresa] = useState<EmpresaCarregada | null>(null)
  const [cancelando, setCancelando] = useState(false)
  /* Achado do QA: "o abrir do orcamento deveria permitir o editar". */
  const [editando, setEditando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)
  const [abrindoWhatsApp, setAbrindoWhatsApp] = useState(false)
  /* O navegador barrou a aba do WhatsApp Web: fica o link para clicar. */
  const [whatsAppBloqueado, setWhatsAppBloqueado] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [o, e] = await Promise.all([carregarOrcamento(id), carregarEmpresa()])
      if (o.ok) setOrcamento(o.dados)
      else {
        setOrcamento(null)
        setErro(o.erro)
      }
      if (e.ok) setEmpresa(e.dados)
    })()
  }, [id])

  const texto = useMemo(() => {
    if (!orcamento || empresa === null) return null
    const endereco = [
      [empresa.logradouro, empresa.numero].filter(Boolean).join(', '),
      empresa.bairro,
      [empresa.cidade, empresa.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(' - ')
    const bruto = orcamento.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
    return montarOrcamento({
      loja: {
        nome: empresa.nomeFantasia || empresa.razaoSocial,
        cnpj: empresa.cnpj,
        endereco: endereco === '' ? null : endereco,
        telefone: empresa.celular === '' ? null : maskPhone(`${empresa.ddd}${empresa.celular}`),
      },
      orcamento: {
        numero: orcamento.number,
        emitido: new Date(orcamento.createdAt).toLocaleDateString('pt-BR'),
        validoAte: formatDate(orcamento.validUntil),
        cliente: orcamento.customerName,
        itens: orcamento.items.map((i) => ({
          descricao: i.description,
          quantidade: i.quantity,
          precoUnitario: reais(i.unitPriceCents),
          total: reais(i.quantity * i.unitPriceCents),
        })),
        bruto: reais(bruto),
        desconto: reais(orcamento.discountCents),
        total: reais(orcamento.totalCents),
        observacoes: orcamento.notes,
      },
    })
  }, [orcamento, empresa])

  /**
   * Aplicativo do WhatsApp primeiro; sem ele, o WhatsApp Web — achado do QA.
   * O caminho e a deteccao moram em `lib/whatsapp`.
   */
  async function mandarPeloWhatsApp() {
    if (texto === null) return
    setWhatsAppBloqueado(null)
    setAbrindoWhatsApp(true)
    const caminho = await abrirWhatsApp({ texto })
    setAbrindoWhatsApp(false)
    if (caminho === 'web') {
      setToast({
        msg: 'O aplicativo do WhatsApp não abriu: o orçamento foi para o WhatsApp Web, numa aba nova.',
        tone: 'success',
      })
    } else if (caminho === 'bloqueado') {
      setWhatsAppBloqueado(enderecoDoWeb({ texto }))
    }
  }

  async function compartilhar() {
    if (texto === null || !orcamento) return
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `Orçamento nº ${orcamento.number}`, text: texto })
        return
      }
      await navigator.clipboard.writeText(texto)
      setToast({ msg: 'Orçamento copiado. Cole no WhatsApp ou no e-mail.', tone: 'success' })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setToast({ msg: 'Não deu para compartilhar. Tente o WhatsApp ou imprimir.', tone: 'error' })
    }
  }

  async function cancelar() {
    if (!orcamento) return
    if (!window.confirm(`Cancelar o orçamento nº ${orcamento.number}?`)) return
    setCancelando(true)
    const r = await cancelarOrcamento(orcamento.id)
    setCancelando(false)
    if (!r.ok) return setToast({ msg: r.erro, tone: 'error' })
    setOrcamento(r.dados)
    setToast({ msg: 'Orçamento cancelado.', tone: 'success' })
  }

  if (orcamento === undefined) {
    return (
      <Card>
        <EmptyState title="Carregando..." />
      </Card>
    )
  }
  if (orcamento === null) {
    return (
      <Card>
        <EmptyState title="Não deu para abrir o orçamento" description={erro ?? undefined} />
      </Card>
    )
  }

  const aberto = orcamento.status === 'open'

  return (
    <>
      <div className={papel.semImpressao}>
        <PageHeader
          title={`Orçamento nº ${orcamento.number}`}
          subtitle={`${ROTULO_SITUACAO[orcamento.status]} · não baixa estoque nem lança financeiro`}
          actions={
            <>
              <ButtonLink href="/app/orcamentos" variant="secondary">
                Voltar
              </ButtonLink>
              {orcamento.saleId ? (
                <ButtonLink href={`/app/vendas/${orcamento.saleId}`} variant="secondary">
                  {orcamento.saleNumber ? `Ver venda #${orcamento.saleNumber}` : 'Ver venda'}
                </ButtonLink>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void compartilhar()}
                disabled={texto === null}
              >
                Compartilhar
              </Button>
              <Button
                variant="secondary"
                onClick={() => void mandarPeloWhatsApp()}
                disabled={texto === null || abrindoWhatsApp}
              >
                {abrindoWhatsApp ? 'Abrindo WhatsApp…' : 'WhatsApp'}
              </Button>
              <Button variant="secondary" onClick={() => window.print()} disabled={texto === null}>
                Imprimir
              </Button>
              {aberto && !editando ? (
                <>
                  <Button variant="danger" onClick={() => void cancelar()} disabled={cancelando}>
                    Cancelar
                  </Button>
                  <Button variant="secondary" onClick={() => setEditando(true)}>
                    Editar
                  </Button>
                  <Button onClick={() => router.push(`/app/vendas/nova?orcamento=${orcamento.id}`)}>
                    Converter em venda
                  </Button>
                </>
              ) : null}
            </>
          }
        />
        {whatsAppBloqueado !== null ? (
          <p className={styles.avisoWhatsApp} role="status">
            O aplicativo do WhatsApp não abriu e o navegador bloqueou a aba nova.{' '}
            <a href={whatsAppBloqueado} target="_blank" rel="noopener noreferrer">
              Abrir no WhatsApp Web
            </a>
          </p>
        ) : null}
      </div>

      {editando && aberto ? (
        <div className={papel.semImpressao}>
          <OrcamentoForm
            orcamento={orcamento}
            aoSalvar={(o) => {
              setOrcamento(o)
              setEditando(false)
              setToast({ msg: `Orçamento nº ${o.number} atualizado.`, tone: 'success' })
            }}
            aoErrar={(msg) => setToast({ msg, tone: 'error' })}
            aoCancelar={() => setEditando(false)}
          />
        </div>
      ) : null}

      <div className={papel.mesa}>
        <pre className={papel.papel} aria-label="Orçamento">
          {texto ?? 'Montando o orçamento...'}
        </pre>
      </div>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
