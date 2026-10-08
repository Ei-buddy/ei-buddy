/**
 * As telas do app, agrupadas como na barra lateral do web.
 *
 * Mora fora do `MenuLateral` porque a busca global (NR-162) tambem lista
 * telas: uma lista so, para a busca nunca achar tela que o menu nao tem.
 */
/** Item do menu que dispara uma acao em vez de abrir tela. */
export const ACAO_TUTORIAL = '#tutorial'

export type Item = { rota: string; rotulo: string }
export type Grupo = { grupo: string; itens: Item[] }

/**
 * Modulos do app, agrupados como na sidebar do web.
 *
 * Sao doze destinos — nao cabem numa barra de abas, e uma lista corrida
 * de doze itens tambem nao ajuda ninguem. Por isso os grupos abrem e
 * fecham: quem vai ao financeiro nao precisa ver cadastro no caminho.
 */
export const GRUPOS: Grupo[] = [
  {
    grupo: 'Operação',
    itens: [
      { rota: '/inicio', rotulo: 'Tela principal' },
      { rota: '/pdv', rotulo: 'Nova venda' },
      { rota: '/vendas', rotulo: 'Vendas' },
      { rota: '/orcamentos', rotulo: 'Orçamentos' },
      { rota: '/caixa', rotulo: 'Caixa' },
      { rota: '/agenda', rotulo: 'Agenda' },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { rota: '/clientes', rotulo: 'Clientes' },
      { rota: '/catalogo', rotulo: 'Produtos' },
      { rota: '/compras', rotulo: 'Entrada de mercadoria' },
      { rota: '/empresa', rotulo: 'Empresa' },
      { rota: '/fornecedores', rotulo: 'Fornecedores' },
      { rota: '/conexoes', rotulo: 'Conexões' },
    ],
  },
  {
    grupo: 'Financeiro',
    itens: [
      { rota: '/contas-a-pagar', rotulo: 'Contas a pagar' },
      { rota: '/contas-a-receber', rotulo: 'Contas a receber' },
      { rota: '/contas-bancarias', rotulo: 'Contas bancárias' },
      { rota: '/conciliacao', rotulo: 'Conciliação' },
      { rota: '/plano-de-contas', rotulo: 'Plano de contas' },
      { rota: '/dre', rotulo: 'Resultado' },
      { rota: '/relatorios', rotulo: 'Relatórios' },
    ],
  },
  {
    grupo: 'Mais',
    itens: [
      { rota: '/perfil', rotulo: 'Meu perfil' },
      { rota: '/crm', rotulo: 'CRM' },
      { rota: '/assistente', rotulo: 'Assistente' },
      { rota: '/assinatura', rotulo: 'Assinatura' },
      { rota: '/auditoria', rotulo: 'Auditoria' },
      { rota: '/suporte', rotulo: 'Suporte' },
      /* Ponto fixo de acesso aos documentos legais — RF-01. */
      { rota: '/privacidade-e-termos', rotulo: 'Privacidade e Termos' },
      /* Nao e tela: reabre o tutorial guiado (NR-166), como a ajuda do web. */
      { rota: ACAO_TUTORIAL, rotulo: 'Rever o tutorial' },
    ],
  },
]
