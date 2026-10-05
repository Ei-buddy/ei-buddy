import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import { Vazio } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * O plano — o MESMO do site (`apps/web/src/content/site.ts`). Repetido aqui
 * porque o app nao importa o conteudo do site; se o preco mudar la, muda aqui.
 */
const PLANO = {
  nome: 'Plano único',
  preco: 'R$ 59,90',
  periodo: '/mês por empresa',
  inclui: [
    'Empresa, clientes, produtos e estoque',
    'Vendas com emissão de NFC-e',
    'Financeiro: plano de contas, contas a pagar e a receber',
    'CRM em quadro Kanban e agenda com lembrete de compromisso',
    'Assistente de IA pelo WhatsApp',
    'Importação de clientes e produtos por planilha',
    'Usuários ilimitados por empresa',
  ],
}

/**
 * Assinatura.
 *
 * Mostrava quatro faturas de exemplo, uma "em aberto", e um preco que nao era
 * o do site. A cobranca da mensalidade ainda nao existe (QST-002): ate la a
 * tela diz o plano e que nao ha fatura — e nao inventa uma.
 *
 * O pagamento fica no site: cobrar assinatura dentro do app na App Store exige
 * o sistema de pagamento da Apple, decisao de produto ainda nao tomada.
 */
export default function Assinatura() {
  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Assinatura" subtitulo={`${PLANO.nome} · ${PLANO.preco}${PLANO.periodo}`} />

      <ScrollView contentContainerStyle={estilos.conteudo}>
        <View style={estilos.situacao}>
          <Text style={estilos.situacaoRotulo}>Plano atual</Text>
          <Text style={estilos.situacaoValor}>{PLANO.preco}</Text>
          <Text style={estilos.situacaoApoio}>
            {PLANO.nome}
            {PLANO.periodo}
          </Text>
        </View>

        <View style={estilos.aviso}>
          <Text style={estilos.avisoTitulo}>Pagamento pelo site</Text>
          <Text style={estilos.avisoTexto}>
            O pagamento da mensalidade é feito no site. Cobrar assinatura dentro do app na App Store
            exige o sistema de pagamento da Apple — é uma decisão de produto que ainda não foi
            tomada.
          </Text>
        </View>

        <Vazio
          titulo="Nenhuma fatura ainda"
          descricao="As faturas da mensalidade aparecem aqui quando a cobrança começar."
        />

        <Sanfona titulo="O que o plano inclui" resumo="todos os módulos">
          {PLANO.inclui.map((item) => (
            <View key={item} style={estilos.beneficio}>
              <Text style={estilos.beneficioMarca}>✓</Text>
              <Text style={estilos.beneficioTexto}>{item}</Text>
            </View>
          ))}
        </Sanfona>
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  situacao: {
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
    gap: espaco.xs,
  },
  situacaoRotulo: { fontSize: fonte.micro, color: cores.textoFraco },
  situacaoValor: { fontSize: 30, fontWeight: peso.pesado, color: cores.texto },
  situacaoApoio: { fontSize: fonte.micro, color: cores.textoFraco },

  aviso: {
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.atencao,
    borderRadius: raio.md,
    backgroundColor: cores.atencaoFundo,
    gap: espaco.xs,
  },
  avisoTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.atencao },
  avisoTexto: { fontSize: fonte.micro, lineHeight: 19, color: cores.textoFraco },

  beneficio: { flexDirection: 'row', gap: espaco.sm, alignItems: 'flex-start' },
  beneficioMarca: { fontSize: fonte.pequeno, color: cores.acento, fontWeight: peso.pesado },
  beneficioTexto: { flex: 1, fontSize: fonte.micro, lineHeight: 19, color: cores.texto },
})
