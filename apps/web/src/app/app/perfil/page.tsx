import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import MeuPerfil from '@/components/perfil/MeuPerfil'
import CelularDoCanal from '@/components/empresa/CelularDoCanal'

export const metadata: Metadata = {
  title: `Meu perfil — ${BRAND}`,
  description: 'Seu nome, e-mail, celular e senha.',
}

export default function PerfilPage() {
  return (
    <>
      <MeuPerfil />
      {/* O mesmo cartao de Empresa: e o celular da PESSOA (RF-132), e quem
          procura "meus dados" pode procurar aqui ou la. */}
      <CelularDoCanal />
    </>
  )
}
