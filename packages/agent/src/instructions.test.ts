import { describe, expect, it } from 'vitest'
import { instrucoes } from './instructions.js'

const texto = instrucoes()

describe('instruções — perguntar e assumir (US2)', () => {
  it('assume preço de tabela e quantidade 1, e sempre pergunta a forma de pagamento', () => {
    expect(texto).toMatch(/preço de tabela/i)
    expect(texto).toMatch(/quantidade 1/i)
    expect(texto).toMatch(/sempre pergunte a forma de pagamento/i)
  })

  it('pergunta tudo o que falta numa única mensagem e lista opções pelo nome', () => {
    expect(texto).toMatch(/numa única mensagem/i)
    expect(texto).toMatch(/liste as opções pelo nome/i)
  })

  it('mostra na confirmação tudo o que foi assumido', () => {
    expect(texto).toMatch(/confirmação.*assumido|assumido.*confirmação/is)
  })

  it('a confirmação traz todos os fatos da proposta, inclusive o nome do cliente', () => {
    expect(texto).toMatch(/todos os fatos.*nome do cliente/is)
  })
})

describe('instruções — confirmar e corrigir (US3)', () => {
  it('aceite só com concordância, correção refaz a proposta, recusa cancela', () => {
    expect(texto).toMatch(/accept_proposal.*concordar/is)
    expect(texto).toMatch(/corrigir.*proposta/is)
    expect(texto).toMatch(/cancel_proposal/)
  })

  it('a mensagem final descreve o que de fato foi gravado', () => {
    expect(texto).toMatch(/o que de fato foi gravado/i)
  })
})

describe('instruções — contexto da conversa (US4)', () => {
  it('usa o resumo para resolver referências e não pergunta o que já foi dito', () => {
    expect(texto).toMatch(/"ele".*contexto desta conversa|contexto desta conversa.*"ele"/is)
    expect(texto).toMatch(/nunca pergunte o que já foi dito/i)
  })
})

describe('instruções — cadastro no meio do pedido (US5)', () => {
  it('oferece cadastrar (só o nome basta) ou seguir sem cliente, exceto no fiado', () => {
    expect(texto).toMatch(/só o nome basta/i)
    expect(texto).toMatch(/sem cliente/i)
    expect(texto).toMatch(/fiado.*nunca.*sem cliente|nunca.*sem cliente.*fiado/is)
  })

  it('cadastro de produto pede os obrigatórios, uma gravação por vez e retomada', () => {
    expect(texto).toMatch(/produto não encontrado.*obrigatórios/is)
    expect(texto).toMatch(/uma proposta por vez/i)
    expect(texto).toMatch(/paraRetomar/)
    expect(texto).toMatch(/retome/i)
  })
})

describe('instruções — fora do escopo e erros (US6)', () => {
  it('fora do escopo diz que não faz e dá até 3 exemplos em palavras comuns', () => {
    expect(texto).toMatch(/até 3 exemplos/i)
    expect(texto).toMatch(/palavras comuns/i)
  })

  it('erro de regra é explicado com o que ajustar e nunca como sucesso', () => {
    expect(texto).toMatch(/"recusado".*o que ajustar/is)
    expect(texto).toMatch(/nunca diga que gravou/i)
  })

  it('recusas por regra usam a mensagem da ferramenta', () => {
    expect(texto).toMatch(/"regra"/)
  })
})

describe('instruções — ajustes da avaliação com o modelo real', () => {
  it('"cadastra" um cliente já citado propõe com o nome dito, sem pedir mais', () => {
    expect(texto).toMatch(/não peça nome completo/i)
  })

  it('consulta de estoque traz nome, quantidade e preço', () => {
    expect(texto).toMatch(/estoque.*nome, a quantidade e o preço/is)
    expect(texto).toMatch(/zero é quantidade/i)
  })

  it('nunca inventa ref', () => {
    expect(texto).toMatch(/nunca invente um ref/i)
  })

  it('fora do escopo não é atendido (nada de piada ou conversa geral)', () => {
    expect(texto).toMatch(/só ajuda com a loja/i)
    expect(texto).toMatch(/piada/i)
  })

  it('recusa sempre diz que é no aplicativo', () => {
    expect(texto).toMatch(/no aplicativo/i)
  })

  it('ao pedir dados de produto cita os opcionais pelo nome', () => {
    expect(texto).toMatch(/código de barras, categoria, fornecedor/i)
  })

  it('confere o cliente e o produto citados antes de perguntar qualquer coisa', () => {
    expect(texto).toMatch(/antes de responder ou perguntar.*find_customer/is)
  })

  it('"retomar" manda chamar a ferramenta, não narrar', () => {
    expect(texto).toMatch(/não diga que vai seguir: chame a ferramenta/i)
  })
})

describe('instruções — nada técnico e tom (US1)', () => {
  it('proíbe exibir código interno, nome de campo, ferramenta e centavos', () => {
    expect(texto).toMatch(/nunca mostre.*(ref|código)/is)
    expect(texto).toMatch(/nome de campo/i)
    expect(texto).toMatch(/nome de ferramenta/i)
    expect(texto).toMatch(/centavos/i)
  })

  it('fixa o tom: até 3 linhas, lista só acima de 3 itens, no máximo 1 emoji', () => {
    expect(texto).toMatch(/até 3 linhas/i)
    expect(texto).toMatch(/mais de 3 itens/i)
    expect(texto).toMatch(/no máximo 1 emoji/i)
  })

  it('não descreve o funcionamento interno e só cumprimenta quando a dona cumprimentar', () => {
    expect(texto).toMatch(/não explique como você funciona/i)
    expect(texto).toMatch(/cumprimente só quando ela cumprimentar/i)
  })
})
