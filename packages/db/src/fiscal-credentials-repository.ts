import type { CredenciaisFocusNfe, DadosDaEmpresaFocus, EmpresaNaFocus } from '@na-regua/fiscal'
import type { Sql } from 'postgres'
import { cifrar, decifrar } from './secret-box.js'
import { withTenant } from './tenant.js'

/**
 * Credenciais fiscais por empresa — NR-042, RF-004, RNF-022.
 *
 * Satisfaz `CredenciaisFocusNfe`, que o adapter declara. O adapter nunca ve
 * texto cifrado nem chave: ele pede o token e recebe o token, e onde ele estava
 * guardado e problema deste modulo.
 *
 * ## O aviso de vencimento (RF-004) NAO esta aqui, e o motivo importa
 *
 * "Avisar 30 dias antes" e uma varredura da PLATAFORMA: ela pergunta sobre
 * TODAS as empresas, e por isso nao cabe em `withTenant`. Tambem nao cabe em
 * `withPlatformScope` — a politica de isolamento recusa ler tabela de negocio
 * sem `app.company_id` definido, que e exatamente o que a ADR-0001 quer.
 *
 * Fazer a varredura exigiria um papel que escapa da politica, e conceder isso a
 * um worker e decisao de seguranca, nao de codigo. E a mesma lacuna do
 * `listOverdue` (ver apps/worker/src/composition.ts): o repositorio ainda nao
 * tem mecanismo de leitura de plataforma.
 *
 * Por isso a coluna `certificate_expires_at` fica em claro e a consulta nao
 * existe — em vez de existir e lancar. Metodo que sempre falha e pior que
 * metodo ausente: ele parece pronto.
 */

/** O que a empresa configurou. Segredos NAO entram aqui. */
export type SituacaoFiscalDaEmpresa = {
  readonly companyId: string
  readonly temToken: boolean
  readonly temCertificado: boolean
  /** Nulo quando nao ha certificado. Em claro — ver a migration 0015. */
  readonly certificadoVenceEm: string | null
  /** CSC de producao configurado — NR-183. */
  readonly temCscProducao: boolean
  readonly temCscHomologacao: boolean
  /** Ultimo cadastro aceito pela Focus, ou nulo se nunca foi. */
  readonly focusSincronizadaEm: string | null
  /** O que a Focus disse na ultima recusa. Nulo depois de um cadastro aceito. */
  readonly focusErro: string | null
}

/** Os dados da loja que o cadastro na Focus precisa — NR-183. */
export type CadastroFiscalDaEmpresa = Omit<DadosDaEmpresaFocus, 'regimeTributario'> & {
  readonly regime: string
}

function paraDia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10)
  const mes = String(v.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(v.getUTCDate()).padStart(2, '0')
  return `${v.getUTCFullYear()}-${mes}-${dia}`
}

