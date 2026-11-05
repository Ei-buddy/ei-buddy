import type { SupplierOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/** O endereco do fornecedor, campo a campo, tudo anulavel. */
export type EnderecoDoFornecedor = SupplierOutput['address']

export type NewSupplier = {
  readonly companyId: CompanyId
  readonly name: string
  readonly tradeName: string | null
  readonly document: string | null
  readonly stateRegistration: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly contactName: string | null
  readonly address: EnderecoDoFornecedor
  readonly notes: string | null
  readonly createdBy: UserId | null
  readonly createdAt: Date
}

/** Ausente nao mexe; `null` apaga. O endereco vai inteiro. */
export type SupplierPatch = {
  readonly name?: string | undefined
  readonly tradeName?: string | null | undefined
  readonly document?: string | null | undefined
  readonly stateRegistration?: string | null | undefined
  readonly email?: string | null | undefined
  readonly phone?: string | null | undefined
  readonly contactName?: string | null | undefined
  readonly address?: EnderecoDoFornecedor | undefined
  readonly notes?: string | null | undefined
  readonly isActive?: boolean | undefined
}

/** Cadastro de fornecedor — NR-191. */
export type SupplierRepository = {
  list(
    companyId: CompanyId,
    filtro: { readonly termo?: string; readonly somenteAtivos: boolean; readonly limite: number },
  ): Promise<readonly SupplierOutput[]>
  /** So o que nao foi excluido. */
  findById(companyId: CompanyId, id: string): Promise<SupplierOutput | undefined>
  findByDocument(companyId: CompanyId, document: string): Promise<SupplierOutput | undefined>
  insert(novo: NewSupplier): Promise<SupplierOutput>
  update(companyId: CompanyId, id: string, patch: SupplierPatch): Promise<SupplierOutput>
  /** Exclusao logica: a compra antiga continua apontando para ele. */
  remove(companyId: CompanyId, id: string, quando: Date): Promise<void>
}
