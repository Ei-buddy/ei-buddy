'use client'

import type { PendenciasLegais } from '@na-regua/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CAMINHO_DO_DOCUMENTO, ROTULO_DO_DOCUMENTO } from '@/lib/legal'
import { aceitarDocumentosLegais, buscarPendenciasLegais } from '@/lib/legal-api'
import styles from './aviso-de-reaceite.module.css'

/**
 * Aviso de documento legal novo — RF-03.
 *
 * ## Por que avisa em vez de bloquear
 *
 * Bloquear o painel inteiro até aceitar transformaria uma atualização de
 * cláusula em indisponibilidade do sistema para quem está no meio de uma
 * venda. Pior: consentimento arrancado como pedágio para voltar a trabalhar
 * não é consentimento livre (LGPD art. 5 XII) — é assinatura sob coação, e
 * vale menos como prova do que o aviso que a pessoa leu e aceitou.
 *
 * O aviso fica no topo, não fecha sozinho e só sai quando a pessoa aceita.
 *
 * ## Por que o texto não está aqui
 *
 * Os links levam às páginas de verdade. Resumir a cláusula dentro do aviso
 * criaria uma segunda versão do documento — a que a pessoa leu de fato — e é
 * exatamente essa divergência que a prova de consentimento não sobrevive.
 */
export default function AvisoDeReaceite() {
  const [pendencias, setPendencias] = useState<PendenciasLegais['pendentes']>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await buscarPendenciasLegais()
      /* Falha silenciosa de propósito: se a consulta não responde, a resposta
         certa é deixar a pessoa trabalhar, e não plantar um alarme sobre algo
         que talvez esteja em dia. O reaceite reaparece no próximo acesso. */
      if (r.ok) setPendencias(r.dados.pendentes)
    })()
  }, [])

  if (pendencias.length === 0) return null

  async function aceitar() {
    setEnviando(true)
    setErro(null)

    const r = await aceitarDocumentosLegais()

    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setPendencias(r.dados.pendentes)
  }

  const houveAceiteAntes = pendencias.some((p) => p.versaoAceitaAntes !== undefined)

  return (
    <div className={styles.aviso} role="region" aria-label="Documentos legais atualizados">
      <div className={styles.texto}>
        <strong className={styles.titulo}>
          {houveAceiteAntes ? 'Atualizamos nossos documentos' : 'Falta aceitar nossos documentos'}
        </strong>{' '}
        <span>
          Leia{' '}
          {pendencias.map((p, i) => (
            <span key={p.type}>
              {i > 0 ? ' e ' : ''}
              <Link
                href={CAMINHO_DO_DOCUMENTO[p.type]}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.link}
              >
                {ROTULO_DO_DOCUMENTO[p.type]}
              </Link>
            </span>
          ))}
          .
        </span>
        {erro === null ? null : <span className={styles.erro}>{erro}</span>}
      </div>

      <button
        type="button"
        className={styles.botao}
        onClick={() => void aceitar()}
        disabled={enviando}
      >
        {enviando ? 'Registrando...' : 'Li e aceito'}
      </button>
    </div>
  )
}
