/**
 * Lista de espera do pre-lancamento — NR-111.
 *
 * Sem `pedir()` de proposito: aquele helper e para a area logada, onde toda
 * chamada e `same-origin` com cookie de sessao. Aqui nao ha sessao — e o
 * mesmo motivo pelo qual a rota do lado da api nao passa por
 * `requireContext`.
 */

export type PainPoint =
  | 'cash_flow'
  | 'more_customers'
  | 'sales_organization'
  | 'inventory'
  | 'collections'
  | 'routine'
  | 'profit_visibility'
  | 'marketing'
  | 'other'

export type UsesSystem = 'none' | 'complicated' | 'expensive' | 'satisfied' | 'other'

export type FairPrice =
  'up_to_29' | 'from_30_to_49' | 'from_50_to_69' | 'from_70_to_99' | 'above_100' | 'not_sure'

/**
 * As opcoes das perguntas fechadas, chave -> rotulo em portugues — usadas
 * pelo formulario (`ListaVipForm.tsx`) E pelo painel do Super Admin
 * (`AdminListaVipView.tsx`). Um lugar so: o rotulo que a pessoa respondeu e o
 * mesmo que aparece no grafico de quem le a resposta.
 */
export const OPCOES_DIFICULDADE: { value: PainPoint; label: string }[] = [
  { value: 'cash_flow', label: 'Controlar o dinheiro' },
  { value: 'more_customers', label: 'Conseguir mais clientes' },
  { value: 'sales_organization', label: 'Organizar as vendas' },
  { value: 'inventory', label: 'Controlar produtos e estoque' },
  { value: 'collections', label: 'Cobrar clientes' },
  { value: 'routine', label: 'Organizar minha rotina' },
  { value: 'profit_visibility', label: 'Saber se estou tendo lucro' },
  { value: 'marketing', label: 'Divulgar meu negócio' },
  { value: 'other', label: 'Outra' },
]

export const OPCOES_SISTEMA: { value: UsesSystem; label: string }[] = [
  { value: 'none', label: 'Não uso nenhum sistema' },
  { value: 'complicated', label: 'Sim, mas acho complicado' },
  { value: 'expensive', label: 'Sim, mas acho caro' },
  { value: 'satisfied', label: 'Sim e estou satisfeito' },
  { value: 'other', label: 'Outro' },
]

/** Em ORDEM DE VALOR, e nao de contagem — a leitura natural e a escala de preco. */
export const OPCOES_VALOR: { value: FairPrice; label: string }[] = [
  { value: 'up_to_29', label: 'Até R$ 29' },
  { value: 'from_30_to_49', label: 'R$ 30 a R$ 49' },
  { value: 'from_50_to_69', label: 'R$ 50 a R$ 69' },
  { value: 'from_70_to_99', label: 'R$ 70 a R$ 99' },
  { value: 'above_100', label: 'Acima de R$ 100' },
  { value: 'not_sure', label: 'Ainda não sei dizer' },
]

const paraRotulos = <T extends string>(opcoes: { value: T; label: string }[]): Record<T, string> =>
  Object.fromEntries(opcoes.map((o) => [o.value, o.label])) as Record<T, string>

export const ROTULO_DIFICULDADE = paraRotulos(OPCOES_DIFICULDADE)
export const ROTULO_SISTEMA = paraRotulos(OPCOES_SISTEMA)
export const ROTULO_VALOR = paraRotulos(OPCOES_VALOR)

/**
 * O formulario nao oferece mais "Até R$ 29" como opcao de resposta — mas o
 * valor continua um `FairPrice` valido e com rotulo (`ROTULO_VALOR`) por
 * causa de quem ja respondeu isso antes desta mudanca.
 */
export const OPCOES_VALOR_FORMULARIO = OPCOES_VALOR.filter((o) => o.value !== 'up_to_29')

export type DadosListaVip = {
  name: string
  businessType?: string
  phone: string
  expectation: string
  painPoints?: PainPoint[]
  painPointOther?: string
  usesSystem?: UsesSystem
  usesSystemOther?: string
  fairPrice?: FairPrice
  wantsUpdates?: boolean
}

export async function enviarListaVip(
  dados: DadosListaVip,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let resposta: Response
  try {
    resposta = await fetch('/api/lista-vip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dados),
    })
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: corpo.error?.message ?? 'Não foi possível enviar. Tente de novo.' }
  }

  return { ok: true }
}
