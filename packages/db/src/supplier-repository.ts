import type { SupplierOutput } from '@na-regua/contracts'
import type { SupplierRepository } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/** Cadastro de fornecedor — NR-191, migration 0045. */

type Linha = {
  id: string
  name: string
  trade_name: string | null
  document: string | null
  state_registration: string | null
  email: string | null
  phone: string | null
  contact_name: string | null
  zip_code: string | null
  street: string | null
  number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  notes: string | null
  is_active: boolean
  created_at: Date
}

const paraSaida = (l: Linha): SupplierOutput => ({
  id: l.id,
  name: l.name,
  tradeName: l.trade_name,
  document: l.document,
  stateRegistration: l.state_registration,
  email: l.email,
  phone: l.phone,
  contactName: l.contact_name,
  address: {
    zipCode: l.zip_code,
    street: l.street,
    number: l.number,
    complement: l.complement,
    district: l.district,
    city: l.city,
    state: l.state,
  },
  notes: l.notes,
  isActive: l.is_active,
  createdAt: l.created_at.toISOString(),
})

/**
 * A busca do fornecedor — a mesma regra da do cliente (NR-188): sem acento,
 * palavra por palavra no nome e no fantasia, e documento/telefone pelos
 * digitos.
 */
function casaCom(tx: TransactionSql, termo: string) {
  const palavras = termo.trim().split(/\s+/).filter(Boolean).slice(0, 6)
  const digitos = termo.replace(/\D/g, '')
  const nomes = palavras.reduce(
    (acc, p) =>
      tx`${acc} AND unaccent(name || ' ' || COALESCE(trade_name, '')) ILIKE unaccent(${'%' + p + '%'})`,
    tx`TRUE`,
  )
  return tx`((${nomes})
           ${
             digitos.length >= 3
               ? tx`OR COALESCE(document, '') LIKE ${'%' + digitos + '%'}
                    OR COALESCE(phone, '') LIKE ${'%' + digitos + '%'}`
               : tx``
           })`
}

export function createSupplierRepository(sql: Sql): SupplierRepository {
  return {
    list: async (companyId, filtro) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT * FROM suppliers
           WHERE deleted_at IS NULL
           ${filtro.somenteAtivos ? tx`AND is_active` : tx``}
           ${filtro.termo === undefined ? tx`` : tx`AND ${casaCom(tx, filtro.termo)}`}
           ORDER BY lower(name), id
           LIMIT ${filtro.limite}
        `,
      )
      return linhas.map(paraSaida)
    },

    findById: async (companyId, id) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`SELECT * FROM suppliers WHERE id = ${id} AND deleted_at IS NULL`,
      )
      return l === undefined ? undefined : paraSaida(l)
    },

    findByDocument: async (companyId, document) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT * FROM suppliers WHERE document = ${document} AND deleted_at IS NULL
        `,
      )
      return l === undefined ? undefined : paraSaida(l)
    },

    insert: async (n) => {
      const [l] = await withTenant(
        sql,
        n.companyId,
        (tx) => tx<Linha[]>`
          INSERT INTO suppliers ${tx({
            company_id: n.companyId,
            name: n.name,
            trade_name: n.tradeName,
            document: n.document,
            state_registration: n.stateRegistration,
            email: n.email,
            phone: n.phone,
            contact_name: n.contactName,
            zip_code: n.address.zipCode,
            street: n.address.street,
            number: n.address.number,
            complement: n.address.complement,
            district: n.address.district,
            city: n.address.city,
            state: n.address.state,
            notes: n.notes,
            created_by: n.createdBy,
            created_at: n.createdAt,
          })}
          RETURNING *
        `,
      )
      return paraSaida(l!)
    },

    update: async (companyId, id, p) => {
      /* So as colunas que vieram: ausente nao mexe, `null` apaga. */
      const colunas: Record<string, unknown> = {}
      const poe = (coluna: string, valor: unknown) => {
        if (valor !== undefined) colunas[coluna] = valor
      }
      poe('name', p.name)
      poe('trade_name', p.tradeName)
      poe('document', p.document)
      poe('state_registration', p.stateRegistration)
      poe('email', p.email)
      poe('phone', p.phone)
      poe('contact_name', p.contactName)
      poe('notes', p.notes)
      poe('is_active', p.isActive)
      if (p.address !== undefined) {
        poe('zip_code', p.address.zipCode)
        poe('street', p.address.street)
        poe('number', p.address.number)
        poe('complement', p.address.complement)
        poe('district', p.address.district)
        poe('city', p.address.city)
        poe('state', p.address.state)
      }
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          UPDATE suppliers
             SET ${tx({ ...colunas, updated_at: new Date() })}
           WHERE id = ${id} AND deleted_at IS NULL
          RETURNING *
        `,
      )
      if (l === undefined) throw new Error(`fornecedor ${id} nao encontrado para editar`)
      return paraSaida(l)
    },

    remove: async (companyId, id, quando) => {
      await withTenant(
        sql,
        companyId,
        (tx) => tx`UPDATE suppliers SET deleted_at = ${quando} WHERE id = ${id}`,
      )
    },
  }
}
