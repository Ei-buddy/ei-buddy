import type { AnonymizationReceipt, AnonymizeCustomerInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite, assertSegundoCanal } from '../authorization.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ExecutionContext } from '../context.js'
import type { CustomerPersonalData, DataSubjectRepository } from '../ports/privacy.js'

export type AnonymizeDeps = {
  readonly subjects: DataSubjectRepository
  readonly audit: AuditTrail
}

/** O que entra no lugar do nome. Visivel, para ninguem achar que e um bug. */
export const NOME_ANONIMIZADO = 'Cliente anonimizado'

/**
 * Anonimiza os dados pessoais de um cliente — RF-127, RF-128, US-063.
 *
 * ## Anonimizar, e nao apagar
 *
 * Apagar o cliente destruiria as vendas dele: os totais do mes mudariam
 * retroativamente, o DRE de um periodo fechado deixaria de bater, e a
 * obrigacao fiscal de guardar a venda por cinco anos seria descumprida. O `id`
 * fica, os valores ficam, os campos pessoais somem — e e isso que a RF-128
 * exige quando diz que totais e relatorios continuam corretos.
 *
 * O titular pediu exclusao e recebe anonimizacao. A diferenca precisa estar
 * escrita, e e por isso que o comprovante lista o que ficou e por que.
 *
 * ## O que a operacao NAO alcanca
 *
 * O XML da nota fiscal. Ele e assinado: mexer nele invalida a assinatura e
 * destroi o proprio documento que a lei obriga a guardar. O CPF ali tem base
 * legal de **obrigacao legal**, nao de interesse legitimo — o pedido de
 * exclusao nao o alcanca, e prometer o contrario seria mentir para o titular.
 *
 * ## Irreversivel, e por isso restrita
 *
 * `owner` apenas, e nunca pelo WhatsApp (ADR-0002). Nao ha como desfazer: os
 * valores originais nao sao guardados em lugar nenhum — ver `registra`.
 */
export async function anonymizeCustomer(
  deps: AnonymizeDeps,
  ctx: ExecutionContext,
  input: AnonymizeCustomerInput,
): Promise<AnonymizationReceipt> {
  assertCanWrite(ctx)
  assertSegundoCanal(ctx, 'Anonimizar os dados de um cliente')

  if (ctx.role !== 'owner') {
    throw AppError.forbidden('Somente o responsavel pela loja pode anonimizar dados de cliente.')
  }

  const cliente = await deps.subjects.findCustomer(ctx.companyId, input.customerId)
  if (cliente === undefined) throw AppError.notFound('Cliente nao encontrado.')

  if (cliente.anonymizedAt !== null) {
    /*
     * Conflito com a data, e nao sucesso silencioso. A segunda chamada nao tem
     * o que fazer, e responder "ok" faria parecer que houve uma anonimizacao
     * nova — o comprovante sairia com a data de hoje para uma operacao de
     * meses atras, e e a data que importa num pedido de titular.
     */
    throw AppError.conflict(
      `Este cliente ja foi anonimizado em ${cliente.anonymizedAt.slice(0, 10)}.`,
    )
  }

  recusaSeDeve(cliente)

  /*
   * Os substitutos sao decididos AQUI, e nao no SQL.
   *
   * `name` recebe texto visivel em vez de vazio porque a tela mostra o nome do
   * cliente em venda antiga: campo vazio pareceria dado corrompido, e alguem
   * abriria um chamado. `notes` vai a nulo junto com os outros — e texto livre
   * do balcao, e "mora ao lado da farmacia, pede sempre pelo filho" e dado
   * pessoal tanto quanto o telefone.
   *
   * ## O ENDERECO entrou na NR-086, e a falta dele era um defeito
   *
   * Esta lista tinha cinco campos e a migration 0019 acrescentou sete colunas
   * de endereco a `customers` — depois de este caso de uso ser escrito. O
   * resultado: a anonimizacao respondia ao titular que os dados pessoais dele
   * foram removidos, e deixava rua, numero, complemento, bairro, cidade, UF e
   * CEP intactos. Endereco residencial e dado pessoal, e num pedido de exclusao
   * ele e frequentemente o que mais importa.
   *
   * Isso nao apareceu em teste nenhum porque o falso de `core` nao conhece
   * coluna: ele guarda o que a lista manda e devolve o que guardou. Quem pegou
   * foi escrever o repositorio de verdade, que precisou olhar a tabela.
   *
   * A licao esta registrada em `privacidade.test.ts`: ha um teste que compara
   * as colunas pessoais de `customers` com esta lista, para a proxima coluna
   * nascer reprovando o PR em vez de nascer fora da anonimizacao.
   */
  const substitutes = {
    name: NOME_ANONIMIZADO,
    /*
     * O fantasia entra porque em MEI ele costuma CONTER o nome da pessoa —
     * "Joana Ribeiro ME". Tratar como dado de empresa deixaria o nome do
     * titular no banco depois de ele pedir para sair.
     */
    trade_name: null,
    document: null,
    phone: null,
    email: null,
    notes: null,
    postal_code: null,
    street: null,
    street_number: null,
    complement: null,
    neighborhood: null,
    city: null,
    state: null,
  }

  const contagens = await deps.subjects.anonymizeCustomer({
    companyId: ctx.companyId,
    customerId: cliente.id,
    substitutes,
    anonymizedAt: ctx.now,
    anonymizedBy: ctx.userId,
  })

  await registra(deps, ctx, cliente.id, input)

  return {
    customerId: cliente.id,
    anonymizedAt: ctx.now.toISOString(),
    anonymizedBy: ctx.userId,
    scrubbedFields: Object.keys(substitutes),
    preserved: [
      {
        what: 'vendas',
        rows: contagens.salesPreserved,
        because:
          'A venda e registro fiscal e contabil: a lei obriga a guardar por cinco anos, e ' +
          'apagar mudaria os totais de periodos ja fechados.',
      },
      {
        what: 'titulos a receber',
        rows: contagens.receivablesPreserved,
        because: 'Registro contabil da divida, sem os dados pessoais de quem devia.',
      },
      {
        what: 'documentos fiscais',
        rows: contagens.fiscalDocumentsPreserved,
        because:
          'O XML da nota e assinado: alterar invalida a assinatura e destroi o documento ' +
          'que a lei obriga a reter. O CPF nele tem base legal de obrigacao legal.',
      },
    ],
    deleted: [{ what: 'conversas de WhatsApp', rows: contagens.messagesDeleted }],
  }
}

