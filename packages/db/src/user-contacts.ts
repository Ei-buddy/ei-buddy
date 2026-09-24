import type { UserContacts } from '@na-regua/core'
import type { Sql } from 'postgres'

/**
 * O contato da propria pessoa logada — RF-132, migration 0035.
 *
 * Pelas funcoes `auth_user_*`, sem `withTenant`: o celular e da PESSOA, que
 * pode ser dona de mais de uma loja, e `users` tem RLS por empresa.
 */
export function createUserContacts(sql: Sql): UserContacts {
  return {
    contactOf: async (userId) => {
      const [l] = await sql<
        { email: string | null; phone: string | null; auth_subject: string | null }[]
      >`
        SELECT * FROM auth_user_contact(${userId})
      `
      return l === undefined
        ? undefined
        : { email: l.email, phone: l.phone, subject: l.auth_subject }
    },

    changePhone: async (userId, phone) => {
      await sql`SELECT auth_user_change_phone(${userId}, ${phone})`
    },
  }
}
