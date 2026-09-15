/**
 * Conteudo da landing.
 *
 * REGRA DESTE ARQUIVO: nada aqui pode ser inventado. Numero, depoimento ou
 * selo so entra quando existir dado real por tras. Enquanto nao existir, a
 * pagina fala do que o produto FAZ — que e verificavel — em vez de quanto ele
 * ja vendeu, que nao e.
 *
 * O primeiro escopo usou metricas e depoimentos ficticios para dar forma ao
 * layout. Eles sairam. Os pontos onde dado real entra estao marcados com TODO.
 *
 * A integracao com Google Agenda saiu junto, aqui e nos dois apps: ela nao
 * aparecia em requisito, user story nem decisao — os RF-089 a RF-093 descrevem
 * agenda propria com lembrete, sem integracao externa. Anunciar o que nao esta
 * no roadmap e a mesma falha das metricas inventadas, so que mais dificil de
 * perceber, porque desta vez havia codigo por tras.
 */

/**
 * Nome do produto. Todo lugar que exibe a marca le daqui — header da
 * landing, painel de login, sidebar do app, rodape e titulos de pagina —
 * entao trocar o nome continua sendo uma linha so.
 */
export const BRAND = 'EiBuddy'

/**
 * Liga o modo pre-lancamento da landing.
 *
 * O app ainda nao tem partes essenciais prontas (integracoes de API, agente,
 * WhatsApp) para abrir cadastro ao publico. Enquanto isto for `true`: sem
 * botao de Entrar/Cadastrar, sem secao de Planos, e o topo da pagina convida
 * para a lista de espera (`/lista-vip`) em vez de criar conta.
 *
 * Nada foi apagado por causa disto — `Pricing.tsx`, os links de conta no
 * rodape e os CTAs de cadastro continuam no codigo. Virar `false` restaura
 * tudo, porque e exatamente esse o dia que esta flag antecipa.
 */
export const PRE_LANCAMENTO = true

/**
 * Convite do grupo VIP no WhatsApp — aparece depois de salvar a pesquisa.
 *
 * Fica aqui, e nao dentro do formulario, porque e conteudo: trocar o grupo e
 * editar esta linha, sem abrir componente. Um convite do WhatsApp caduca
 * quando o dono o revoga — se o grupo mudar, e este o lugar.
 */
export const GRUPO_VIP_WHATSAPP = 'https://chat.whatsapp.com/HdmK0OLT9qCL7IIwE5dCEo'

export const nav = [
  { label: 'Módulos', href: '#modulos' },
  { label: 'Como funciona', href: '#como-funciona' },
  { label: 'Painel', href: '#painel' },
  ...(PRE_LANCAMENTO ? [] : [{ label: 'Planos', href: '#planos' }]),
  { label: 'Dúvidas', href: '#duvidas' },
]

/**
 * Barra que corre abaixo do hero.
 *
 * Eram metricas ficticias ("+12 mil negocios", "R$ 4,2 bi movimentados").
 * Agora sao capacidades do produto: cada item corresponde a uma tela que
 * existe no app.
 *
 * TODO: quando houver numero real de empresas ativas ou volume processado,
 * uma barra de metricas pode voltar — com dado apurado, nao estimado.
 */
export const highlights = [
  'Gestão completa do negócio',
  'Assistente por WhatsApp',
  'Emissão de NFC-e e NFS-e',
  'Contas a pagar e a receber',
  'Controle de estoque',
  'CRM e agenda integrados',
]

/** Cards de modulos — os sete modulos que o app tem hoje. */
export const modules = [
  {
    id: 'empresa',
    icon: 'store',
    name: 'Empresa',
    tag: 'Cadastro e fiscal',
    description:
      'Cadastro completo do negócio, com busca automática de CNPJ e CEP e envio do certificado digital para emitir nota.',
  },
  {
    id: 'clientes',
    icon: 'users',
    name: 'Clientes',
    tag: 'Histórico e contatos',
    description:
      'Histórico de compras, pendências e contatos de cada cliente, com busca por CPF ou CNPJ e importação por planilha.',
  },
  {
    id: 'produtos',
    icon: 'box',
    name: 'Produtos',
    tag: 'Catálogo e estoque',
    description:
      'Catálogo com controle de estoque, importação de XML de compra, busca por EAN e NCM e histórico de movimentação.',
  },
  {
    id: 'financeiro',
    icon: 'wallet',
    name: 'Financeiro',
    tag: 'Contas e plano de contas',
    description:
      'Plano de contas com contas a pagar e a receber, baixa total ou parcial e estorno de lançamento.',
  },
  {
    id: 'vendas',
    icon: 'bag',
    name: 'Vendas',
    tag: 'PDV e nota fiscal',
    description:
      'Catálogo, carrinho e pagamento em Pix, cartão, dinheiro ou carteira — com NFC-e ou NFS-e emitida no fechamento.',
  },
  {
    id: 'crm',
    icon: 'calendar',
    name: 'CRM e Agenda',
    tag: 'Pendências e compromissos',
    description:
      'Pendências e contatos em quadro estilo Kanban, com agenda de compromissos e lembrete antes da hora.',
  },
  {
    id: 'assistente',
    icon: 'sparkles',
    name: 'Assistente de IA',
    tag: 'Pelo WhatsApp',
    description:
      'Faturamento, rankings, DRE, contas em aberto e cadastros — perguntando em texto, sem abrir relatório.',
  },
]