/**
 * Recusa anonimizar quem ainda deve — e nao e burocracia.
 *
 * Fiado em aberto e relacao contratual viva. Anonimizar o devedor apagaria a
 * unica forma de cobrar: a divida continuaria na contabilidade da loja, sem
 * ninguem a quem cobrar, e o pedido de exclusao teria funcionado como perdao
 * de divida. A LGPD permite reter o necessario para o exercicio de direitos, e
 * este e o caso.
 *
 * A mensagem diz o que fazer, porque ha caminho: receber o valor, ou baixar a
 * divida como perda. As duas saidas existem no sistema, e depois de qualquer
 * uma delas a anonimizacao passa.
 */
function recusaSeDeve(cliente: CustomerPersonalData): void {
  if (cliente.walletBalanceCents > 0) {
    throw AppError.conflict(
      'Este cliente tem fiado em aberto. Receba o valor ou baixe a divida como perda antes de ' +
        'anonimizar — depois disso nao havera mais como identificar quem devia.',
    )
  }
}

/**
 * Registra QUANDO e POR QUEM, e nada mais — RF-127.
 *
 * ## O `before` fica nulo de proposito
 *
 * A tentacao e obvia: gravar os valores antigos, como toda outra alteracao faz.
 * Seria autodestrutivo. A trilha e **imutavel** (RF-124) e a propria
 * anonimizacao nao a alcanca — entao gravar nome, telefone e CPF ali criaria
 * uma copia PERMANENTE de exatamente o dado que o titular pediu para excluir,
 * no unico lugar do sistema de onde ele nunca sairia.
 *
 * O pedido de exclusao viraria o registro definitivo do dado excluido.
 *
 * O que fica: o id do cliente, quem pediu, quando, e o motivo em texto livre
 * escrito pelo lojista. E o suficiente para responder "quem anonimizou quem, e
 * a pedido de que" — que e a pergunta da fiscalizacao — sem guardar o dado.
 */
async function registra(
  deps: AnonymizeDeps,
  ctx: ExecutionContext,
  customerId: string,
  input: AnonymizeCustomerInput,
): Promise<void> {
  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Customer',
    entityId: customerId,
    action: 'anonymized',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    /* Ver acima: guardar o antes seria preservar o que se pediu para excluir. */
    before: null,
    after: { reason: input.reason },
  })
}
