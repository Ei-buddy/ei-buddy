export type RotulosDoOperador = {
  readonly userName?: string
  readonly companyName?: string
}

type Users = {
  findById(id: string): Promise<{ readonly name: string } | undefined>
}

type Companies = {
  findById(id: string): Promise<{ readonly tradeName: string } | undefined>
}

/** Rótulos para o prompt. Falha ou ausência some do objeto — não vai ao system. */
export async function buscarRotulosDoOperador(
  users: Users,
  companies: Companies,
  ids: { readonly userId: string; readonly companyId: string },
): Promise<RotulosDoOperador> {
  try {
    const [usuario, empresa] = await Promise.all([
      users.findById(ids.userId),
      companies.findById(ids.companyId),
    ])
    const userName = usuario?.name.trim()
    const companyName = empresa?.tradeName.trim()
    return {
      ...(userName === undefined || userName === '' ? {} : { userName }),
      ...(companyName === undefined || companyName === '' ? {} : { companyName }),
    }
  } catch {
    return {}
  }
}
