'use client'

import { useEffect, useMemo, useState } from 'react'
import { montarComprovante } from '@/lib/comprovante'
import { carregarEmpresa, type EmpresaCarregada } from '@/lib/empresa-api'
import { FORMAS, type VendaDoHistorico } from '@/lib/vendas-api'
import { maskPhone } from '@/lib/validation'
import { PageHeader } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import styles from './comprovante.module.css'

const rotuloDaForma = (f: string) => FORMAS.find((x) => x.valor === f)?.rotulo ?? f

/** No fuso de quem imprime — e o que o cliente olha no relogio do balcao. */
const quando = (iso: string) =>
  new Date(iso)
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(', ', ' ')

/**
 * Comprovante de venda NAO fiscal — NR-154.
 *
 * O texto e o mesmo que o app manda pelo WhatsApp (`lib/comprovante.ts`). Aqui
 * ele sai num papel de bobina na tela, com "Imprimir" (so o papel vai para a
 * impressora) e "Compartilhar" (menu do sistema, ou copia, se o navegador nao
 * tiver).
 */
export default function ComprovanteVenda({ venda }: { venda: VendaDoHistorico }) {
  const [empresa, setEmpresa] = useState<EmpresaCarregada | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await carregarEmpresa()
      if (r.ok) setEmpresa(r.dados)
    })()
  }, [])

  const texto = useMemo(() => {
    if (empresa === null) return null
    const endereco = [
      [empresa.logradouro, empresa.numero].filter(Boolean).join(', '),
      empresa.bairro,
      [empresa.cidade, empresa.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(' - ')
    return montarComprovante({
      loja: {
        nome: empresa.nomeFantasia || empresa.razaoSocial,
        cnpj: empresa.cnpj,
        endereco: endereco === '' ? null : endereco,
        telefone: empresa.celular === '' ? null : maskPhone(`${empresa.ddd}${empresa.celular}`),
      },
      venda: {
        numero: venda.numero,
        quando: quando(venda.data),
        cliente: venda.clienteNome,
        itens: venda.itens.map((i) => ({
          descricao: i.descricao,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          total: i.total,
        })),
        bruto: venda.bruto,
        desconto: venda.desconto,
        total: venda.total,
        pagamentos: venda.pagamentos.map((p) => ({
          forma: rotuloDaForma(p.forma),
          valor: p.valor,
          parcelas: p.parcelas,
        })),
        situacao:
          venda.status === 'cancelled'
            ? 'cancelada'
            : venda.status === 'returned'
              ? 'devolvida'
              : 'normal',
      },
    })
  }, [empresa, venda])

  async function compartilhar() {
    if (texto === null) return
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `Comprovante #${venda.numero}`, text: texto })
        return
      }
      await navigator.clipboard.writeText(texto)
      setToast({ msg: 'Comprovante copiado. Cole no WhatsApp ou no e-mail.', tone: 'success' })
    } catch (e) {
      /* Fechar o menu de compartilhar nao e erro. */
      if (e instanceof DOMException && e.name === 'AbortError') return
      setToast({ msg: 'Não deu para compartilhar. Tente imprimir.', tone: 'error' })
    }
  }

  return (
    <>
      <div className={styles.semImpressao}>
        <PageHeader
          title={`Comprovante da venda #${venda.numero}`}
          subtitle="Não é documento fiscal. Para nota, emita a NFC-e na venda."
          actions={
            <>
              <ButtonLink href={`/app/vendas/${venda.id}`} variant="secondary">
                Voltar
              </ButtonLink>
              <Button
                variant="secondary"
                onClick={() => void compartilhar()}
                disabled={texto === null}
              >
                Compartilhar
              </Button>
              <Button onClick={() => window.print()} disabled={texto === null}>
                Imprimir
              </Button>
            </>
          }
        />
      </div>

      <div className={styles.mesa}>
        <pre className={styles.papel} aria-label="Comprovante">
          {texto ?? 'Montando o comprovante...'}
        </pre>
      </div>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
