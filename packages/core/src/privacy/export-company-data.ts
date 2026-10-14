import {
  exportCollectionSchema,
  type ExportCollection,
  type ExportManifest,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertSegundoCanal } from '../authorization.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ExecutionContext } from '../context.js'
import type { ExportSink, ExportSource } from '../ports/privacy.js'

export type ExportDeps = {
  readonly source: ExportSource
  readonly sink: ExportSink
  readonly audit: AuditTrail
}

export type ExportResult = {
  readonly manifest: ExportManifest
  readonly location: string
}

/** Todas as colecoes que a exportacao precisa cobrir — RF-125. */
export const COLECOES_DA_EXPORTACAO = exportCollectionSchema.options

/**
 * Quantas linhas por ida ao banco.
 *
 * Nem uma por vez, que multiplicaria a latencia por centenas de milhares, nem
 * a colecao inteira, que e o que este desenho existe para evitar. Mil linhas
 * de venda cabem em poucos megabytes.
 */
export const LINHAS_POR_PAGINA = 1_000

/**
 * Exporta tudo que e da empresa — RF-125, US-062.
 *
 * ## Quem pode
 *
 * `owner` e `accountant`. NAO passa por `assertCanWrite`, e nao e descuido:
 * exportar e leitura, e `seguranca.md` diz que o contador tem "acesso somente
 * de leitura e exportacao" — exportar e literalmente o trabalho dele.
 *
 * `staff` fica de fora. Ele opera a loja e nao precisa de uma copia integral
 * da base; dar a ele seria transformar cada funcionario num ponto de
 * exfiltracao completa.
 *
 * Pelo canal do WhatsApp, ninguem — ADR-0002. Uma mensagem que devolve a base
 * inteira e o pior caso de um numero roubado.
 *
 * ## O que este caso de uso deliberadamente NAO faz
 *
 * Nao consulta assinatura nem inadimplencia. A RF-126 exige que a exportacao
 * continue disponivel com a conta bloqueada, e a forma de garantir isso e a
 * AUSENCIA de uma verificacao aqui: bloquear quem nao pagou e retencao de
 * dados como alavanca de cobranca, que e o que a LGPD nao permite. A regra de
 * bloqueio vive em `billing`, e a exportacao e a excecao dela.
 */
export async function exportCompanyData(
  deps: ExportDeps,
  ctx: ExecutionContext,
): Promise<ExportResult> {
  if (ctx.role !== 'owner' && ctx.role !== 'accountant') {
    throw AppError.forbidden('Somente o responsável pela loja e o contador podem exportar a base.')
  }

  assertSegundoCanal(ctx, 'Exportar os dados da empresa')

  confereQueNadaFicouDeFora(deps.source)

  const colecoes: ExportManifest['collections'] = []

  for (const collection of COLECOES_DA_EXPORTACAO) {
    let cursor: string | undefined
    let linhas = 0

    /*
     * Grava pagina por pagina, em vez de acumular e gravar no fim. E o ponto
     * do desenho: o pico de memoria e uma pagina, e nao a colecao. Acumular
     * funcionaria em toda loja pequena e quebraria na primeira grande.
     */
    do {
      const pagina = await deps.source.readPage(ctx.companyId, collection, cursor)
      if (pagina.rows.length > 0) await deps.sink.writeRows(collection, pagina.rows)
      linhas += pagina.rows.length
      cursor = pagina.nextCursor
    } while (cursor !== undefined)

    colecoes.push({ name: collection, rows: linhas, file: `${collection}.jsonl` })
  }

  const manifest: ExportManifest = {
    companyId: ctx.companyId,
    generatedAt: ctx.now.toISOString(),
    formatVersion: 1,
    collections: colecoes,
  }

  const { location } = await deps.sink.finish(manifest)

  /*
   * A exportacao E auditada, ao contrario da maioria das leituras.
   *
   * Uma copia integral da base saindo do sistema e o evento que alguem vai
   * querer reconstituir depois de um vazamento: quem baixou, quando, e quanto.
   * Sem esta linha, a resposta seria "nao sabemos".
   */
  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Company',
    entityId: ctx.companyId,
    /*
     * `data_export`, e o verbo entrou no vocabulario na NR-087.
     *
     * Antes era `created` com o nome real escondido em `after.event`, porque o
     * enum tinha so os quatro de CRUD. O comentario que estava aqui dizia que
     * o vocabulario precisava crescer e que isso era uma migration — foi feita.
     */
    action: 'data_export',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: {
      location,
      totalRows: colecoes.reduce((s, c) => s + c.rows, 0),
    },
  })

  return { manifest, location }
}

/**
 * O repositorio sabe ler TODAS as colecoes que o contrato declara?
 *
 * Falha alto quando nao, e antes de escrever qualquer coisa. Uma tabela de
 * negocio nova nasceria fora da exportacao em silencio, e o lojista receberia
 * um pacote que PARECE completo — o pior desfecho possivel para um direito de
 * portabilidade, porque ninguem descobre pelo uso.
 *
 * A conferencia e no comeco e nao no fim para nao entregar meio pacote.
 */
function confereQueNadaFicouDeFora(source: ExportSource): void {
  const sabidas = new Set<ExportCollection>(source.collections())
  const faltando = COLECOES_DA_EXPORTACAO.filter((c) => !sabidas.has(c))

  if (faltando.length > 0) {
    throw new Error(
      `Exportacao incompleta: o repositorio nao sabe ler ${faltando.join(', ')}. ` +
        'Toda colecao de exportCollectionSchema precisa de leitura — RF-125.',
    )
  }
}
