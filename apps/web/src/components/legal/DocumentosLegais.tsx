'use client'

import type { PendenciasLegais, TipoDeDocumentoLegal } from '@na-regua/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CAMINHO_DO_DOCUMENTO, DOCUMENTOS, ROTULO_DO_DOCUMENTO } from '@/lib/legal'
import { buscarPendenciasLegais, buscarVersoesLegais } from '@/lib/legal-api'
import styles from './documentos-legais.module.css'

/**
 * Lista dos documentos em vigor e o estado do aceite — RF-01, RF-03.
 *
 * Mostra a versão que o SERVIDOR diz estar em vigor, e não uma constante
 * embutida nesta tela: a versão é o que prova o consentimento, e uma cópia no
 * navegador seria a primeira coisa a ficar velha depois de um deploy parcial.
 */
export default function DocumentosLegais() {
  const [versoes, setVersoes] = useState<Record<string, string>>({})
  const [pendentes, setPendentes] = useState<PendenciasLegais['pendentes']>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    void (async () => {
      const [v, p] = await Promise.all([buscarVersoesLegais(), buscarPendenciasLegais()])
      if (v.ok) setVersoes(v.dados.versoes)
      if (p.ok) setPendentes(p.dados.pendentes)
      setCarregando(false)
    })()
  }, [])

  const estaPendente = (tipo: TipoDeDocumentoLegal) => pendentes.some((p) => p.type === tipo)

  return (
    <ul className={styles.lista}>
      {DOCUMENTOS.map((tipo) => (
        <li key={tipo} className={styles.item}>
          <Link
            href={CAMINHO_DO_DOCUMENTO[tipo]}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.documento}
          >
            {ROTULO_DO_DOCUMENTO[tipo]}
          </Link>
          <span className={styles.estado}>
            {carregando ? (
              /* Espaco reservado: escrever "em dia" antes de saber e mentir
                 por meio segundo sobre a unica coisa que esta tela afirma. */
              <span className={styles.esqueleto} aria-hidden="true" />
            ) : (
              <>
                {versoes[tipo] === undefined ? null : (
                  <span className={styles.versao}>Versão {versoes[tipo]}</span>
                )}
                <span className={estaPendente(tipo) ? styles.pendente : styles.emDia}>
                  {estaPendente(tipo) ? 'Aceite pendente' : 'Aceito'}
                </span>
              </>
            )}
          </span>
        </li>
      ))}

      <li className={styles.item}>
        <Link
          href="/politica-de-cookies"
          target="_blank"
          rel="noreferrer noopener"
          className={styles.documento}
        >
          Política de Cookies
        </Link>
        {/* Sem aceite porque não há o que consentir: um cookie essencial, cuja
            base legal é execução do contrato — a própria página explica. */}
        <span className={styles.versao}>Inventário gerado do código</span>
      </li>
    </ul>
  )
}
