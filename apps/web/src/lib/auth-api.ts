/**
 * ============================================================================
 * PONTOS DE INTEGRACAO COM O BACKEND
 * ============================================================================
 *
 * O login e real (`/api/session`, ver LoginForm), o cadastro tambem
 * (`createAccount`), e o cupom de indicacao (`validateCoupon`). O que ainda e
 * SIMULADO aqui marca onde entra a chamada real — as telas nao precisam mudar
 * desde que o formato de retorno seja mantido.
 *
 *  | Funcao                  | Endpoint esperado                  | Quando            |
 *  |-------------------------|------------------------------------|-------------------|
 *  | createPixCharge         | POST /billing/charges (pix)        | entrada na etapa 4|
 *  | fetchPixChargeStatus    | GET  /billing/charges/:id          | polling da etapa 4|
 *
 * O polling da etapa 4 deve idealmente ser trocado por webhook + SSE/websocket
 * quando o backend suportar; a UI ja trata os quatro estados.
 */

export type SubscriptionStatus = 'active' | 'overdue' | 'trial'

/** Atraso artificial so para exercitar os estados de loading da UI. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/* Cadastro                                                                   */
/* -------------------------------------------------------------------------- */

export type CouponResult =
  | { status: 'valid'; code: string; partner: string; benefit: string }
  | { status: 'invalid'; message: string }

/**
 * Confere o cupom de quem indicou — RF-114, RF-115 (`GET /cupons/:codigo`).
 *
 * A tela chama com debounce. O beneficio e dito em PERCENTUAL e sem valor em
 * reais: o preco ainda nao existe (QST-002), e o desconto vale um ciclo
 * (ADR-0013) — dizer "nos 3 primeiros meses" prometeria o que ninguem cobra.
 */
export async function validateCoupon(code: string): Promise<CouponResult> {
  let resposta: Response
  try {
    resposta = await fetch(`/api/cupons/${encodeURIComponent(code.trim())}`, {
      credentials: 'same-origin',
    })
  } catch {
    return { status: 'invalid', message: 'Não foi possível conferir o cupom agora.' }
  }

  const corpo = (await resposta.json().catch(() => ({}))) as
    | { status: 'valid'; code: string; referrerLabel: string; discountPercent: number }
    | { status: 'rejected'; rejection: { message: string } }
    | { error?: { message?: string } }

  if (resposta.ok && 'status' in corpo && corpo.status === 'valid') {
    return {
      status: 'valid',
      code: corpo.code,
      partner: corpo.referrerLabel,
      benefit: `${String(corpo.discountPercent).replace('.', ',')}% de desconto na primeira mensalidade`,
    }
  }
  if (resposta.ok && 'status' in corpo && corpo.status === 'rejected') {
    return { status: 'invalid', message: corpo.rejection.message }
  }
  return {
    status: 'invalid',
    message:
      resposta.status === 429
        ? 'Muitas tentativas. Espere um minuto e tente de novo.'
        : ('error' in corpo && corpo.error?.message) || 'Não foi possível conferir o cupom agora.',
  }
}

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'

export type SignupData = {
  nome: string
  email: string
  telefone: string
  senha: string
  /**
   * A LOJA. Sem estes dois nao ha cadastro — RF-001, RF-002.
   *
   * Eles faltavam no formulario, e por isso o cadastro nao podia funcionar: a
   * api cria pessoa e empresa juntas, e uma pessoa sem loja nao consegue fazer
   * nada no sistema.
   */
  razaoSocial: string
  cnpj: string
  cupom: string | null
  /**
   * Conta de Parceiro — NR-115, ADR-0013. Ausente = lojista (default), mesmo
   * comportamento de sempre. Presente = candidatura pending; a sessao abre
   * normal, so o cupom do Parceiro fica inativo ate a aprovacao.
   */
  accountType?: 'parceiro'
  pixKey?: string
  pixKeyType?: PixKeyType
  partnerMessage?: string
  /** Ausente = o backend sugere a partir do nome da empresa (RF-03). */
  couponName?: string
}

