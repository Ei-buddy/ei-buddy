'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Field, Input } from '@/components/ui/UI'
import { Spinner } from '@/components/auth/Fields'
import { IconArrowRight, IconStore, IconUsers } from '@/components/Icons'
import {
  convidarSuperAdmin,
  revogarSuperAdmin,
  listarEmpresas,
  listarSuperAdmins,
  type EmpresaListada,
  type SuperAdmin,
} from '@/lib/admin-api'
import { carregarPerfil } from '@/lib/perfil-api'
import EntrarDialog from './EntrarDialog'
import styles from './admin.module.css'

/**
 * O painel do Super Admin — ADR-0007, RF-131.
 *
 * Duas listas: as empresas (para "entrar como") e quem mais e Super Admin
 * (para conceder o mesmo acesso). Nenhuma das duas usa `AppShell` — ver o
 * comentario em `app/admin/layout.tsx`.
 */
export default function AdminView() {
  const router = useRouter()

  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null)
  const [erroEmpresas, setErroEmpresas] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [admins, setAdmins] = useState<SuperAdmin[] | null>(null)
  const [erroAdmins, setErroAdmins] = useState<string | null>(null)

  const [alvo, setAlvo] = useState<EmpresaListada | null>(null)

  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [convidando, setConvidando] = useState(false)
  const [erroConvite, setErroConvite] = useState<string | null>(null)
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null)

  /** Quem sou eu — para nao oferecer "revogar" na propria linha. */
  const [meuUserId, setMeuUserId] = useState<string | null>(null)
  const [revogando, setRevogando] = useState<string | null>(null)

  /** So para o refresh depois de um convite — a carga inicial vai direto no efeito abaixo. */
  async function carregarAdmins() {
    const r = await listarSuperAdmins()
    if (!r.ok) {
      setErroAdmins(r.erro)
      return
    }
    setErroAdmins(null)
    setAdmins(r.dados.admins)
  }

  useEffect(() => {
    void (async () => {
      const [e, a, p] = await Promise.all([listarEmpresas(), listarSuperAdmins(), carregarPerfil()])

      /* Falha em silencio: sem saber quem sou, o botao aparece na propria
         linha e a api recusa com mensagem clara. Pior seria esconder a tela. */
      if (p.ok) setMeuUserId(p.dados.userId)

      if (e.ok) {
        setErroEmpresas(null)
        setEmpresas(e.dados.companies)
      } else {
        setErroEmpresas(e.erro)
      }

      if (a.ok) {
        setErroAdmins(null)
        setAdmins(a.dados.admins)
      } else {
        setErroAdmins(a.erro)
      }
    })()
  }, [])

  const termo = busca.trim().toLowerCase()
  const filtradas = (empresas ?? []).filter(
    (e) =>
      termo === '' ||
      e.legalName.toLowerCase().includes(termo) ||
      (e.tradeName?.toLowerCase().includes(termo) ?? false) ||
      e.cnpj.includes(termo),
  )

  async function revogar(a: SuperAdmin) {
    setErroAdmins(null)
    setRevogando(a.userId)

    const r = await revogarSuperAdmin(a.userId)

    setRevogando(null)
    if (!r.ok) {
      setErroAdmins(r.erro)
      return
    }
    await carregarAdmins()
  }

  async function convidar(event: FormEvent) {
    event.preventDefault()
    if (email.trim() === '') return

    setConvidando(true)
    setErroConvite(null)
    setSenhaGerada(null)

    const r = await convidarSuperAdmin(email.trim(), nome.trim() || undefined)
    setConvidando(false)

    if (!r.ok) {
      setErroConvite(r.erro)
      return
    }

    setEmail('')
    setNome('')
    if (r.dados.temporaryPassword !== undefined) setSenhaGerada(r.dados.temporaryPassword)
    await carregarAdmins()
  }

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.introTitle}>Painel do Super Admin</h1>
        <p className={styles.introSubtitle}>
          Entre em qualquer loja com uma justificativa — fica registrado quem, quando e por quê.
        </p>
      </div>

      <Card title="Empresas">
        <div className={styles.busca}>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CNPJ..."
            aria-label="Buscar empresa"
          />
        </div>

        {empresas === null ? (
          erroEmpresas !== null ? (
            <EmptyState title="Não deu para carregar as empresas" description={erroEmpresas} />
          ) : (
            <p className={styles.introSubtitle}>Carregando...</p>
          )
        ) : filtradas.length === 0 ? (
          <EmptyState
            title="Nenhuma empresa encontrada"
            description={
              busca === '' ? 'Ainda não há lojas cadastradas.' : 'Tente outro termo de busca.'
            }
          />
        ) : (
          <ul className={styles.lista}>
            {filtradas.map((e) => (
              <li key={e.id} className={styles.linha}>
                <IconStore size={20} />
                <div className={styles.linhaTexto}>
                  <span className={styles.linhaTitulo}>{e.tradeName ?? e.legalName}</span>
                  <span className={styles.linhaDetalhe}>{e.cnpj}</span>
                </div>
                {!e.isActive ? <Badge tone="warning">Inativa</Badge> : null}
                <Button size="sm" variant="secondary" onClick={() => setAlvo(e)}>
                  Entrar
                  <IconArrowRight size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Super Admins">
        {admins === null ? (
          erroAdmins !== null ? (
            <EmptyState title="Não deu para carregar os Super Admins" description={erroAdmins} />
          ) : (
            <p className={styles.introSubtitle}>Carregando...</p>
          )
        ) : (
          <ul className={styles.lista}>
            {admins.map((a) => (
              <li key={a.userId} className={styles.linha}>
                <IconUsers size={20} />
                <div className={styles.linhaTexto}>
                  <span className={styles.linhaTitulo}>{a.name}</span>
                  <span className={styles.linhaDetalhe}>{a.email}</span>
                </div>
                {/* Nao aparece na propria linha: a api tambem recusa, mas um
                    botao que sempre falha e pior que botao nenhum. */}
                {meuUserId === a.userId ? (
                  <span className={styles.linhaDetalhe}>você</span>
                ) : (
                  <button
                    type="button"
                    className={styles.revogar}
                    onClick={() => void revogar(a)}
                    disabled={revogando !== null}
                  >
                    {revogando === a.userId ? 'Revogando...' : 'Revogar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className={styles.conviteForm} onSubmit={(e) => void convidar(e)}>
          <div className={styles.conviteCampo}>
            <Field label="E-mail de quem vai entrar">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@naregua.com"
                disabled={convidando}
                required
              />
            </Field>
          </div>
          <div className={styles.conviteCampo}>
            <Field label="Nome (se a conta ainda não existe)">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Opcional"
                disabled={convidando}
              />
            </Field>
          </div>
          <Button type="submit" disabled={convidando || email.trim() === ''}>
            {convidando ? (
              <>
                <Spinner size={15} />
                Enviando...
              </>
            ) : (
              'Tornar Super Admin'
            )}
          </Button>
        </form>

        {erroConvite !== null ? (
          <p role="alert" className={styles.dialogErro}>
            {erroConvite}
          </p>
        ) : null}

        {senhaGerada !== null ? (
          <div className={styles.senhaBox}>
            <span className={styles.senhaBoxLabel}>
              Conta criada. Senha temporária — repasse por um canal seguro, ela não aparece de novo:
            </span>
            <span className={styles.senhaBoxValor}>{senhaGerada}</span>
          </div>
        ) : null}
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
