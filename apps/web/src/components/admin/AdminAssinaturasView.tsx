'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Input, PageHeader, type BadgeTone } from '@/components/ui/UI'
import { IconArrowRight, IconStore } from '@/components/Icons'
import { listarEmpresas, type EmpresaListada } from '@/lib/admin-api'
import {
  contarPorGrupo,
  dataQueImporta,
  estaNoGrupo,
  GRUPOS_DE_ASSINATURA,
  ROTULO_DO_ESTADO,
  TOM_DO_ESTADO,
  type GrupoDeAssinatura,
  type Tom,
} from '@/lib/assinatura-api'
import EntrarDialog from './EntrarDialog'
import admin from './admin.module.css'
import styles from './assinaturas.module.css'

/**
 * Assinaturas de todas as lojas — NR-216.
 *
 * Achado do QA (item 18): a plataforma nao enxergava inadimplencia. A lista
 * de empresas nao trazia a assinatura, e a situacao de cada loja so existia
 * dentro dela.
 *
 * Abre em "Inadimplentes" quando ha alguem nessa situacao — e a lista que a
 * equipe abre para cobrar. Sem nenhum, abre em "Todas".
 */

const BADGE: Record<Tom, BadgeTone> = {
  positive: 'success',
  warning: 'warning',
  negative: 'danger',
  neutral: 'neutral',
}

export default function AdminAssinaturasView() {
  const router = useRouter()
  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<GrupoDeAssinatura | null>(null)
  const [busca, setBusca] = useState('')
  const [alvo, setAlvo] = useState<EmpresaListada | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await listarEmpresas()
      if (r.ok) {
        setErro(null)
        setEmpresas(r.dados.companies)
      } else {
        setErro(r.erro)
      }
    })()
  }, [])

  const contagem = contarPorGrupo((empresas ?? []).map((e) => e.subscriptionStatus))
  /* Sem escolha da pessoa ainda: inadimplentes se houver, senao todas. Derivado
     no render, e nao num efeito — a contagem so existe depois da leitura. */
  const grupoAtivo: GrupoDeAssinatura =
    grupo ?? (contagem.inadimplentes > 0 ? 'inadimplentes' : 'todas')

  const termo = busca.trim().toLowerCase()
  const digitos = termo.replace(/\D/g, '')
  const visiveis = (empresas ?? []).filter(
    (e) =>
      estaNoGrupo(e.subscriptionStatus, grupoAtivo) &&
      (termo === '' ||
        e.legalName.toLowerCase().includes(termo) ||
        (e.tradeName?.toLowerCase().includes(termo) ?? false) ||
        (digitos !== '' && e.cnpj.includes(digitos))),
  )

  const semCobranca = empresas !== null && empresas.length > 0 && contagem.sem === empresas.length

  return (
    <>
      <PageHeader
        title="Assinaturas"
        subtitle="Quem está em teste, em dia, atrasado ou restrito — de todas as lojas"
      />

      {semCobranca ? (
        <p className={styles.aviso}>
          Nenhuma loja tem assinatura ainda: a cobrança da mensalidade não foi ligada (falta definir
          preço e prazos). Quando ela ligar, cada loja aparece aqui com a situação dela.
        </p>
      ) : null}

      <div className={styles.filtros} role="tablist" aria-label="Situação da assinatura">
        {GRUPOS_DE_ASSINATURA.map((g) => (
          <button
            key={g.valor}
            type="button"
            role="tab"
            aria-selected={grupoAtivo === g.valor}
            className={`${styles.filtro} ${grupoAtivo === g.valor ? styles.filtroAtivo : ''}`}
            onClick={() => setGrupo(g.valor)}
          >
            {g.rotulo}
            <span className={styles.contagem}>{empresas === null ? '—' : contagem[g.valor]}</span>
          </button>
        ))}
      </div>

      <Card title={GRUPOS_DE_ASSINATURA.find((g) => g.valor === grupoAtivo)?.rotulo ?? 'Lojas'}>
        <div className={admin.busca}>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CNPJ..."
            aria-label="Buscar loja"
          />
        </div>

        {empresas === null ? (
          erro !== null ? (
            <EmptyState title="Não deu para carregar as lojas" description={erro} />
          ) : (
            <p className={admin.introSubtitle}>Carregando...</p>
          )
        ) : visiveis.length === 0 ? (
          <EmptyState
            title="Nenhuma loja aqui"
            description={
              busca === '' ? 'Nenhuma loja nesta situação.' : 'Tente outro termo de busca.'
            }
          />
        ) : (
          <ul className={admin.lista}>
            {visiveis.map((e) => {
              const estado = e.subscriptionStatus ?? 'sem'
              const data = dataQueImporta(e)
              return (
                <li key={e.id} className={admin.linha}>
                  <IconStore size={20} />
                  <div className={admin.linhaTexto}>
                    <span className={admin.linhaTitulo}>{e.tradeName ?? e.legalName}</span>
                    <span className={admin.linhaDetalhe}>{e.cnpj}</span>
                  </div>
                  <div className={styles.situacao}>
                    <Badge tone={BADGE[TOM_DO_ESTADO[estado]]}>{ROTULO_DO_ESTADO[estado]}</Badge>
                    {data !== null ? <span className={styles.data}>{data}</span> : null}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setAlvo(e)}>
                    Entrar
                    <IconArrowRight size={16} />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {alvo !== null ? (
        <EntrarDialog
          empresa={alvo}
          onCancelar={() => setAlvo(null)}
          onEntrou={() => router.push('/app')}
        />
      ) : null}
    </>
  )
}
