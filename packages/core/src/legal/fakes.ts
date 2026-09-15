import type { TipoDeDocumentoLegal } from '@na-regua/contracts'
import type { UserId } from '../context.js'
import type { LegalConsentRepository } from '../ports/legal-consent-repository.js'

type Registro = {
  userId: UserId
  type: TipoDeDocumentoLegal
  version: string
  acceptedAt: Date
  ip?: string
  userAgent?: string
}

/**
 * Falso de `LegalConsentRepository`.
 *
 * Guarda TUDO numa lista e so filtra na leitura — de proposito: se o falso
 * sobrescrevesse o aceite anterior, o teste de "historico preservado" passaria
 * contra um falso que mente, e a regra que mais importa aqui (append-only)
 * ficaria sem cobertura real.
 */
export class InMemoryLegalConsentRepository implements LegalConsentRepository {
  readonly registros: Registro[] = []
  private relogio = 0

  async record(input: {
    userId: UserId
    type: TipoDeDocumentoLegal
    version: string
    ip?: string
    userAgent?: string
  }): Promise<void> {
    /* Relogio proprio: dois aceites no mesmo milissegundo real embaralhariam
       a ordem, e e a ORDEM que decide qual e o mais recente. */
    this.relogio += 1
    this.registros.push({
      ...input,
      acceptedAt: new Date(this.relogio * 1000),
    })
  }

  async latestFor(userId: UserId) {
    const ultimos = new Map<TipoDeDocumentoLegal, Registro>()
    for (const r of this.registros) {
      if (r.userId !== userId) continue
      const atual = ultimos.get(r.type)
      if (atual === undefined || r.acceptedAt >= atual.acceptedAt) ultimos.set(r.type, r)
    }
    return [...ultimos.values()].map((r) => ({
      type: r.type,
      version: r.version,
      acceptedAt: r.acceptedAt,
    }))
  }
}
