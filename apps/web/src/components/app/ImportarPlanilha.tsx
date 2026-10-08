'use client'

import { useEffect, useRef, useState } from 'react'
import {
  lerCsv,
  type ErroImportacao,
  type PlanilhaLida,
  type RelatorioImportacao,
} from '@/lib/planilha'
import type { ResultadoDaImportacao } from '@/lib/produtos-api'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconClose, IconUpload } from '@/components/Icons'
import styles from './importar.module.css'

export type CampoImportacao = {
  key: string
  label: string
  obrigatorio: boolean
  /** Decide se uma coluna da planilha corresponde a este campo. */
  reconhece: (coluna: string) => boolean
}

type Props = {
  titulo: string
  campos: CampoImportacao[]
  /** Valor que identifica o registro, para detectar repetidos. */
  chaveDuplicidade: (valores: Record<string, string>) => string
  /** Chaves ja existentes na base — usadas para marcar duplicados. */
  chavesExistentes: string[]
  /** Devolve o motivo quando a linha for invalida, ou null quando estiver ok. */
  validar: (valores: Record<string, string>) => string | null
  /**
   * Importa de verdade e devolve o que o SERVIDOR aceitou.
   *
   * Devolvia `void`, e o relatorio era montado com o que o navegador tinha
   * adivinhado na previa: a tela dizia "150 importados" mesmo quando o servidor
   * recusava tudo. Quem manda no numero e quem gravou.
   */
  onConfirmar: (registros: Record<string, string>[]) => Promise<ResultadoDaImportacao>
  onClose: () => void
}

type Etapa = 'arquivo' | 'mapear' | 'relatorio'

/** Quantas linhas aparecem na previa. */
const LINHAS_PREVIA = 5

/**
 * Assistente de importacao compartilhado entre os modulos.
 *
 * Cada modulo passa seus campos, sua regra de validacao e sua chave de
 * duplicidade — o fluxo (arquivo, mapeamento, previa, relatorio) e o mesmo.
 */
