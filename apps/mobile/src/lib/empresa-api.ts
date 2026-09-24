import { chamarApi } from './api'

/**
 * Dados da empresa no app — RF-003.
 *
 * As mesmas rotas do web: `GET`/`PUT /empresa` e `GET /enderecos/cep/:cep`.
 * A tela abria com a mercearia de exemplo de `mock-data`, e "salvar" era um
 * `delay` — quem salvasse achava que tinha gravado.
 *
 * CNPJ e certificado ficam de fora: trocar CNPJ e outra empresa (o contrato
 * nem aceita), e o .pfx com senha nao e coisa para teclado de toque.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

/* -------------------------------------------------------------------------- */
/* CEP                                                                        */
/* -------------------------------------------------------------------------- */

export type EnderecoCep = {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

/** Busca o endereco pelo CEP — BrasilAPI, pelo nosso backend. */
export async function buscarCep(cep: string): Promise<Resultado<EnderecoCep>> {
  const digitos = cep.replace(/\D/g, '')
  if (digitos.length !== 8) return { ok: false, erro: 'CEP incompleto.' }

  const r = await chamarApi<{
    street: string | null
    district: string | null
    city: string | null
    state: string | null
  }>(`/enderecos/cep/${digitos}`)
  if (!r.ok) return { ok: false, erro: r.message }

  /* Campo ausente vira vazio: CEP de cidade inteira nao tem logradouro. */
  return {
    ok: true,
    dados: {
      logradouro: r.dados.street ?? '',
      bairro: r.dados.district ?? '',
      cidade: r.dados.city ?? '',
      uf: r.dados.state ?? '',
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Cadastro da loja                                                           */
/* -------------------------------------------------------------------------- */

export type DadosEmpresa = {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  ramoAtividade: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  ddd: string
  celular: string
}

type EmpresaDaApi = {
  cnpj: string
  legalName: string
  tradeName: string
  phone: string
  stateRegistration: string | null
  municipalRegistration: string | null
  businessSegment: string | null
  address: {
    zipCode: string | null
    street: string | null
    number: string | null
    complement: string | null
    district: string | null
    city: string | null
    state: string | null
  }
}

/** Nulo da api vira `''`, que e o que um campo aceita. */
function paraTela(e: EmpresaDaApi): DadosEmpresa {
  const digitos = e.phone.replace(/\D/g, '')
  return {
    cnpj: e.cnpj,
    razaoSocial: e.legalName,
    nomeFantasia: e.tradeName,
    inscricaoEstadual: e.stateRegistration ?? '',
    inscricaoMunicipal: e.municipalRegistration ?? '',
    ramoAtividade: e.businessSegment ?? '',
    cep: e.address.zipCode ?? '',
    logradouro: e.address.street ?? '',
    numero: e.address.number ?? '',
    complemento: e.address.complement ?? '',
    bairro: e.address.district ?? '',
    cidade: e.address.city ?? '',
    uf: e.address.state ?? '',
    /* Menos de dez digitos nao tem DDD: cortar inventaria um codigo de area. */
    ddd: digitos.length >= 10 ? digitos.slice(0, 2) : '',
    celular: digitos.length >= 10 ? digitos.slice(2) : digitos,
  }
}

export async function carregarEmpresa(): Promise<Resultado<DadosEmpresa>> {
  const r = await chamarApi<EmpresaDaApi>('/empresa')
  return r.ok ? { ok: true, dados: paraTela(r.dados) } : { ok: false, erro: r.message }
}

/**
 * Grava o cadastro — RF-003.
 *
 * Campo vazio NAO viaja: o contrato tem minimos de tamanho, e mandar
 * `stateRegistration: ''` recusaria o MEI que nao tem inscricao. Ausente e
 * "nao mexa". O CNPJ tambem nao vai — o contrato o omite, e o `.strict()`
 * recusaria o pedido inteiro.
 *
 * Devolve o que o SERVIDOR gravou, para a tela nao discordar do banco.
 */
export async function salvarEmpresa(dados: DadosEmpresa): Promise<Resultado<DadosEmpresa>> {
  const seTiver = (chave: string, valor: string) =>
    valor.trim() === '' ? {} : { [chave]: valor.trim() }

  const endereco = {
    ...seTiver('zipCode', dados.cep.replace(/\D/g, '')),
    ...seTiver('street', dados.logradouro),
    ...seTiver('number', dados.numero),
    ...seTiver('complement', dados.complemento),
    ...seTiver('district', dados.bairro),
    ...seTiver('city', dados.cidade),
    ...seTiver('state', dados.uf.toUpperCase()),
  }
  const telefone = `${dados.ddd}${dados.celular}`.replace(/\D/g, '')

  const r = await chamarApi<EmpresaDaApi>('/empresa', {
    method: 'PUT',
    body: {
      ...seTiver('legalName', dados.razaoSocial),
      ...seTiver('tradeName', dados.nomeFantasia),
      ...(telefone === '' ? {} : { phone: telefone }),
      ...seTiver('stateRegistration', dados.inscricaoEstadual),
      ...seTiver('municipalRegistration', dados.inscricaoMunicipal),
      ...seTiver('businessSegment', dados.ramoAtividade),
      ...(Object.keys(endereco).length === 0 ? {} : { address: endereco }),
    },
  })
  return r.ok ? { ok: true, dados: paraTela(r.dados) } : { ok: false, erro: r.message }
}

export const RAMOS_ATIVIDADE = [
  'Comércio varejista de alimentos',
  'Mercearia e minimercado',
  'Restaurante e lanchonete',
  'Padaria e confeitaria',
  'Moda e vestuário',
  'Calçados e acessórios',
  'Farmácia e saúde',
  'Salão de beleza e estética',
  'Casa, construção e ferragens',
  'Papelaria e informática',
  'Pet shop',
  'Oficina e autopeças',
  'Serviços em geral',
  'Outro',
]

export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]
