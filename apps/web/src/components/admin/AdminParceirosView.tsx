'use client'

import { useEffect, useState } from 'react'
import {
  aprovarParceiro,
  listarParceirosPendentes,
  recusarParceiro,
  type CandidaturaDeParceiro,
} from '@/lib/partners-api'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import styles from './lista-vip.module.css'

const ROTULO_TIPO_DE_CHAVE: Record<CandidaturaDeParceiro['pixKeyType'], string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  EVP: 'Chave aleatória',
}

/**
 * Painel do Super Admin — aprovação de conta de Parceiro (NR-115, ADR-0013).
 *
 * So mostra a FILA de pendentes — mesma decisao de `partner_application_list_pending`
 * no banco: aprovada ou recusada, a candidatura some da lista (quem quiser
 * historico completo, hoje, consulta pelo banco; nao e RF desta fatia).
 */
export default function AdminParceirosView() {
  const [candidaturas, setCandidaturas] = useState<CandidaturaDeParceiro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [emAcao, setEmAcao] = useState<string | null>(null)

  async function carregar() {
    const r = await listarParceirosPendentes()
    if (r.ok) {
      setErro(null)
      setCandidaturas(r.dados.applications)
    } else {
      setErro(r.erro)
    }
  }

  useEffect(() => {
    void (async () => {
      const r = await listarParceirosPendentes()
      if (r.ok) {
        setErro(null)
        setCandidaturas(r.dados.applications)
      } else {
        setErro(r.erro)
      }
    })()
  }, [])

  async function aprovar(partnerId: string) {
    setEmAcao(partnerId)
    const r = await aprovarParceiro(partnerId)
    setEmAcao(null)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    await carregar()
  }

  async function recusar(partnerId: string) {
    setEmAcao(partnerId)
    const r = await recusarParceiro(partnerId)
    setEmAcao(null)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    await carregar()
  }

  return (
    <>
      <PageHeader title="Parceiros" subtitle="Candidaturas de Parceiro aguardando aprovação" />

      <div className="statRow">
        <Stat label="Aguardando aprovação" value={String(candidaturas?.length ?? '—')} />
      </div>

      {erro !== null ? <EmptyState title="Algo não funcionou" description={erro} /> : null}

      <Card title="Fila de aprovação">
        {candidaturas === null ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : candidaturas.length === 0 ? (
          <EmptyState
            title="Nenhuma candidatura pendente"
            description="Quando alguém se candidatar a Parceiro, a solicitação aparece aqui."
          />
        ) : (
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contato</th>
                  <th>Chave PIX</th>
                  <th>Cupom pretendido</th>
                  <th>Motivo</th>
                  <th>Quando</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {candidaturas.map((c) => (
                  <tr key={c.partnerId}>
                    <td>{c.companyName}</td>
                    <td>
                      {c.companyPhone}
                      <br />
                      {c.companyEmail}
                    </td>
                    <td>
                      {c.pixKey}
                      <br />
                      <span className={styles.vazio}>{ROTULO_TIPO_DE_CHAVE[c.pixKeyType]}</span>
                    </td>
                    <td>{c.couponCode ?? '—'}</td>
                    <td>{c.message}</td>
                    <td>{formatDateTime(c.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={emAcao === c.partnerId}
                          onClick={() => void recusar(c.partnerId)}
                        >
                          Recusar
                        </Button>
                        <Button
                          size="sm"
                          disabled={emAcao === c.partnerId}
                          onClick={() => void aprovar(c.partnerId)}
                        >
                          Aprovar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
