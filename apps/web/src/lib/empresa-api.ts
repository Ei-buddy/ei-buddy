/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — TELA DE EMPRESA
 * ============================================================================
 *
 * Nada aqui e simulado. A ultima simulacao a cair foram as consultas de CEP
 * e CNPJ (NR-072), que devolviam tres CEPs de Curitiba e uma empresa de
 * exemplo; o cadastro ja era de verdade desde a migration 0021.
 *
 *  | Funcao              | Endpoint                       | Disparo            |
 *  |---------------------|--------------------------------|--------------------|
 *  | carregarEmpresa     | GET  /empresa                  | abrir a tela       |
 *  | salvarEmpresa       | PUT  /empresa                  | submit do form     |
 *  | buscarCep           | GET /enderecos/cep/:cep        | CEP completo (8)   |
 *  | buscarCnpj          | GET /empresas/cnpj/:cnpj       | botao "Buscar dados"|
 *  | enviarCertificado   | PUT  /empresa/credenciais-fiscais | upload do .pfx  |
 *
 * DECISAO (cumprida em NR-072): as consultas de CEP e CNPJ passam pelo NOSSO
 * backend, e nao direto do navegador para ViaCEP/ReceitaWS. Motivos:
 *   - a chave e a cota do servico ficam no servidor, nao expostas no bundle;
 *   - da para cachear (CEP muda pouco) e nao estourar limite de terceiro;
 *   - o front nao quebra se o fornecedor for trocado.
 *
 * O CERTIFICADO DIGITAL NUNCA DEVE SER PROCESSADO NO NAVEGADOR. O arquivo
 * .pfx e a senha vao direto para o backend por HTTPS; a validade exibida na
 * tela vem da resposta do servidor, que e quem abre o certificado. O front
 * so mostra o resultado.
 */

import { pedir, type Resultado } from './http'

/* -------------------------------------------------------------------------- */
/* CEP                                                                        */
/* -------------------------------------------------------------------------- */

export type EnderecoCep = {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

export type CepResult = { ok: true; endereco: EnderecoCep } | { ok: false; error: string }

/**
 * Busca o endereco pelo CEP — NR-072.
 *
 * Ate aqui era uma base de tres CEPs de Curitiba: qualquer outro voltava "CEP
 * nao encontrado", e o lojista de Sao Paulo concluia que o campo estava
 * quebrado. Agora vai a BrasilAPI pelo nosso backend.
 *
 * A resposta da API traz tambem latitude e longitude (ADR-0008); a tela so
 * precisa do endereco e ignora o resto.
 */
export async function buscarCep(cep: string): Promise<CepResult> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) {
    return { ok: false, error: 'CEP incompleto.' }
  }

  const r = await pedir<RespostaCep>(`/api/enderecos/cep/${digits}`)
  if (!r.ok) return { ok: false, error: r.erro }

  /* Campo ausente vira string vazia, e nao "null" escrito dentro do input: o
     provedor as vezes conhece a cidade e nao o logradouro (CEP de cidade
     inteira), e ai o lojista digita a rua. */
  return {
    ok: true,
    endereco: {
      logradouro: r.dados.street ?? '',
      bairro: r.dados.district ?? '',
      cidade: r.dados.city ?? '',
      uf: r.dados.state ?? '',
    },
  }
}

/** O que a API devolve — `CepAddress` do core, em JSON. */
type RespostaCep = {
  street: string | null
  district: string | null
  city: string | null
  state: string | null
}

/* -------------------------------------------------------------------------- */
/* CNPJ                                                                       */
/* -------------------------------------------------------------------------- */

export type DadosCnpj = {
  razaoSocial: string
  nomeFantasia: string
  ramoAtividade: string
  cep: string
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  uf: string
}

export type CnpjResult = { ok: true; dados: DadosCnpj } | { ok: false; error: string }

/**
 * Busca os dados da empresa pelo CNPJ — NR-072.
 *
 * Devolvia sempre a mesma empresa de exemplo ("Mercearia Sol Nascente LTDA"),
 * para qualquer CNPJ de quatorze digitos. Agora vai a BrasilAPI pelo backend.
 *
 * O que vem daqui e SUGESTAO: os campos chegam preenchidos e o lojista pode
 * corrigir qualquer um antes de salvar. Por isso campo ausente nao e erro —
 * falta o fantasia, o lojista escreve o fantasia.
 */
