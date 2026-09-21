/**
 * Adapter do provedor de WhatsApp. Implementa a porta `MessageSender`
 * declarada por `core`: envio de texto e midia, e leitura de webhook com
 * assinatura verificada.
 *
 * A Cloud API e a escolha (ADR-0014). O adapter real entra com a NR-046.
 * O que existe hoje e o falso — `WHATSAPP_PROVIDER=fake` — que satisfaz a
 * porta inteira, inclusive os caminhos de erro. E aqui os caminhos de erro
 * sao a parte que mais gera bug, porque nenhum deles e falha de
 * infraestrutura: numero sem WhatsApp, cliente que bloqueou a loja, e a
 * **janela de atendimento de 24 horas**.
 *
 * O adapter nao decide se um numero esta vinculado a uma empresa (RF-094) nem
 * se um texto e pedido de opt-out: as duas coisas dependem de cadastro, que e
 * de `core`.
 *
 * A suite de contrato (`message-sender-contract.ts`) nao e exportada aqui de
 * proposito: importa `vitest`, que e dependencia de desenvolvimento.
 */
export { createFakeMessageSender, FakeMessageSender } from './fake-sender.js'
export type { FakeMessageSenderOptions, MensagemEnviada } from './fake-sender.js'

export { criarRemetenteMeta, responderVerificacao } from './meta-sender.js'
export type { MetaOptions } from './meta-sender.js'
