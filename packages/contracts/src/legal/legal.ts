import { z } from 'zod'

/**
 * Documentos legais e prova de consentimento — LGPD art. 8 §1.
 *
 * ## Por que a versao vigente mora aqui, e nao no banco
 *
 * O texto dos documentos vive no repositorio (`apps/web/src/app/termos-de-uso`
 * e `.../politica-de-privacidade`), entao mudar uma clausula ja passa por
 * revisao em PR e fica no historico do git. Guardar a versao VIGENTE numa
 * tabela criaria uma segunda fonte de verdade: daria para publicar uma versao
 * que nao corresponde a nenhum texto, ou trocar o texto sem mudar a versao —
 * e a prova de consentimento apontaria para algo que nunca existiu.
 *
 * Com a constante aqui, subir a versao e editar o texto sao o MESMO commit.
 *
 * Quem consome: `apps/api` grava a versao no aceite, `apps/web` e
 * `apps/mobile` perguntam o que ainda falta aceitar.
 */

export const tipoDeDocumentoLegalSchema = z.enum(['privacy', 'terms'])
export type TipoDeDocumentoLegal = z.infer<typeof tipoDeDocumentoLegalSchema>

/**
 * A versao de cada documento em vigor AGORA.
 *
 * Subir um destes valores obriga todo mundo que ja aceitou a aceitar de novo
 * (RF-03) — e a data e a mesma que a pagina mostra em "Atualizado em". Por
 * isso o formato e a data de vigencia: um numero sequencial obrigaria a
 * lembrar de mudar dois lugares, e um dia alguem esqueceria.
 *
 * MUDE ISTO NO MESMO COMMIT EM QUE MUDAR O TEXTO.
 */
export const VERSOES_LEGAIS = {
  privacy: '2026-09-09',
  /* 2026-09-24: o escopo do produto nos Termos passou a dizer "comercio
     enquadrado como MEI", em vez de "comercio". Mudanca de texto obriga
     reaceite (RF-03), e por isso a data sobe junto. */
  terms: '2026-09-24',
} as const satisfies Record<TipoDeDocumentoLegal, string>

/** Os dois documentos, para quem precisa percorrer sem repetir a lista. */
export const DOCUMENTOS_LEGAIS = ['privacy', 'terms'] as const

export const ROTULO_DO_DOCUMENTO: Record<TipoDeDocumentoLegal, string> = {
  privacy: 'Política de Privacidade',
  terms: 'Termos de Uso',
}

/** Caminho da pagina no web — o mobile abre estes mesmos enderecos. */
export const CAMINHO_DO_DOCUMENTO: Record<TipoDeDocumentoLegal, string> = {
  privacy: '/politica-de-privacidade',
  terms: '/termos-de-uso',
}

/**
 * Um aceite registrado. `acceptedAt` e do servidor, nunca do cliente: data de
 * consentimento que o proprio interessado informa nao serve como prova.
 */
export const consentimentoLegalSchema = z.object({
  type: tipoDeDocumentoLegalSchema,
  version: z.string(),
  acceptedAt: z.string(),
})
export type ConsentimentoLegal = z.infer<typeof consentimentoLegalSchema>

/**
 * O que ainda falta aceitar, e em que versao.
 *
 * Lista vazia = em dia. Quem nunca aceitou e quem aceitou uma versao antiga
 * caem no mesmo lugar de proposito: para a tela, os dois casos sao "precisa
 * aceitar isto agora".
 */
export const pendenciasLegaisSchema = z.object({
  pendentes: z.array(
    z.object({
      type: tipoDeDocumentoLegalSchema,
      version: z.string(),
      /** Versao que a pessoa aceitou antes, quando houve alguma. */
      versaoAceitaAntes: z.string().optional(),
    }),
  ),
})
export type PendenciasLegais = z.infer<typeof pendenciasLegaisSchema>

/**
 * Corpo do reaceite — deliberadamente vazio.
 *
 * O cliente nao diz QUAL versao esta aceitando: quem grava e o servidor, com
 * a versao que ele mesmo tem como vigente. Deixar o cliente escolher abriria
 * duas portas — um app velho registraria aceite de um texto que nao esta mais
 * no ar, e um cliente adulterado registraria aceite de versao que nunca
 * existiu. Nos dois casos a prova de consentimento viraria ficcao.
 */
export const aceiteLegalInputSchema = z.object({}).strict()
