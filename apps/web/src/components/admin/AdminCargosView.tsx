'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, Field, Input } from '@/components/ui/UI'
import { Spinner } from '@/components/auth/Fields'
import { IconArrowRight, IconStore } from '@/components/Icons'
import {
  convidarSuperAdmin,
  listarEmpresas,
  listarUsuariosDaPlataforma,
  revogarSuperAdmin,
  ROTULO_PAPEL,
  type EmpresaListada,
  type PaginaDeUsuarios,
  type UsuarioDaPlataforma,
} from '@/lib/admin-api'
import { carregarPerfil } from '@/lib/perfil-api'
import { formatDateTime } from '@/lib/format'
import EntrarDialog from './EntrarDialog'
import styles from './admin.module.css'
import stylesUsuarios from './usuarios.module.css'

const TAMANHO_DA_PAGINA = 50

/**
 * Cargos e Super Admin — ADR-0007, RF-131, NR-121, NR-122.
 *
 * Uma tela so, e nao duas: "entrar numa loja" e "promover alguem" sao as
 * duas faces do mesmo poder — o de administrar a plataforma inteira — e
 * separa-las em itens de menu diferentes escondia que sao a mesma
 * responsabilidade. Nasceu de duas telas (`Empresas` e `Usuarios`) que a
 * NR-122 tinha colocado lado a lado na barra; esta versao as junta.
 *
 * ## Os dois eixos de permissao, e por que so um vira seletor
 *
 * - **Papel na loja** (`Dono`, `Funcionario`, `Contador`) — aparece ao lado
 *   de cada loja, como informacao. Nao se troca aqui: quem manda no acesso
 *   de uma loja e o dono dela, na tela de Equipe.
 * - **Acesso a plataforma** (`Usuario` / `Super Admin`) — e o seletor.
 *
 * ## Por que o convite por e-mail continua existindo
 *
 * O seletor promove quem JA tem conta. Quem nunca se cadastrou nao aparece
 * na lista — nao ha o que selecionar. O convite por e-mail e o unico
 * caminho para esse caso, e por isso sobrevive como um formulario discreto,
 * e nao unificado ao seletor: sao acoes de natureza diferente (uma cria
 * conta, a outra promove uma que ja existe).
 */