/**
 * Cria a conta — NR-014, RF-001, RF-002.
 *
 * Devolve a sessao JA ABERTA: o token vai para o cookie `httpOnly` no proprio
 * handler, e quem cadastrou entra direto. Antes esta funcao era um `delay` que
 * devolvia um id inventado — nada era criado, e o login depois falhava sem
 * explicacao.
 */
export async function createAccount(
  data: SignupData,
): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  let resposta: Response
  try {
    resposta = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        name: data.nome,
        email: data.email,
        ...(data.telefone.trim() === '' ? {} : { phone: data.telefone }),
        secret: data.senha,
        legalName: data.razaoSocial,
        cnpj: data.cnpj,
        /*
         * RF-02. Nao e um campo do formulario que viaja junto: o contrato
         * exige `true` literal, e a tela so chega aqui depois do checkbox
         * marcado (`disabled={!aceitou}`). Mandar o valor do estado abriria a
         * porta para um `false` chegar ao servidor e virar 400 sem que nada
         * na tela explicasse por que.
         */
        acceptedLegalTerms: true,
        /* So o cupom que a tela ja conferiu como valido: o servidor confere
           de novo e grava o vinculo com quem indicou (RF-114). */
        ...(data.cupom === null ? {} : { referralCode: data.cupom }),
        ...(data.accountType !== 'parceiro'
          ? {}
          : {
              account: {
                type: 'parceiro',
                pixKey: data.pixKey,
                pixKeyType: data.pixKeyType,
                message: data.partnerMessage,
                ...(data.couponName === undefined ? {} : { couponCode: data.couponName }),
              },
            }),
      }),
    })
  } catch {
    return { ok: false, error: 'Sem conexao. Verifique sua internet.' }
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    userId?: string
    error?: { message?: string; fields?: { path: string; message: string }[] }
  }

  if (!resposta.ok) {
    /* A mensagem do CAMPO quando existe: "confira os campos indicados" nao diz
       qual campo, e o formulario precisa apontar para um. */
    const doCampo = corpo.error?.fields?.[0]?.message
    return {
      ok: false,
      error: doCampo ?? corpo.error?.message ?? 'Nao foi possivel criar a conta.',
    }
  }

  return { ok: true, accountId: corpo.userId ?? '' }
}

/* -------------------------------------------------------------------------- */
/* Cobranca Pix                                                               */
/* -------------------------------------------------------------------------- */

export type PixCharge = {
  chargeId: string
  /** Payload "copia e cola" — e o conteudo que vira o QR Code. */
  payload: string
  /** Timestamp (ms) em que o codigo expira. */
  expiresAt: number
  amount: number
  planName: string
}

export type PixChargeStatus = 'pending' | 'paid' | 'expired'

/** Minutos de validade do codigo Pix. */
export const PIX_EXPIRATION_MINUTES = 15

/**
 * SUBSTITUIR POR: POST /billing/charges
 *
 * O backend devolve o payload Pix (BR Code) gerado pelo PSP. O front apenas
 * transforma essa string em QR Code — nunca monta o payload sozinho.
 */
export async function createPixCharge(planName: string, amount: number): Promise<PixCharge> {
  await delay(800)

  const chargeId = `chg-${Math.random().toString(36).slice(2, 10)}`

  /* Payload de exemplo no formato BR Code. O real vem pronto do PSP. */
  const payload = [
    '00020126580014BR.GOV.BCB.PIX0136',
    chargeId.padEnd(36, '0'),
    '52040000530398654',
    amount.toFixed(2).padStart(6, '0'),
    '5802BR5913EI BUDDY LTDA6008CURITIBA62070503***6304',
  ].join('')

  return {
    chargeId,
    payload,
    expiresAt: Date.now() + PIX_EXPIRATION_MINUTES * 60_000,
    amount,
    planName,
  }
}

/**
 * SUBSTITUIR POR: GET /billing/charges/:id
 *
 * A UI faz polling a cada 4s enquanto o estado for "pending". Quando houver
 * webhook no backend, trocar por SSE/websocket e remover o polling.
 */
export async function fetchPixChargeStatus(chargeId: string): Promise<PixChargeStatus> {
  await delay(500)
  void chargeId
  /* Sem backend nao ha como confirmar de verdade: a tela oferece um botao
     explicito de simulacao para demonstrar o estado "pago". */
  return 'pending'
}
