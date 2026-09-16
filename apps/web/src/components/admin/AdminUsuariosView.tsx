'use client'

import { useEffect, useState } from 'react'
import {
  convidarSuperAdmin,
  listarUsuariosDaPlataforma,
  revogarSuperAdmin,
  ROTULO_PAPEL,
  type PaginaDeUsuarios,
  type UsuarioDaPlataforma,
} from '@/lib/admin-api'
import { carregarPerfil } from '@/lib/perfil-api'
import { formatDateTime } from '@/lib/format'
import { Badge, Card, EmptyState, Input, PageHeader } from '@/components/ui/UI'
import styles from './usuarios.module.css'

const TAMANHO_DA_PAGINA = 50

/**
 * Usuarios da plataforma — NR-121.
 *
 * ## O que esta tela troca, e o que ela nao troca
 *
 * O seletor muda o acesso a PLATAFORMA: comum ou Super Admin. O papel dentro
 * da loja (dono, funcionario, contador) aparece ao lado, como informacao, e
 * nao vira seletor: quem decide o acesso de uma loja e o dono dela, na tela de
 * Equipe. Misturar os dois eixos num controle so faria parecer que promover
 * alguem a Super Admin o tira da loja, ou o contrario.
 *
 * ## Por que nao ha confirmacao ao promover, e ha ao tirar
 *
 * Conceder e reversivel na mesma tela, num clique. Tirar o proprio acesso nao
 * seria — por isso a api recusa auto-revogacao, e a tela nem oferece.
 */
export default function AdminUsuariosView() {
  const [pagina, setPagina] = useState<PaginaDeUsuarios | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [paginaAtual, setPaginaAtual] = useState(1)

  /** Quem sou eu — para nao oferecer troca de perfil na propria linha. */
  const [meuUserId, setMeuUserId] = useState<string | null>(null)
  const [mudando, setMudando] = useState<string | null>(null)
  const [recarregar, setRecarregar] = useState(0)

  useEffect(() => {
    void (async () => {
      const p = await carregarPerfil()
      if (p.ok) setMeuUserId(p.dados.userId)
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
    /* Recarrega da api em vez de mexer no estado local: `isPlatformAdmin` vem
       do banco, e uma copia otimista mentiria se a concessao falhasse por
       fora (revogado no mesmo instante por outro Super Admin, por exemplo). */
    setRecarregar((n) => n + 1)
  }

  const ultimaPagina = Math.max(1, Math.ceil((pagina?.total ?? 0) / TAMANHO_DA_PAGINA))

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Todo mundo com conta na plataforma. Aqui você promove alguém a Super Admin, ou tira o acesso."
      />

      <Card>
        <div className={styles.busca}>
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
          <p className={styles.vazio}>Carregando...</p>
        ) : pagina === null || pagina.users.length === 0 ? (
          <EmptyState
            title="Nenhum usuário encontrado"
            description={busca === '' ? 'Ainda não há contas.' : 'Tente outro termo de busca.'}
          />
        ) : (
          <ul className={`${styles.lista} ${carregando ? styles.atualizando : ''}`}>
            {pagina.users.map((u) => (
              <li key={u.userId} className={styles.linha}>
                <span className={styles.avatar} aria-hidden="true">
                  {iniciais(u.name)}
                </span>

                <div className={styles.identidade}>
                  <span className={styles.nome}>
                    {u.name}
                    {u.userId === meuUserId ? <span className={styles.voce}> (você)</span> : null}
                  </span>
                  <span className={styles.email}>{u.email}</span>
                  <span className={styles.acesso}>
                    {u.lastAccessAt === null
                      ? 'Nunca entrou'
                      : `Último acesso: ${formatDateTime(u.lastAccessAt)}`}
                  </span>
                </div>

                <div className={styles.lojas}>
                  {u.companies.length === 0 ? (
                    <span className={styles.semLoja}>Sem loja</span>
                  ) : (
                    u.companies.map((c) => (
                      <span key={c.companyId} className={styles.loja}>
                        {c.name}
                        <span className={styles.papel}>{ROTULO_PAPEL[c.role]}</span>
                      </span>
                    ))
                  )}
                </div>

                <div className={styles.perfil}>
                  {!u.isActive ? <Badge tone="warning">Inativa</Badge> : null}

                  {u.userId === meuUserId ? (
                    /* A api recusa auto-revogacao (e a guarda que impede a
                       plataforma de ficar sem dono); o seletor aqui so
                       ofereceria um clique que sempre falha. */
                    <Badge tone="info">Super Admin</Badge>
                  ) : (
                    <select
                      className={styles.seletor}
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
          <div className={styles.paginacao}>
            <button
              type="button"
              className={styles.paginacaoBotao}
              disabled={paginaAtual <= 1}
              onClick={() => {
                setCarregando(true)
                setPaginaAtual((p) => p - 1)
              }}
            >
              Anterior
            </button>
            <span className={styles.paginacaoInfo}>
              Página {paginaAtual} de {ultimaPagina} · {pagina.total} usuário(s)
            </span>
            <button
              type="button"
              className={styles.paginacaoBotao}
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
    </>
  )
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? '?'
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}