export default function AdminCargosView() {
  const router = useRouter()

  /* --- Empresas: "entrar como" --------------------------------------- */
  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null)
  const [erroEmpresas, setErroEmpresas] = useState<string | null>(null)
  const [buscaEmpresa, setBuscaEmpresa] = useState('')
  const [alvo, setAlvo] = useState<EmpresaListada | null>(null)

  /* --- Usuarios: cargos e acesso de plataforma ------------------------ */
  const [pagina, setPagina] = useState<PaginaDeUsuarios | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [meuUserId, setMeuUserId] = useState<string | null>(null)
  const [mudando, setMudando] = useState<string | null>(null)
  const [recarregar, setRecarregar] = useState(0)

  /* --- Convite por e-mail, para quem ainda nao tem conta -------------- */
  const [convidarAberto, setConvidarAberto] = useState(false)
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [convidando, setConvidando] = useState(false)
  const [erroConvite, setErroConvite] = useState<string | null>(null)
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [e, p] = await Promise.all([listarEmpresas(), carregarPerfil()])

      if (p.ok) setMeuUserId(p.dados.userId)

      if (e.ok) {
        setErroEmpresas(null)
        setEmpresas(e.dados.companies)
      } else {
        setErroEmpresas(e.erro)
      }
    })()
  }, [])

  /* O efeito so busca; quem mexe na busca ou na pagina liga `carregando` —
     setState sincrono no corpo do efeito renderiza em cascata. */
  useEffect(() => {
    void (async () => {
      const r = await listarUsuariosDaPlataforma({
        ...(busca.trim() === '' ? {} : { q: busca.trim() }),
        page: paginaAtual,
        pageSize: TAMANHO_DA_PAGINA,
      })
      setCarregando(false)
      if (r.ok) {
        setErro(null)
        setPagina(r.dados)
      } else {
        setErro(r.erro)
      }
    })()
  }, [busca, paginaAtual, recarregar])

  const termoEmpresa = buscaEmpresa.trim().toLowerCase()
  const empresasFiltradas = (empresas ?? []).filter(
    (e) =>
      termoEmpresa === '' ||
      e.legalName.toLowerCase().includes(termoEmpresa) ||
      (e.tradeName?.toLowerCase().includes(termoEmpresa) ?? false) ||
      e.cnpj.includes(termoEmpresa),
  )

  async function trocarPerfil(usuario: UsuarioDaPlataforma, paraSuperAdmin: boolean) {
    setErro(null)
    setMudando(usuario.userId)

    const r = paraSuperAdmin
      ? await convidarSuperAdmin(usuario.email)
      : await revogarSuperAdmin(usuario.userId)

    setMudando(null)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    /* Recarrega da api em vez de mexer no estado local: `isPlatformAdmin`
       vem do banco, e uma copia otimista mentiria se a concessao falhasse
       por fora (revogado no mesmo instante por outro Super Admin, por
       exemplo). */
    setRecarregar((n) => n + 1)
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
    setRecarregar((n) => n + 1)
  }

  const ultimaPagina = Math.max(1, Math.ceil((pagina?.total ?? 0) / TAMANHO_DA_PAGINA))

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.introTitle}>Cargos e Super Admin</h1>
        <p className={styles.introSubtitle}>
          Entre em qualquer loja com uma justificativa — fica registrado quem, quando e por quê. A
          auditoria de cada loja fica lá dentro, no menu Auditoria.
        </p>
      </div>

      <Card title="Empresas">
        <div className={styles.busca}>
          <Input
            value={buscaEmpresa}
            onChange={(e) => setBuscaEmpresa(e.target.value)}
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
        ) : empresasFiltradas.length === 0 ? (
          <EmptyState
            title="Nenhuma empresa encontrada"
            description={
              buscaEmpresa === ''
                ? 'Ainda não há lojas cadastradas.'
                : 'Tente outro termo de busca.'
            }
          />
        ) : (
          <ul className={styles.lista}>
            {empresasFiltradas.map((e) => (
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

      <Card
        title="Usuários"
        action={
          <button
            type="button"
            className={stylesUsuarios.convidarLink}
            onClick={() => setConvidarAberto((v) => !v)}
          >
            {convidarAberto ? 'Cancelar convite' : 'Convidar por e-mail'}
          </button>
        }
      >
        {convidarAberto ? (
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
        ) : null}

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

        <div className={stylesUsuarios.busca}>
          <Input
            value={busca}
            onChange={(e) => {
              setCarregando(true)
              setBusca(e.target.value)
              setPaginaAtual(1)
            }}
            placeholder="Buscar por nome ou e-mail..."
            aria-label="Buscar usuário"
          />
        </div>

        {erro !== null ? (
          <EmptyState title="Não deu para carregar os usuários" description={erro} />
        ) : carregando && pagina === null ? (
          <p className={stylesUsuarios.vazio}>Carregando...</p>
        ) : pagina === null || pagina.users.length === 0 ? (
          <EmptyState
            title="Nenhum usuário encontrado"
            description={busca === '' ? 'Ainda não há contas.' : 'Tente outro termo de busca.'}
          />
        ) : (
          <ul className={`${stylesUsuarios.lista} ${carregando ? stylesUsuarios.atualizando : ''}`}>
            {pagina.users.map((u) => (
              <li key={u.userId} className={stylesUsuarios.linha}>
                <span className={stylesUsuarios.avatar} aria-hidden="true">
                  {iniciais(u.name)}
                </span>

                <div className={stylesUsuarios.identidade}>
                  <span className={stylesUsuarios.nome}>
                    {u.name}
                    {u.userId === meuUserId ? (
                      <span className={stylesUsuarios.voce}> (você)</span>
                    ) : null}
                  </span>
                  <span className={stylesUsuarios.email}>{u.email}</span>
                  <span className={stylesUsuarios.acesso}>
                    {u.lastAccessAt === null
                      ? 'Nunca entrou'
                      : `Último acesso: ${formatDateTime(u.lastAccessAt)}`}
                  </span>
                </div>

                <div className={stylesUsuarios.lojas}>
                  {u.companies.length === 0 ? (
                    <span className={stylesUsuarios.semLoja}>Sem loja</span>
                  ) : (
                    u.companies.map((c) => (
                      <span key={c.companyId} className={stylesUsuarios.loja}>
                        {c.name}
                        <span className={stylesUsuarios.papel}>{ROTULO_PAPEL[c.role]}</span>
                      </span>
                    ))
                  )}
                </div>

                <div className={stylesUsuarios.perfil}>
                  {!u.isActive ? <Badge tone="warning">Inativa</Badge> : null}

                  {u.userId === meuUserId ? (
                    /* A api recusa auto-revogacao (e a guarda que impede a
                       plataforma de ficar sem dono); o seletor aqui so
                       ofereceria um clique que sempre falha. */
                    <Badge tone="info">Super Admin</Badge>
                  ) : (
                    <select
                      className={stylesUsuarios.seletor}
                      aria-label={`Perfil de ${u.name}`}
                      disabled={mudando !== null}
                      value={u.isPlatformAdmin ? 'super-admin' : 'comum'}
                      onChange={(e) => void trocarPerfil(u, e.target.value === 'super-admin')}
                    >
                      <option value="comum">Usuário — acesso à própria loja</option>
                      <option value="super-admin">Super Admin — acesso total</option>
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {pagina !== null && ultimaPagina > 1 ? (
          <div className={stylesUsuarios.paginacao}>
            <button
              type="button"
              className={stylesUsuarios.paginacaoBotao}
              disabled={paginaAtual <= 1}
              onClick={() => {
                setCarregando(true)
                setPaginaAtual((p) => p - 1)
              }}
            >
              Anterior
            </button>
            <span className={stylesUsuarios.paginacaoInfo}>
              Página {paginaAtual} de {ultimaPagina} · {pagina.total} usuário(s)
            </span>
            <button
              type="button"
              className={stylesUsuarios.paginacaoBotao}
              disabled={paginaAtual >= ultimaPagina}
              onClick={() => {
                setCarregando(true)
                setPaginaAtual((p) => p + 1)
              }}
            >
              Próxima
            </button>
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

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? '?'
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}