/**
 * Secao que substituiu a prova social.
 *
 * Depoimentos e metricas ficticios sairam. Ate existir cliente real disposto a
 * dar depoimento, a pagina fala de beneficio concreto, ligado a uma tela que
 * existe.
 *
 * TODO: reativar a secao de depoimentos quando houver citacao real, com nome
 * (ou iniciais autorizadas), negocio e permissao de uso.
 */
export const benefits = [
  {
    icon: 'sparkles',
    title: 'Pergunte em vez de procurar',
    text: 'O número que você precisa vem por mensagem, sem abrir relatório nem montar filtro.',
  },
  {
    icon: 'receipt',
    title: 'A nota sai junto com a venda',
    text: 'NFC-e e NFS-e emitidas no fechamento, com imposto e taxa de cartão já calculados.',
  },
  {
    icon: 'wallet',
    title: 'O caixa deixa de ser estimativa',
    text: 'Valor líquido da venda cai em contas a receber sozinho, já descontada a taxa da maquininha.',
  },
  {
    icon: 'box',
    title: 'Reposição antes da falta',
    text: 'Estoque mínimo por produto e aviso de quando repor, antes de o cliente pedir o que acabou.',
  },
  {
    icon: 'users',
    title: 'O histórico do cliente na mão',
    text: 'O que comprou, quando comprou e o que deve — na hora do atendimento, não depois.',
  },
  {
    icon: 'shield',
    title: 'Cada empresa vê só o que é dela',
    text: 'Dados isolados por empresa, com papel de acesso separado para dono, equipe e contador.',
  },
]

export const plan = {
  name: 'Plano único',
  badge: 'Todos os módulos inclusos',
  price: 'R$ 59,90',
  period: '/mês por empresa',
  /*
   * Sem periodo de teste anunciado: o trial existe no escopo (E12), mas prazo
   * e limites sao pergunta em aberto nas decisoes. Anunciar "14 dias" antes de
   * a decisao fechar seria promessa que o produto ainda nao sustenta.
   */
  note: 'Cobrança mensal, sem fidelidade. Cancele quando quiser.',
  features: [
    'Empresa, clientes, produtos e estoque',
    'Vendas com emissão de NFC-e e NFS-e',
    'Financeiro: plano de contas, contas a pagar e a receber',
    'CRM em quadro Kanban e agenda com lembrete de compromisso',
    'Assistente de IA pelo WhatsApp',
    'Importação de clientes e produtos por planilha',
    'Usuários ilimitados por empresa',
  ],
}

export const faq = [
  {
    question: 'Como funciona o assistente de IA pelo WhatsApp?',
    answer:
      'Você pergunta em texto e ele responde com o dado do seu negócio: faturamento mês a mês, ranking de clientes e produtos, DRE, o que há para pagar hoje. Também executa cadastro de cliente e lançamento de pendência — e pede confirmação antes de qualquer ação que altere dado.',
  },
  {
    question: 'Preciso de certificado digital para usar o app?',
    answer:
      'Só para emitir nota fiscal. Vendas, financeiro, estoque, clientes e o assistente funcionam sem ele. O certificado A1 é enviado na tela de Empresa e fica guardado cifrado.',
  },
  {
    question: 'O app emite nota fiscal?',
    answer:
      'Sim, NFC-e para venda de produto e NFS-e para serviço, emitidas no mesmo passo do fechamento da venda. O imposto e a taxa de cartão entram no cálculo e o valor líquido vai para contas a receber.',
  },
  {
    question: 'Posso importar meus clientes e produtos de uma planilha?',
    answer:
      'Sim. Clientes e produtos aceitam importação por planilha, com mapeamento das colunas do seu arquivo. Produtos também aceitam XML de nota de compra, que já traz descrição, EAN e NCM preenchidos.',
  },
  {
    question: 'Como funciona o pagamento da mensalidade?',
    answer:
      'Assinatura mensal por empresa, cobrada no cartão ou por Pix. A fatura fica na tela de Assinatura, com o histórico das anteriores.',
  },
  {
    question: 'Posso cancelar quando quiser?',
    answer:
      'Sim, não há fidelidade nem multa. Ao cancelar você continua podendo ler e exportar seus dados.',
  },
]

export const footerColumns = [
  {
    title: 'Produto',
    links: [
      { label: 'Módulos', href: '/#modulos' },
      { label: 'Como funciona', href: '/#como-funciona' },
      { label: 'Painel', href: '/#painel' },
      ...(PRE_LANCAMENTO ? [] : [{ label: 'Planos', href: '/#planos' }]),
      { label: 'Dúvidas', href: '/#duvidas' },
    ],
  },
  /* Sem conta para entrar ou criar em pre-lancamento — ver PRE_LANCAMENTO. */
  ...(PRE_LANCAMENTO
    ? []
    : [
        {
          title: 'Conta',
          links: [
            { label: 'Entrar', href: '/login' },
            { label: 'Criar conta', href: '/criar-conta' },
            { label: 'Recuperar senha', href: '/recuperar-senha' },
          ],
        },
      ]),
  {
    /*
     * Suporte publico ainda nao existe como pagina: /app/suporte fica atras do
     * login. Enquanto nao houver pagina de contato aberta, os links levam para
     * onde ha resposta de verdade — as duvidas na propria landing e o login.
     *
     * TODO: apontar para a pagina publica de contato quando ela existir, e
     * incluir o canal de atendimento (e-mail ou WhatsApp) quando definido.
     */
    title: 'Suporte',
    links: [
      { label: 'Dúvidas frequentes', href: '/#duvidas' },
      { label: 'Falar com o suporte', href: '/login' },
    ],
  },
]
