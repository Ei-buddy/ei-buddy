import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import EmpresaForm from '@/components/empresa/EmpresaForm'
import CelularDoCanal from '@/components/empresa/CelularDoCanal'
import MeusDados from '@/components/empresa/MeusDados'

export const metadata: Metadata = {
  title: `Empresa — ${BRAND}`,
  description: 'Dados cadastrais, endereço, certificado digital e exportação completa.',
}

export default function EmpresaPage() {
  return (
    <>
      <EmpresaForm />
      {/* Fora do formulario da empresa: e o celular da PESSOA, com senha e
          gravacao proprias (RF-132). */}
      <CelularDoCanal />
      {/* A exportacao mora aqui, e nao numa tela propria: quem procura "meus
          dados" procura em Empresa. Uma pagina separada no menu seria mais
          visivel e menos encontravel. */}
      <MeusDados />
    </>
  )
}
