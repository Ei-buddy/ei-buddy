import { describe, expect, it } from 'vitest'
import { dividirRespostaWhatsapp } from './dividir-resposta-whatsapp.js'

/**
 * Tabela da divisao — contrato de resposta em baloes.
 *
 * O texto ja chega formatado. Cada caso trava um limite natural: frase,
 * linha de lista ou paragrafo. Parte vazia nao existe, e o turno para em
 * cinco.
 */

function esperarPartes(texto: string, partes: readonly string[]): void {
  const resultado = dividirRespostaWhatsapp(texto)

  expect(resultado.length).toBeGreaterThanOrEqual(1)
  expect(resultado.length).toBeLessThanOrEqual(5)
  expect(resultado.every((parte) => parte.length > 0 && parte === parte.trim())).toBe(true)
  expect(resultado).toEqual(partes)
}

const ideiaDe280 = `Pronto. ${'a'.repeat(271)}.`

const fraseLonga = `${'A'.repeat(368)}.`
const fraseDoValor = 'João Silva levou 2 coca por R$ 12,50.'
const paragrafoDoValor = `${fraseLonga} ${fraseDoValor}`

const aberturaGrande = `${'A'.repeat(390)}.`
const miudas = ['B.', 'C.', 'D.', 'E.', 'F.', 'G.']
const corpoComMuitasFrases = [aberturaGrande, ...miudas].join(' ')

describe('dividirRespostaWhatsapp', () => {
  it('uma ideia de 280 caracteres ainda cabe num balao', () => {
    expect(ideiaDe280).toHaveLength(280)
  })

  it('o corte em 400 caracteres cairia entre R$ e o valor', () => {
    expect(paragrafoDoValor.length).toBeGreaterThan(400)
    expect(paragrafoDoValor.slice(398, 406)).toBe('R$ 12,50')
    expect(paragrafoDoValor[400]).toBe(' ')
  })

  it.each([
    {
      nome: 'uma ideia, sem lista, ate 280, mesmo com ponto',
      texto: 'Pronto. A venda entrou.',
      partes: ['Pronto. A venda entrou.'],
    },
    {
      nome: 'exatamente 280 caracteres, com ponto, continua um balao',
      texto: ideiaDe280,
      partes: [ideiaDe280],
    },
    {
      nome: 'frase curta com duas sentencas e Confirma? nao isola a pergunta',
      texto: 'Fiz a venda. O total ficou R$ 12,00. Confirma?',
      partes: ['Fiz a venda. O total ficou R$ 12,00. Confirma?'],
    },
    {
      nome: 'so Algo. Confirma?, sem texto anterior separado',
      texto: 'Algo. Confirma?',
      partes: ['Algo. Confirma?'],
    },
    {
      nome: 'Confirmacao curta do nucleo continua uma mensagem',
      texto: 'Alguma coisa. Confirma?',
      partes: ['Alguma coisa. Confirma?'],
    },
    {
      nome: 'Confirma? com paragrafo anterior fica sozinha no fim',
      texto: 'Lancei 2 coca para João.\n\nConfirma?',
      partes: ['Lancei 2 coca para João.', 'Confirma?'],
    },
    {
      nome: 'Confirma? depois de texto longo demais para um balao',
      texto: `${'a'.repeat(280)}. Confirma?`,
      partes: [`${'a'.repeat(280)}.`, 'Confirma?'],
    },
    {
      nome: 'abertura e duas linhas com traco',
      texto: 'Estes sao os itens:\n- Coca\n- Pao',
      partes: ['Estes sao os itens:', '- Coca', '- Pao'],
    },
    {
      nome: 'abertura e lista numerada com ponto',
      texto: 'Pendencias:\n1. Coca\n2. Pao',
      partes: ['Pendencias:', '1. Coca', '2. Pao'],
    },
    {
      nome: 'abertura e lista numerada com parentese',
      texto: 'Pendencias:\n1) Coca\n2) Pao',
      partes: ['Pendencias:', '1) Coca', '2) Pao'],
    },
    {
      nome: 'lista sozinha com duas linhas quebra entre elas',
      texto: '- Coca\n- Pao',
      partes: ['- Coca', '- Pao'],
    },
    {
      nome: 'lista numerada sozinha tambem quebra entre linhas',
      texto: '1) Coca\n2) Pao',
      partes: ['1) Coca', '2) Pao'],
    },
    {
      nome: 'um unico item nao e lista para dividir',
      texto: 'Veja:\n- so um item',
      partes: ['Veja:\n- so um item'],
    },
    {
      nome: 'paragrafo acima de 400 quebra no fim da frase e preserva valor, quantidade e nome',
      texto: paragrafoDoValor,
      partes: [fraseLonga, fraseDoValor],
    },
    {
      nome: 'exclamacao e interrogacao tambem fecham frase',
      texto: `${'A'.repeat(200)}! ${'B'.repeat(200)}?`,
      partes: [`${'A'.repeat(200)}!`, `${'B'.repeat(200)}?`],
    },
    {
      nome: 'sem fim de frase, paragrafo longo permanece inteiro e o valor junto',
      texto: `Total R$ 12,50 ${'a'.repeat(420)}`,
      partes: [`Total R$ 12,50 ${'a'.repeat(420)}`],
    },
    {
      nome: 'sete itens passam de cinco e fundem linhas inteiras, as mais curtas primeiro',
      texto: [
        '- item 1',
        '- item 2',
        '- item 3',
        '- item 4',
        '- item 5',
        '- item 6',
        '- item 7',
      ].join('\n'),
      partes: ['- item 1\n- item 2', '- item 3\n- item 4', '- item 5', '- item 6', '- item 7'],
    },
    {
      nome: 'paragrafos demais fundem o par adjacente mais curto, nao o primeiro a qualquer custo',
      texto: ['Movimento longo da loja no periodo.', 'A.', 'B.', 'C.', 'D.', 'E.'].join('\n\n'),
      partes: ['Movimento longo da loja no periodo.', 'A.\n\nB.', 'C.', 'D.', 'E.'],
    },
    {
      nome: 'muitas frases e Confirma? param em cinco, com a pergunta intacta no fim',
      texto: `${corpoComMuitasFrases} Confirma?`,
      partes: [aberturaGrande, 'B. C.', 'D. E.', 'F. G.', 'Confirma?'],
    },
    {
      nome: 'espaco nas bordas sai, e a linha em branco continua limite',
      texto: '  Primeira ideia.  \n\n  Segunda ideia.  ',
      partes: ['Primeira ideia.', 'Segunda ideia.'],
    },
  ])('$nome', ({ texto, partes }) => {
    esperarPartes(texto, partes)
  })

  it('lista com abertura e Confirma? deixa a pergunta no ultimo balao', () => {
    esperarPartes('Veja:\n- Coca\n- Pao\n\nConfirma?', ['Veja:', '- Coca', '- Pao', 'Confirma?'])
  })

  it('quebra de linha do Windows nao gruda os paragrafos', () => {
    esperarPartes('Lancei 2 coca para João.\r\n\r\nConfirma?', [
      'Lancei 2 coca para João.',
      'Confirma?',
    ])
  })
})
