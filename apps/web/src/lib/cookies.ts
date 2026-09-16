/**
 * O inventario dos cookies — NR-085, LGPD art. 9.
 *
 * ## Por que um inventario em codigo, e nao um texto na pagina
 *
 * Porque politica de cookies escrita a mao envelhece na primeira vez que
 * alguem acrescenta um `Set-Cookie` e nao lembra do documento. Aqui a lista e
 * dado: a pagina publica renderiza a partir dela, e `cookies.test.ts` reprova
 * o PR que introduzir um cookie que nao esteja aqui.
 *
 * Isso transforma "lembre de atualizar a politica" — que e um pedido que falha
 * silenciosamente — em portao de CI.
 *
 * ## Por que NAO ha banner de consentimento
 *
 * Porque hoje ha um cookie so, e ele e estritamente necessario: sem ele nao ha
 * sessao, e sem sessao nao ha produto. A base legal e a execucao do contrato
 * (LGPD art. 7, V), e nao o consentimento.
 *
 * Pedir "aceita cookies?" para algo que sera gravado de qualquer jeito nao e
 * conformidade — e teatro, e teatro que treina a pessoa a clicar em "aceitar"
 * sem ler. O que a lei cobra num caso assim e TRANSPARENCIA (art. 9): dizer
 * qual cookie existe, para que serve e quanto dura. E o que o aviso e esta
 * pagina fazem.
 *
 * No dia em que entrar o primeiro cookie de `analise` ou `marketing`, a
 * conversa muda: ai o consentimento passa a ser a base legal, precisa ser
 * granular, precisa ser revogavel, e precisa vir ANTES da gravacao. O campo
 * `categoria` existe para que esse dia seja visivel — e o teste abaixo recusa
 * um cookie nao essencial enquanto nao houver mecanismo de consentimento.
 */

/**
 * Para que o cookie serve.
 *
 * - `essencial`: o produto nao funciona sem ele. Dispensa consentimento.
 * - `preferencia`: guarda uma escolha da pessoa. Dispensa consentimento apenas
 *   quando a escolha foi feita por ela, de forma ativa.
 * - `analise` e `marketing`: exigem consentimento previo, granular e
 *   revogavel. Nenhum existe hoje.
 */
export type CategoriaDeCookie = 'essencial' | 'preferencia' | 'analise' | 'marketing'

export type CookieDoInventario = {
  readonly nome: string
  readonly categoria: CategoriaDeCookie
  /** Quem grava: nos, ou um terceiro. Terceiro muda o que precisa ser dito. */
  readonly origem: 'proprio' | 'terceiro'
  /** Para que serve, na lingua de quem le — nao na nossa. */
  readonly finalidade: string
  /** Quanto dura, em texto. "Sessao" quando morre ao fechar o navegador. */
  readonly duracao: string
  /** `httpOnly` significa que o JavaScript da pagina nao le. Vale dizer. */
  readonly httpOnly: boolean
}

export const COOKIES: readonly CookieDoInventario[] = [
  {
    nome: 'nr_session',
    categoria: 'essencial',
    origem: 'proprio',
    finalidade:
      'Manter voce autenticado enquanto usa o sistema. E o cookie que liga o navegador a sua sessao; sem ele, cada tela pediria login de novo.',
    duracao: '12 horas',
    /* `httpOnly` de proposito: o token nao fica ao alcance de JavaScript, entao
       um XSS nao o leva embora. Ver `lib/api-server.ts`. */
    httpOnly: true,
  },
]

/**
 * Outros armazenamentos no navegador que NAO sao cookies.
 *
 * Entram na pagina publica porque a diferenca tecnica entre cookie e
 * `localStorage` nao interessa a quem le: os dois guardam coisa no aparelho
 * dela. Omitir o `localStorage` por ele nao ser tecnicamente um cookie seria
 * cumprir a letra e furar o proposito do art. 9.
 */
export type ArmazenamentoLocal = {
  readonly chave: string
  readonly categoria: CategoriaDeCookie
  readonly finalidade: string
  readonly duracao: string
}

export const ARMAZENAMENTO_LOCAL: readonly ArmazenamentoLocal[] = [
  {
    chave: 'nr:aviso-cookies',
    /*
     * `preferencia` e nao `essencial`: guardar que voce ja leu o aviso e uma
     * conveniencia, e nasce de um clique SEU. Por isso dispensa consentimento —
     * a escolha ja foi feita de forma ativa, e o registro dela e o que evita
     * repetir a mesma informacao em toda visita.
     */
    categoria: 'preferencia',
    finalidade:
      'Lembrar que voce ja viu o aviso sobre cookies, para ele nao aparecer de novo a cada visita.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'nr:tema-painel',
    /* Mesma razao do aviso de cookies: nasce de um clique seu (o botao de
       sol/lua no painel), e guarda-la e o que evita o painel voltar ao
       escuro padrao a cada visita depois de voce escolher o claro. */
    categoria: 'preferencia',
    finalidade: 'Lembrar se voce escolheu o tema claro do painel, em vez do escuro padrao.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'nr:tutorial-visto',
    /* Nasce sozinha, sem clique seu — mas so registra que voce ja PASSOU pelo
       tutorial guiado uma vez, sem guardar nada sobre o que voce fez nele.
       Sem isso, o tutorial reapareceria em toda visita ao painel. */
    categoria: 'preferencia',
    finalidade:
      'Lembrar que voce ja viu o tutorial guiado do painel, para ele nao reaparecer sozinho.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'nr:checklist-dispensado',
    /* Nasce de um clique seu (o X no cartao de primeiros passos) — dispensa
       consentimento pela mesma razao do aviso de cookies. */
    categoria: 'preferencia',
    finalidade:
      'Lembrar que voce dispensou o cartao de primeiros passos, para ele nao voltar a aparecer.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'nr:meta-diaria',
    /* Nasce de um numero que voce mesmo digita, na tela do painel — dispensa
       consentimento pela mesma razao do tema e do som. */
    categoria: 'preferencia',
    finalidade: 'Lembrar a meta diaria de faturamento que voce definiu, para calcular o progresso.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'nr:som',
    /* Mesma razao do tema: nasce de um clique seu (o botao de alto-falante no
       painel), e guarda-la e o que evita o bipe e a confirmacao de venda
       voltarem a tocar a cada visita depois de voce desligar. */
    categoria: 'preferencia',
    finalidade:
      'Lembrar se voce desligou o som do painel (bipe do leitor de codigo de barras e confirmacao de venda fechada).',
    duracao: 'Ate voce limpar os dados do navegador',
  },
  {
    chave: 'demo:subscription-status',
    categoria: 'essencial',
    finalidade:
      'Guardar o estado da assinatura para as telas saberem o que liberar. Provisorio: sai quando a cobranca passar a ser consultada no servidor.',
    duracao: 'Ate voce limpar os dados do navegador',
  },
]

/** Ha algo que dependa de consentimento? Hoje, nao — e a pagina diz isso. */
export const EXIGE_CONSENTIMENTO = [...COOKIES, ...ARMAZENAMENTO_LOCAL].some(
  (c) => c.categoria === 'analise' || c.categoria === 'marketing',
)

export const ROTULO_DA_CATEGORIA: Record<CategoriaDeCookie, string> = {
  essencial: 'Essencial',
  preferencia: 'Preferencia',
  analise: 'Analise',
  marketing: 'Marketing',
}
