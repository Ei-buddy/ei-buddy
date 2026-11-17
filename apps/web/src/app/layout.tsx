import type { Metadata } from 'next'
import { Poppins, Inter } from 'next/font/google'
import AvisoDeCookies from '@/components/AvisoDeCookies'
import ScrollRestoration from '@/components/ScrollRestoration'
import { NOME_NA_ABA } from '@/content/site'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema-painel'
import './globals.css'

/* Fonte de marca/destaque: geometrica e arredondada, no espirito da
   tipografia do rebranding (a original nao tem licenca aberta). */
const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

/* Fonte de apoio: neutra e legivel para texto corrido, UI e painel. */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  /*
   * A aba do navegador mostra "<tela> — Ei Buddy". Cada pagina declara so o
   * proprio nome; o modelo poe o nome do produto (`NOME_NA_ABA`). A pagina
   * inicial, sem titulo proprio, fica com o `default`.
   */
  title: {
    default: `${NOME_NA_ABA} — Gestão modular para o seu comércio`,
    template: `%s — ${NOME_NA_ABA}`,
  },
  description:
    'Modulos integrados de vendas, financeiro, estoque e fiscal, com um assistente que responde em linguagem natural.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="pt-BR"
      className={`${poppins.variable} ${inter.variable}`}
      /*
       * O script logo abaixo escreve `data-theme` neste elemento ANTES da
       * hidratacao — de proposito, e o unico jeito de escolher o tema sem
       * um flash escuro no primeiro paint (ver `SCRIPT_TEMA_INICIAL`). O
       * servidor nunca sabe o valor (nao ha `localStorage` la), entao o HTML
       * que ele renderiza sempre difere do DOM depois do script rodar.
       *
       * Sem isto, o React compara os dois, ve a diferenca e avisa
       * "hydration mismatch" — um alarme falso: NADA quebrou, o atributo e
       * exatamente o que devia ser. `suppressHydrationWarning` e a forma que
       * o proprio React documenta para este caso exato, e o React so aplica
       * a supressao aos ATRIBUTOS deste elemento — o conteudo dele continua
       * conferido normalmente.
       */
      suppressHydrationWarning
    >
      <head>
        {/*
          Aplica o tema do painel ANTES da hidratacao — NR-099.

          So tem efeito visivel dentro de `.appTheme` (o painel logado); o
          site institucional e a autenticacao nao leem este atributo, entao
          rodar em toda pagina nao muda nada nelas. Sem isto, quem ja
          escolheu claro numa visita anterior veria um flash escuro no
          primeiro paint do painel, toda vez.

          Script inline e nao um modulo importado: precisa rodar SINCRONO,
          antes do primeiro paint, e um `<script src>` externo perderia a
          corrida por causa da ida a rede.
        */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body>
        <ScrollRestoration />
        {children}
        {/* No layout RAIZ, e nao so na landing: o aviso precisa alcancar quem
            entra direto no painel por um link salvo, que e quem mais usa o
            sistema e menos passa pela pagina inicial. */}
        <AvisoDeCookies />
      </body>
    </html>
  )
}