export function createFiscalCredentials(
  sql: Sql,
  chave: Buffer,
  opcoes: {
    /**
     * Qual token de EMISSAO `tokenDe` devolve — NR-183. A Focus da um por
     * ambiente; sem o de homologacao (empresa cadastrada antes da revenda),
     * cai no `focus_token`, que e o que existia.
     */
    readonly ambiente?: 'homologacao' | 'producao'
  } = {},
): CredenciaisFocusNfe & {
  /**
   * Grava ou substitui as credenciais.
   *
   * Cifra AQUI, e nao em quem chama: um unico lugar decide o algoritmo, e nao
   * ha caminho em que alguem grave texto puro por esquecimento.
   */
  salvar(entrada: {
    readonly companyId: string
    readonly focusToken?: string
    readonly certificadoBase64?: string
    readonly senhaDoCertificado?: string
    readonly certificadoVenceEm?: string
    readonly cscProducao?: { readonly id: string; readonly codigo: string }
    readonly cscHomologacao?: { readonly id: string; readonly codigo: string }
    readonly atualizadoPor: string
  }): Promise<void>

  /**
   * Tudo o que o cadastro na Focus precisa, ja decifrado — NR-183.
   *
   * `undefined` quando a empresa nao existe. Quem chama decide o que fazer
   * com cadastro incompleto (falta de endereco, de certificado): aqui so se le.
   */
  dadosParaFocus(companyId: string): Promise<CadastroFiscalDaEmpresa | undefined>

  /** Grava o desfecho do cadastro na Focus: os tokens, ou a recusa. */
  registrarFocus(
    companyId: string,
    resultado:
      | { readonly ok: true; readonly empresa: EmpresaNaFocus }
      | { readonly ok: false; readonly mensagem: string },
  ): Promise<void>

  /** O que esta configurado, sem os segredos — para a tela de Empresa. */
  situacao(companyId: string): Promise<SituacaoFiscalDaEmpresa>
} {
  type Linha = {
    focus_token: string | null
    focus_token_homologacao: string | null
    certificate: string | null
    certificate_password: string | null
    certificate_expires_at: Date | string | null
    csc_producao: string | null
    csc_id_producao: string | null
    csc_homologacao: string | null
    csc_id_homologacao: string | null
    focus_company_id: string | null
    focus_synced_at: Date | string | null
    focus_sync_error: string | null
  }

  const ler = async (companyId: string): Promise<Linha | undefined> => {
    const [linha] = await withTenant(
      sql,
      companyId,
      (tx) => tx<Linha[]>`
        SELECT focus_token, focus_token_homologacao, certificate, certificate_password,
               certificate_expires_at, csc_producao, csc_id_producao, csc_homologacao,
               csc_id_homologacao, focus_company_id, focus_synced_at, focus_sync_error
        FROM company_fiscal_credentials WHERE company_id = ${companyId}
      `,
    )
    return linha
  }

  return {
    /**
     * `undefined` quando a empresa nao configurou — e nao um erro.
     *
     * Falta de credencial e estado normal: a maioria comeca a vender antes de
     * emitir nota. Quem transforma isso em recusa e o adapter, com uma mensagem
     * que diz o que configurar.
     */
    tokenDe: async (companyId) => {
      const linha = await ler(companyId)
      const cifrado =
        opcoes.ambiente === 'homologacao'
          ? (linha?.focus_token_homologacao ?? linha?.focus_token)
          : linha?.focus_token
      if (cifrado == null) return undefined

      return decifrar(cifrado, chave, companyId)
    },

    /**
     * O CNPJ do emitente sai de `companies`, e nao daqui.
     *
     * Ele nao e segredo e ja tem dono: duplica-lo nesta tabela criaria duas
     * respostas para "qual e o CNPJ desta empresa", e elas divergiriam na
     * primeira correcao de cadastro.
     */
    cnpjDe: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ cnpj: string }[]>`SELECT cnpj FROM companies WHERE id = ${companyId}`,
      )
      return linha?.cnpj
    },

    salvar: async (entrada) => {
      const cifrado = (valor: string | undefined) =>
        valor === undefined ? null : cifrar(valor, chave, entrada.companyId)

      await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx`
          INSERT INTO company_fiscal_credentials
            (company_id, focus_token, certificate, certificate_password,
             certificate_expires_at, csc_producao, csc_id_producao, csc_homologacao,
             csc_id_homologacao, updated_by, updated_at)
          VALUES (
            ${entrada.companyId},
            ${cifrado(entrada.focusToken)},
            ${cifrado(entrada.certificadoBase64)},
            ${cifrado(entrada.senhaDoCertificado)},
            ${entrada.certificadoVenceEm ?? null},
            ${cifrado(entrada.cscProducao?.codigo)},
            ${entrada.cscProducao?.id ?? null},
            ${cifrado(entrada.cscHomologacao?.codigo)},
            ${entrada.cscHomologacao?.id ?? null},
            ${entrada.atualizadoPor},
            now()
          )
          ON CONFLICT (company_id) DO UPDATE SET
            /* \`COALESCE\` com o valor ANTIGO: quem troca so o certificado nao
               perde o token. Sobrescrever com nulo apagaria a emissao inteira
               numa tela que so queria atualizar um campo. */
            focus_token = COALESCE(EXCLUDED.focus_token, company_fiscal_credentials.focus_token),
            certificate = COALESCE(EXCLUDED.certificate, company_fiscal_credentials.certificate),
            certificate_password = COALESCE(
              EXCLUDED.certificate_password, company_fiscal_credentials.certificate_password
            ),
            certificate_expires_at = COALESCE(
              EXCLUDED.certificate_expires_at, company_fiscal_credentials.certificate_expires_at
            ),
            csc_producao = COALESCE(EXCLUDED.csc_producao, company_fiscal_credentials.csc_producao),
            csc_id_producao = COALESCE(
              EXCLUDED.csc_id_producao, company_fiscal_credentials.csc_id_producao
            ),
            csc_homologacao = COALESCE(
              EXCLUDED.csc_homologacao, company_fiscal_credentials.csc_homologacao
            ),
            csc_id_homologacao = COALESCE(
              EXCLUDED.csc_id_homologacao, company_fiscal_credentials.csc_id_homologacao
            ),
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
        `,
      )
    },

    situacao: async (companyId) => {
      const linha = await ler(companyId)

      /* Booleanos, e nunca o valor. A tela precisa saber SE esta configurado —
         mostrar o token seria desfazer a cifragem na saida. */
      return {
        companyId,
        temToken: linha?.focus_token != null,
        temCertificado: linha?.certificate != null,
        certificadoVenceEm:
          linha?.certificate_expires_at == null ? null : paraDia(linha.certificate_expires_at),
        temCscProducao: linha?.csc_producao != null,
        temCscHomologacao: linha?.csc_homologacao != null,
        focusSincronizadaEm:
          linha?.focus_synced_at == null ? null : new Date(linha.focus_synced_at).toISOString(),
        focusErro: linha?.focus_sync_error ?? null,
      }
    },

    dadosParaFocus: async (companyId) => {
      type Empresa = {
        legal_name: string
        trade_name: string | null
        cnpj: string
        state_registration: string | null
        municipal_registration: string | null
        tax_regime: string
        email: string | null
        phone: string | null
        postal_code: string | null
        street: string | null
        street_number: string | null
        complement: string | null
        neighborhood: string | null
        city: string | null
        state: string | null
      }
      const [empresa] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Empresa[]>`
          SELECT legal_name, trade_name, cnpj, state_registration, municipal_registration,
                 tax_regime, email, phone, postal_code, street, street_number, complement,
                 neighborhood, city, state
          FROM companies WHERE id = ${companyId}
        `,
      )
      if (empresa === undefined) return undefined
      const linha = await ler(companyId)
      const abrir = (v: string | null | undefined) =>
        v == null ? undefined : decifrar(v, chave, companyId)

      const certificado = abrir(linha?.certificate)
      const senha = abrir(linha?.certificate_password)
      const cscProd = abrir(linha?.csc_producao)
      const cscHomo = abrir(linha?.csc_homologacao)
      const texto = (v: string | null) => v ?? undefined

      return {
        ...(linha?.focus_company_id == null ? {} : { focusId: linha.focus_company_id }),
        razaoSocial: empresa.legal_name,
        ...(empresa.trade_name === null ? {} : { nomeFantasia: empresa.trade_name }),
        cnpj: empresa.cnpj,
        ...(empresa.state_registration === null
          ? {}
          : { inscricaoEstadual: empresa.state_registration }),
        ...(empresa.municipal_registration === null
          ? {}
          : { inscricaoMunicipal: empresa.municipal_registration }),
        regime: empresa.tax_regime,
        ...(empresa.email === null ? {} : { email: empresa.email }),
        ...(empresa.phone === null ? {} : { telefone: empresa.phone }),
        endereco: {
          cep: texto(empresa.postal_code) ?? '',
          logradouro: texto(empresa.street) ?? '',
          numero: texto(empresa.street_number) ?? '',
          ...(empresa.complement === null ? {} : { complemento: empresa.complement }),
          bairro: texto(empresa.neighborhood) ?? '',
          municipio: texto(empresa.city) ?? '',
          uf: texto(empresa.state) ?? '',
        },
        ...(certificado === undefined || senha === undefined
          ? {}
          : { certificado: { base64: certificado, senha } }),
        ...(cscProd === undefined || linha?.csc_id_producao == null
          ? {}
          : { cscProducao: { id: linha.csc_id_producao, codigo: cscProd } }),
        ...(cscHomo === undefined || linha?.csc_id_homologacao == null
          ? {}
          : { cscHomologacao: { id: linha.csc_id_homologacao, codigo: cscHomo } }),
      }
    },

    registrarFocus: async (companyId, resultado) => {
      if (resultado.ok) {
        await withTenant(
          sql,
          companyId,
          (tx) => tx`
            UPDATE company_fiscal_credentials SET
              focus_company_id = ${resultado.empresa.focusId},
              focus_token = ${cifrar(resultado.empresa.tokenProducao, chave, companyId)},
              focus_token_homologacao = ${cifrar(resultado.empresa.tokenHomologacao, chave, companyId)},
              focus_synced_at = now(),
              focus_sync_error = NULL
            WHERE company_id = ${companyId}
          `,
        )
        return
      }
      await withTenant(
        sql,
        companyId,
        (tx) => tx`
          UPDATE company_fiscal_credentials SET focus_sync_error = ${resultado.mensagem.slice(0, 500)}
          WHERE company_id = ${companyId}
        `,
      )
    },
  }
}