export default function ImportarPlanilha({
  titulo,
  campos,
  chaveDuplicidade,
  chavesExistentes,
  validar,
  onConfirmar,
  onClose,
}: Props) {
  const [etapa, setEtapa] = useState<Etapa>('arquivo')
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null)
  const [mapa, setMapa] = useState<Record<string, string>>({})
  const [lendo, setLendo] = useState(false)
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  /* ---------------------------------------------------------------- *
   * Etapa 1 — leitura do arquivo
   * ---------------------------------------------------------------- */

  async function receberArquivo(arquivo: File) {
    setErro(null)
    setLendo(true)

    const nome = arquivo.name.toLowerCase()

    try {
      if (!nome.endsWith('.csv')) {
        setErro(
          nome.endsWith('.xlsx') || nome.endsWith('.xls')
            ? 'Salve a planilha como CSV (no Excel: Arquivo → Salvar como → CSV) e envie de novo.'
            : 'Formato nao suportado. Envie um arquivo .csv.',
        )
        setLendo(false)
        return
      }

      const lida: PlanilhaLida = lerCsv(await arquivo.text())

      if (lida.colunas.length === 0 || lida.linhas.length === 0) {
        setErro('A planilha parece vazia. Confira se há cabeçalho e ao menos uma linha.')
        setLendo(false)
        return
      }

      /* Adivinha o mapeamento pelo nome da coluna — economiza o trabalho
         manual no caso comum, e continua editavel. */
      const automatico: Record<string, string> = {}
      for (const campo of campos) {
        const achou = lida.colunas.find((col) => campo.reconhece(col.toLowerCase()))
        if (achou) automatico[campo.key] = achou
      }

      setPlanilha(lida)
      setMapa(automatico)
      setEtapa('mapear')
    } catch {
      setErro('Não foi possível ler o arquivo.')
    } finally {
      setLendo(false)
    }
  }

  /* ---------------------------------------------------------------- *
   * Etapa 2 — validacao local antes de confirmar
   * ---------------------------------------------------------------- */

  function valoresDa(linha: string[]): Record<string, string> {
    const valores: Record<string, string> = {}
    if (!planilha) return valores

    for (const campo of campos) {
      const coluna = mapa[campo.key]
      if (!coluna) {
        valores[campo.key] = ''
        continue
      }
      const indice = planilha.colunas.indexOf(coluna)
      valores[campo.key] = indice >= 0 ? (linha[indice] ?? '') : ''
    }
    return valores
  }

  const obrigatoriosOk = campos.filter((c) => c.obrigatorio).every((c) => mapa[c.key])

  /**
   * `linhasDeOrigem[i]` e a linha da PLANILHA de onde saiu `validos[i]`.
   *
   * Sem isso o relatorio aponta para a linha errada assim que uma linha e
   * barrada na previa: o servidor devolve um indice sobre a lista que ELE
   * recebeu, e essa lista tem buracos em relacao a planilha. O lojista abriria
   * o arquivo para corrigir um produto que estava certo.
   */
  function analisarLinhas(): {
    validos: Record<string, string>[]
    linhasDeOrigem: number[]
    erros: ErroImportacao[]
  } {
    if (!planilha) return { validos: [], linhasDeOrigem: [], erros: [] }

    const erros: ErroImportacao[] = []
    const validos: Record<string, string>[] = []
    const linhasDeOrigem: number[] = []
    const vistos = new Set(chavesExistentes)

    planilha.linhas.forEach((linha, i) => {
      const valores = valoresDa(linha)
      const rotulo = valores[campos[0].key] || '(sem identificacao)'

      const motivo = validar(valores)
      if (motivo) {
        erros.push({ linha: i + 2, nome: rotulo, motivo, tipo: 'invalido' })
        return
      }

      const chave = chaveDuplicidade(valores)
      if (chave && vistos.has(chave)) {
        erros.push({ linha: i + 2, nome: rotulo, motivo: 'Ja cadastrado', tipo: 'duplicado' })
        return
      }

      if (chave) vistos.add(chave)
      validos.push(valores)
      /* +2: a planilha e base 1 e a primeira linha e o cabecalho. */
      linhasDeOrigem.push(i + 2)
    })

    return { validos, linhasDeOrigem, erros }
  }

  async function confirmar() {
    if (!planilha) return

    setImportando(true)
    const { validos, linhasDeOrigem, erros } = analisarLinhas()

    /*
     * A analise acima e ADIANTAMENTO, nao decisao. O servidor valida de novo —
     * a base pode ter mudado entre a previa e a confirmacao — e o que ele
     * recusar entra no relatorio junto com o que o navegador ja tinha barrado.
     *
     * O numero de importados vem DELE. Antes vinha de `validos.length`, e por
     * isso a tela dizia "150 importados" para uma importacao que nao gravava
     * nada.
     */
    const r = await onConfirmar(validos)

    /* O indice que o servidor devolve aponta para a lista que ELE recebeu; a
       linha da planilha soma o cabecalho e as que nao foram enviadas. */
    const recusadasDoServidor: ErroImportacao[] = r.recusadas.map((rec) => ({
      linha: linhasDeOrigem[rec.index] ?? rec.index + 2,
      nome: rec.description,
      motivo: rec.reason,
      tipo: 'invalido' as const,
    }))

    const todosOsErros = [...erros, ...recusadasDoServidor]

    setRelatorio({
      importados: r.importados,
      ignorados: todosOsErros.length,
      erros: todosOsErros,
    })
    setImportando(false)
    setEtapa('relatorio')
  }

  const previa = planilha?.linhas.slice(0, LINHAS_PREVIA) ?? []
  const analise = etapa === 'mapear' && planilha ? analisarLinhas() : null

  return (
    <div className={styles.root}>
      <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Fechar" />

      <div
        ref={dialogRef}
        className={styles.painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="importar-titulo"
        tabIndex={-1}
      >
        <header className={styles.cabecalho}>
          <h2 id="importar-titulo" className={styles.titulo}>
            {titulo}
          </h2>
          <button type="button" className={styles.fechar} onClick={onClose} aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </header>

        {/* ============ Etapa 1: arquivo ============ */}
        {etapa === 'arquivo' ? (
          <div className={styles.corpo}>
            <p className={styles.texto}>
              Envie um arquivo <strong>.csv</strong> com uma linha de cabeçalho. Na próxima etapa
              você diz qual coluna corresponde a cada campo.
            </p>

            <label className={styles.dropzone}>
              <IconUpload size={26} />
              <strong>Escolher arquivo</strong>
              <span>Aceita .csv (no Excel: Salvar como → CSV)</span>
              <input
                type="file"
                accept=".csv"
                className={styles.fileInput}
                disabled={lendo}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void receberArquivo(f)
                }}
              />
            </label>

            {lendo ? (
              <p className={styles.carregando}>
                <Spinner size={15} />
                Lendo a planilha...
              </p>
            ) : null}

            {erro ? (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ============ Etapa 2: mapear e prever ============ */}
        {etapa === 'mapear' && planilha ? (
          <div className={styles.corpo}>
            <section>
              <h3 className={styles.subtitulo}>De qual coluna vem cada campo</h3>
              <div className={styles.mapa}>
                {campos.map((campo) => (
                  <label key={campo.key} className={styles.mapaLinha}>
                    <span className={styles.mapaCampo}>
                      {campo.label}
                      {campo.obrigatorio ? (
                        <span className={styles.obrigatorio}>obrigatório</span>
                      ) : null}
                    </span>
                    <select
                      className={styles.mapaSelect}
                      value={mapa[campo.key] ?? ''}
                      onChange={(e) => setMapa((m) => ({ ...m, [campo.key]: e.target.value }))}
                    >
                      <option value="">— não importar —</option>
                      {planilha.colunas.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className={styles.subtitulo}>
                Prévia · {planilha.linhas.length} linha(s) no arquivo
              </h3>

              <div className={styles.tabelaWrap}>
                <table className={styles.tabela}>
                  <thead>
                    <tr>
                      {campos.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previa.map((linha, i) => {
                      const valores = valoresDa(linha)
                      return (
                        <tr key={i}>
                          {campos.map((c) => (
                            <td key={c.key}>{valores[c.key] || '—'}</td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {planilha.linhas.length > LINHAS_PREVIA ? (
                <p className={styles.nota}>Mostrando as primeiras {LINHAS_PREVIA} linhas.</p>
              ) : null}
            </section>

            {analise ? (
              <p className={styles.resumo}>
                <strong>{analise.validos.length}</strong> pronta(s) para importar ·{' '}
                <strong>{analise.erros.length}</strong> com problema
              </p>
            ) : null}

            {!obrigatoriosOk ? (
              <p className={styles.erro} role="alert">
                Escolha as colunas dos campos obrigatórios para continuar.
              </p>
            ) : null}

            <div className={styles.acoes}>
              <Button variant="secondary" onClick={() => setEtapa('arquivo')}>
                Trocar arquivo
              </Button>
              <Button onClick={confirmar} disabled={!obrigatoriosOk || importando}>
                {importando ? (
                  <>
                    <Spinner size={15} />
                    Importando...
                  </>
                ) : (
                  'Confirmar importação'
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {/* ============ Etapa 3: relatorio ============ */}
        {etapa === 'relatorio' && relatorio ? (
          <div className={styles.corpo}>
            <div className={styles.placar}>
              <div className={styles.placarItem}>
                <strong className={styles.placarOk}>{relatorio.importados}</strong>
                <span>importados</span>
              </div>
              <div className={styles.placarItem}>
                <strong className={styles.placarAviso}>{relatorio.ignorados}</strong>
                <span>ignorados</span>
              </div>
            </div>

            {relatorio.erros.length > 0 ? (
              <section>
                <h3 className={styles.subtitulo}>O que ficou de fora</h3>
                <ul className={styles.erros}>
                  {relatorio.erros.map((e, i) => (
                    <li key={i} className={styles.erroItem}>
                      <span className={styles.erroLinha}>Linha {e.linha}</span>
                      <span className={styles.erroNome}>{e.nome}</span>
                      <span
                        className={`${styles.erroTag} ${
                          e.tipo === 'duplicado' ? styles.erroTagDup : ''
                        }`}
                      >
                        {e.motivo}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={styles.nota}>
                  Corrija estas linhas na planilha e importe de novo — quem já entrou não será
                  duplicado.
                </p>
              </section>
            ) : (
              <p className={styles.texto}>Tudo certo: nenhuma linha ficou de fora.</p>
            )}

            <div className={styles.acoes}>
              <Button onClick={onClose}>Concluir</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
