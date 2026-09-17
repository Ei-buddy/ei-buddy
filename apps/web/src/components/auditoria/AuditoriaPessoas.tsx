'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listarPessoasDaTrilha, type PessoaDaTrilha } from '@/lib/auditoria-api'
import { formatDateTime } from '@/lib/format'
import { Card, EmptyState, Input, PageHeader } from '@/components/ui/UI'
import { IconArrowRight } from '@/components/Icons'
import styles from './auditoria.module.css'

/**
 * A auditoria comeca por QUEM — US-061.
 *
 * Antes, a tela abria com a trilha inteira: centenas de linhas soltas de todo
 * mundo, misturadas, e quem audita nao comeca assim. A pergunta real e "o que
 * o fulano andou fazendo", entao a primeira tela e a lista de pessoas — e a
 * trilha de cada uma abre ja recortada, num clique.
 *
 * Quem nao existe mais continua na lista, sem nome: `actor_id` nao tem chave
 * estrangeira de proposito, e "o que o funcionario que saiu fez" e uma das
 * perguntas que a trilha existe para responder.
 */
export default function AuditoriaPessoas() {
  const [pessoas, setPessoas] = useState<PessoaDaTrilha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    void (async () => {
      const r = await listarPessoasDaTrilha()
      if (r.ok) {
        setErro(null)
        setPessoas(r.dados.actors)
      } else {
        setErro(r.erro)
      }
    })()
  }, [])

  const termo = busca.trim().toLowerCase()
  const filtradas = (pessoas ?? []).filter(
    (p) => termo === '' || (p.actorName ?? 'usuário removido').toLowerCase().includes(termo),
  )

  return (
    <>
      <PageHeader
        title="Auditoria"
        subtitle="Escolha uma pessoa para ver o que ela fez na loja. Nenhum registro pode ser apagado ou editado."
      />

      <Card>
        {pessoas !== null && pessoas.length > 3 ? (
          <div className={styles.busca}>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa..."
              aria-label="Buscar pessoa"
            />
          </div>
        ) : null}

        {erro !== null ? (
          <EmptyState title="Não deu para carregar a auditoria" description={erro} />
        ) : pessoas === null ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : filtradas.length === 0 ? (
          <EmptyState
            title={busca === '' ? 'Nada registrado ainda' : 'Ninguém com esse nome'}
            description={
              busca === ''
                ? 'Assim que alguém mexer em algo na loja, aparece aqui.'
                : 'Tente outro termo de busca.'
            }
          />
        ) : (
          <ul className={styles.pessoas}>
            {filtradas.map((p) => (
              <li key={p.actorId}>
                <Link href={`/app/auditoria/${p.actorId}`} className={styles.pessoa}>
                  <span className={styles.pessoaAvatar} aria-hidden="true">
                    {iniciais(p.actorName)}
                  </span>

                  <span className={styles.pessoaTexto}>
                    <span className={styles.pessoaNome}>{p.actorName ?? 'Usuário removido'}</span>
                    <span className={styles.pessoaDetalhe}>
                      Última ação em {formatDateTime(p.lastActionAt)}
                    </span>
                  </span>

                  <span className={styles.pessoaContagem}>
                    {p.entries} {p.entries === 1 ? 'ação' : 'ações'}
                  </span>
                  <IconArrowRight size={16} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function iniciais(nome: string | null): string {
  if (nome === null) return '—'
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? '?'
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}