export async function buscarCnpj(cnpj: string): Promise<CnpjResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) {
    return { ok: false, error: 'Informe o CNPJ completo antes de buscar.' }
  }

  const r = await pedir<RespostaCnpj>(`/api/empresas/cnpj/${digits}`)
  if (!r.ok) return { ok: false, error: r.erro }

  return {
    ok: true,
    dados: {
      razaoSocial: r.dados.legalName,
      nomeFantasia: r.dados.tradeName ?? '',
      ramoAtividade: r.dados.mainActivity ?? '',
      cep: formatarCep(r.dados.zipCode),
      logradouro: r.dados.street ?? '',
      numero: r.dados.streetNumber ?? '',
      bairro: r.dados.district ?? '',
      cidade: r.dados.city ?? '',
      uf: r.dados.state ?? '',
    },
  }
}

/** O que a API devolve — `CnpjCompany` do core, em JSON. */
type RespostaCnpj = {
  legalName: string
  tradeName: string | null
  mainActivity: string | null
  zipCode: string | null
  street: string | null
  streetNumber: string | null
  district: string | null
  city: string | null
  state: string | null
  registrationStatus: string | null
}

/** A API devolve so digitos; o campo da tela usa mascara. */
function formatarCep(digitos: string | null): string {
  if (digitos === null || digitos.length !== 8) return ''
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`
}

/* -------------------------------------------------------------------------- */
/* Certificado digital                                                        */
/* -------------------------------------------------------------------------- */

export type StatusCertificado = 'ausente' | 'valido' | 'expirado'

export type Certificado = {
  status: StatusCertificado
  nomeArquivo: string
  /** Data de expiracao no formato ISO (AAAA-MM-DD). */
  validoAte: string
}

/**
 * A configuracao de emissao fiscal — NR-042, RF-004.
 *
 * ## O certificado NAO e aberto no navegador
 *
 * O arquivo vai em base64 e a senha vai junto, direto para a api por HTTPS, que
 * cifra os dois antes de tocar o banco. O navegador nao abre o `.pfx`, nao le a
 * senha e nao guarda nenhum dos dois.
 *
 * ## Por que a tela pergunta a validade
 *
 * A versao anterior desta funcao prometia que "o backend abre o .pfx e extrai
 * titular e validade". Ler PKCS#12 exige biblioteca que o projeto nao tem, e
 * escolher uma so para isso e decisao que nao cabia nesta tarefa.
 *
 * Entao a validade e PERGUNTADA. E pior para quem cadastra e melhor que a
 * alternativa: sem ela, o aviso de vencimento (RF-004) e impossivel, e o
 * lojista descobriria que o certificado venceu quando a nota parasse de sair.
 *
 * O TITULAR saiu da tela pelo mesmo motivo — sem abrir o arquivo, exibi-lo
 * seria inventar.
 */
export type SituacaoFiscal = {
  hasToken: boolean
  hasCertificate: boolean
  certificateExpiresAt: string | null
}

async function chamarFiscal(
  init?: RequestInit,
): Promise<{ ok: true; dados: SituacaoFiscal } | { ok: false; error: string }> {
  let resposta: Response
  try {
    resposta = await fetch('/api/empresa/credenciais-fiscais', {
      ...init,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  const corpo = (await resposta.json().catch(() => ({}))) as SituacaoFiscal & {
    error?: { message?: string }
  }

  if (!resposta.ok) {
    return { ok: false, error: corpo.error?.message ?? 'Nao foi possivel salvar.' }
  }

  return { ok: true, dados: corpo }
}

export const carregarSituacaoFiscal = () => chamarFiscal()

/** Guarda o token do emissor. */
export const salvarTokenFiscal = (focusToken: string) =>
  chamarFiscal({ method: 'PUT', body: JSON.stringify({ focusToken }) })

export type UploadResult = { ok: true; certificado: Certificado } | { ok: false; error: string }

export async function enviarCertificado(
  arquivo: File,
  senha: string,
  validoAte: string,
): Promise<UploadResult> {
  if (senha === '') return { ok: false, error: 'Informe a senha do certificado.' }
  if (validoAte === '') return { ok: false, error: 'Informe até quando o certificado vale.' }

  const nome = arquivo.name.toLowerCase()
  if (!nome.endsWith('.pfx') && !nome.endsWith('.p12')) {
    return { ok: false, error: 'O certificado precisa ser um arquivo .pfx ou .p12.' }
  }

  /*
   * Base64 em pedacos: `String.fromCharCode(...bytes)` de uma vez estoura a
   * pilha, e certificado com cadeia completa passa de 10 KB com folga.
   */
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let binario = ''
  const PEDACO = 0x8000
  for (let i = 0; i < bytes.length; i += PEDACO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + PEDACO))
  }

  const r = await chamarFiscal({
    method: 'PUT',
    body: JSON.stringify({
      certificateBase64: btoa(binario),
      certificatePassword: senha,
      certificateExpiresAt: validoAte,
    }),
  })

  if (!r.ok) return { ok: false, error: r.error }

  return {
    ok: true,
    certificado: {
      /* O estado vem da DATA que o servidor confirmou, e nao do que a tela
         achava — sao a mesma coisa hoje e nao serao no dia em que a api
         normalizar a entrada. */
      status:
        r.dados.certificateExpiresAt !== null &&
        r.dados.certificateExpiresAt < new Date().toISOString().slice(0, 10)
          ? 'expirado'
          : 'valido',
      nomeArquivo: arquivo.name,
      validoAte: r.dados.certificateExpiresAt ?? validoAte,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Gravacao                                                                   */
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
  conexoesHabilitadas: boolean
}

type EmpresaDaApi = {
  cnpj: string
  legalName: string
  tradeName: string
  email: string
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

/** O que a tela mostra. Nulo da api vira `''`, que e o que um input aceita. */
export type EmpresaCarregada = Omit<DadosEmpresa, 'conexoesHabilitadas'> & { email: string }

/**
 * O cadastro da loja — RF-003.
 *
 * Ate agora a tela abria com `lib/mock-data`: o CNPJ, o endereco e as
 * inscricoes de uma mercearia de exemplo, iguais para toda loja. Quem salvasse
 * sem reparar gravaria os dados de outra empresa por cima dos seus — e antes da
 * 0021 nem gravava, porque `salvarEmpresa` era `await delay(900)`.
 */
export async function carregarEmpresa(): Promise<Resultado<EmpresaCarregada>> {
  const r = await pedir<EmpresaDaApi>('/api/empresa')

  if (!r.ok) return r

  const e = r.dados
  const digitos = e.phone.replace(/\D/g, '')

  return {
    ok: true,
    dados: {
      cnpj: e.cnpj,
      razaoSocial: e.legalName,
      nomeFantasia: e.tradeName,
      email: e.email,
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
      /* Menos de dez digitos nao tem DDD: e um numero antigo ou incompleto, e
         cortar os dois primeiros ali inventaria um codigo de area. */
      ddd: digitos.length >= 10 ? digitos.slice(0, 2) : '',
      celular: digitos.length >= 10 ? digitos.slice(2) : digitos,
    },
  }
}

/**
 * Grava o cadastro — RF-003.
 *
 * Campo vazio NAO viaja. O contrato tem minimos de tamanho, e mandar
 * `stateRegistration: ''` seria recusado como inscricao invalida por quem
 * simplesmente nao a tem — MEI, por exemplo. Ausente significa "nao mexa", e a
 * api mantem o que estava.
 *
 * O CNPJ tambem nao vai: `updateCompanyInputSchema` o omite, e o `.strict()`
 * recusaria a requisicao inteira. Trocar CNPJ e outra empresa.
 */
export async function salvarEmpresa(dados: DadosEmpresa): Promise<Resultado<EmpresaCarregada>> {
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

  const r = await pedir<EmpresaDaApi>('/api/empresa', {
    method: 'PUT',
    body: JSON.stringify({
      ...seTiver('legalName', dados.razaoSocial),
      ...seTiver('tradeName', dados.nomeFantasia),
      ...(telefone === '' ? {} : { phone: telefone }),
      ...seTiver('stateRegistration', dados.inscricaoEstadual),
      ...seTiver('municipalRegistration', dados.inscricaoMunicipal),
      ...seTiver('businessSegment', dados.ramoAtividade),
      ...(Object.keys(endereco).length === 0 ? {} : { address: endereco }),
    }),
  })

  if (!r.ok) return r

  /* Devolve o que o SERVIDOR gravou, e nao o que foi digitado: o contrato
     apara espacos e normaliza o telefone, e mostrar o digitado deixaria a tela
     discordando do banco ate o proximo carregamento. */
  return carregarEmpresa()
}

/** Segmentos oferecidos no seletor de ramo de atividade. */
export const RAMOS_ATIVIDADE = [
  'Comercio varejista de alimentos',
  'Mercearia e minimercado',
  'Restaurante e lanchonete',
  'Padaria e confeitaria',
  'Moda e vestuario',
  'Calcados e acessorios',
  'Farmacia e saude',
  'Salao de beleza e estetica',
  'Casa, construcao e ferragens',
  'Papelaria e informatica',
  'Pet shop',
  'Oficina e autopecas',
  'Servicos em geral',
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
