import Benefits from '@/components/Benefits'
import CtaBuddy from '@/components/CtaBuddy'
import DashboardPreview from '@/components/DashboardPreview'
import FAQ from '@/components/FAQ'
import FeatureSection from '@/components/FeatureSection'
import { AssistantVisual, CrmVisual, FinanceVisual, SalesVisual } from '@/components/FeatureVisuals'
import Footer from '@/components/Footer'
import GridPulseBackground from '@/components/fundos/GridPulseBackground'
import Header from '@/components/Header'
import Hero from '@/components/Hero'
import Modules from '@/components/Modules'
import PreLancamentoBanner from '@/components/PreLancamentoBanner'
import Pricing from '@/components/Pricing'
import { PRE_LANCAMENTO } from '@/content/site'

export default function Home() {
  return (
    <>
      <Header />

      <main>
        {PRE_LANCAMENTO ? <PreLancamentoBanner /> : null}
        <Hero />
        <Modules />

        {/*
          O assistente vem primeiro entre os blocos detalhados: e o que
          diferencia o produto de qualquer outro ERP de balcao. Os exemplos de
          comando sao os mesmos que a tela do assistente sugere hoje.
        */}
        <FeatureSection
          id="como-funciona"
          eyebrow="Assistente de IA"
          title={
            <>
              Pergunte pelo <span className="gradientText">WhatsApp</span>
            </>
          }
          text="Em vez de abrir o painel, montar filtro e exportar planilha, mande uma mensagem. O assistente consulta os mesmos dados do sistema e devolve o número pronto — e pede confirmação antes de qualquer ação que altere dado."
          bullets={[
            '"Qual foi o faturamento mês a mês dos últimos meses"',
            '"Quais produtos precisam de reposição de estoque"',
            '"O que há para pagar até sexta"',
            '"Cadastra um cliente para mim"',
          ]}
          visual={<AssistantVisual />}
        />

        <FeatureSection
          eyebrow="Vendas"
          title={
            <>
              A nota sai junto com a <span className="gradientText">venda</span>
            </>
          }
          text="Monte o carrinho pelo leitor de código de barras ou pela busca, aplique desconto por item e receba em Pix, cartão, dinheiro ou carteira. A NFC-e ou NFS-e é emitida no fechamento."
          bullets={[
            'Leitor de código de barras direto no catálogo',
            'Desconto por item ou no total da venda',
            'Custo, imposto e taxa de cartão calculados na hora',
            'Valor líquido lançado sozinho em contas a receber',
          ]}
          visual={<SalesVisual />}
          reverse
          muted
          fundo={<GridPulseBackground tema="claro" opacidadeGrade={0.05} opacidadeTrilha={0.4} />}
        />

        <FeatureSection
          eyebrow="Financeiro"
          title={
            <>
              Contas a pagar e a <span className="gradientText">receber</span>
            </>
          }
          text="Plano de contas próprio, com títulos organizados por vencimento. Baixa total ou parcial, estorno de lançamento e a previsão de caixa sempre um passo a frente."
          bullets={[
            'Plano de contas para classificar cada lançamento',
            'Baixa total, parcial ou estorno',
            'Títulos vencidos separados dos a vencer',
            'DRE do mês pelo painel ou pelo assistente',
          ]}
          visual={<FinanceVisual />}
        />

        <FeatureSection
          eyebrow="Clientes e CRM"
          title={
            <>
              O histórico do cliente na <span className="gradientText">mão</span>
            </>
          }
          text="Cada cliente com suas compras, pendências e contatos no mesmo lugar. As pendências viram cartões num quadro, e os compromissos aparecem na agenda."
          bullets={[
            'Busca por CPF ou CNPJ e importação por planilha',
            'Histórico de compras e o que está em aberto',
            'Pendências e contatos em quadro estilo Kanban',
            'Agenda de compromissos com lembrete antes da hora',
          ]}
          visual={<CrmVisual />}
          reverse
          muted
        />

        <DashboardPreview />
        <Benefits />
        {PRE_LANCAMENTO ? null : <Pricing />}
        <FAQ />
        <CtaBuddy />
      </main>

      <Footer />
    </>
  )
}
