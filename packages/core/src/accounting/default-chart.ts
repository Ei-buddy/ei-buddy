import type { AccountType } from '@na-regua/contracts'

/**
 * Plano de contas padrao de varejo — RF-081.
 *
 * Criado no fim do onboarding para que o lojista NUNCA veja a tela de
 * classificacao vazia. Plano de contas em branco e uma pergunta que ele nao
 * sabe responder ("que contas eu tenho?"), e a resposta pratica dele e nao
 * classificar nada — o que transforma o DRE num relatorio de uma linha so.
 *
 * Curto de proposito: catorze contas que qualquer mercadinho reconhece. Uma
 * lista completa de plano contabil teria centenas e seria pior, porque
 * escolher entre trezentas opcoes e mais dificil que escolher entre catorze.
 * Quem precisar de mais cria — e o RF-082 existe para isso.
 *
 * Vive em `core` e nao em `db` porque e conhecimento de negocio: quais contas
 * uma loja de varejo tem. A migration que semeia as linhas usa esta lista, em
 * vez de repetir os nomes em SQL onde ninguem os encontraria depois.
 */
export type ContaPadrao = {
  readonly name: string
  readonly type: AccountType
}

export const PLANO_DE_CONTAS_PADRAO: readonly ContaPadrao[] = [
  /* Receita */
  { name: 'Venda de mercadoria', type: 'revenue' },
  { name: 'Prestação de serviço', type: 'revenue' },
  { name: 'Outras receitas', type: 'revenue' },

  /* Deducoes da receita */
  { name: 'Impostos sobre venda', type: 'deduction' },
  { name: 'Taxas de cartão', type: 'deduction' },
  { name: 'Devoluções e cancelamentos', type: 'deduction' },

  /* Custo */
  { name: 'Custo da mercadoria vendida', type: 'cost' },
  { name: 'Frete sobre compra', type: 'cost' },

  /* Despesa */
  { name: 'Aluguel', type: 'expense' },
  { name: 'Energia, água e internet', type: 'expense' },
  { name: 'Salários e encargos', type: 'expense' },
  { name: 'Marketing', type: 'expense' },
  { name: 'Manutenção e limpeza', type: 'expense' },
  { name: 'Outras despesas', type: 'expense' },
]
