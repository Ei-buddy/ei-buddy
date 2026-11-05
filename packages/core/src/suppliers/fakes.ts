import type { SupplierOutput } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'
import type {
  NewSupplier,
  SupplierPatch,
  SupplierRepository,
} from '../ports/supplier-repository.js'

type Guardado = SupplierOutput & { readonly companyId: CompanyId; readonly deletedAt: Date | null }

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Fornecedores em memoria — o mesmo comportamento do repositorio do banco. */
export class InMemorySuppliers implements SupplierRepository {
  private readonly registros: Guardado[] = []
  private sequencia = 0

  private vivo(companyId: CompanyId, id: string): Guardado | undefined {
    return this.registros.find((f) => f.companyId === companyId && f.id === id && !f.deletedAt)
  }

  private saida({ companyId: _c, deletedAt: _d, ...f }: Guardado): SupplierOutput {
    return f
  }

  async list(
    companyId: CompanyId,
    filtro: { readonly termo?: string; readonly somenteAtivos: boolean; readonly limite: number },
  ): Promise<readonly SupplierOutput[]> {
    const palavras = semAcento(filtro.termo ?? '')
      .split(/\s+/)
      .filter(Boolean)
    const digitos = (filtro.termo ?? '').replace(/\D/g, '')
    return this.registros
      .filter((f) => f.companyId === companyId && !f.deletedAt)
      .filter((f) => !filtro.somenteAtivos || f.isActive)
      .filter((f) => {
        if (palavras.length === 0) return true
        const nome = semAcento(`${f.name} ${f.tradeName ?? ''}`)
        if (palavras.every((p) => nome.includes(p))) return true
        return digitos.length >= 3 && `${f.document ?? ''}${f.phone ?? ''}`.includes(digitos)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, filtro.limite)
      .map((f) => this.saida(f))
  }

  async findById(companyId: CompanyId, id: string) {
    const f = this.vivo(companyId, id)
    return f === undefined ? undefined : this.saida(f)
  }

  async findByDocument(companyId: CompanyId, document: string) {
    const f = this.registros.find(
      (x) => x.companyId === companyId && x.document === document && !x.deletedAt,
    )
    return f === undefined ? undefined : this.saida(f)
  }

  async insert(novo: NewSupplier): Promise<SupplierOutput> {
    this.sequencia += 1
    const { companyId, createdBy: _quem, createdAt, ...campos } = novo
    const f: Guardado = {
      ...campos,
      id: `forn-${this.sequencia}`,
      isActive: true,
      createdAt: createdAt.toISOString(),
      companyId,
      deletedAt: null,
    }
    this.registros.push(f)
    return this.saida(f)
  }

  async update(companyId: CompanyId, id: string, patch: SupplierPatch): Promise<SupplierOutput> {
    const i = this.registros.findIndex((f) => f.companyId === companyId && f.id === id)
    const definidos = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    this.registros[i] = { ...this.registros[i]!, ...definidos }
    return this.saida(this.registros[i]!)
  }

  async remove(companyId: CompanyId, id: string, quando: Date): Promise<void> {
    const i = this.registros.findIndex((f) => f.companyId === companyId && f.id === id)
    this.registros[i] = { ...this.registros[i]!, deletedAt: quando }
  }
}
