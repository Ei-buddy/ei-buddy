import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Botao from '@/components/ui/Botao'
import { assinarTutorial, encerrarTutorial, tutorialAtivo } from '@/lib/tutorial'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

type Passo = { titulo: string; texto: string; onde?: string }

/*
 * Os mesmos assuntos do tutorial do web, na ordem dele, ditos do jeito do
 * celular: no web o passo aponta um item da barra lateral; aqui diz onde
 * ele mora (o menu das tres barras, a lupa, o sino).
 */
const PASSOS: Passo[] = [
  {
    titulo: 'Bem-vindo ao EiBuddy!',
    texto: 'Vamos conhecer o app em menos de 2 minutos. Você pode pular quando quiser.',
  },
  {
    titulo: 'O resumo do seu dia',
    texto:
      'Faturamento, ticket médio, o que falta receber e o que falta pagar — sempre atualizado.',
    onde: 'No topo da tela principal',
  },
  {
    titulo: 'Toda venda começa aqui',
    texto: 'Leitor de código de barras, carrinho e pagamento em poucos toques.',
    onde: 'Botão “Abrir o balcão”',
  },
  {
    titulo: 'Vendas, clientes e produtos',
    texto:
      'O histórico de vendas, o cadastro de clientes com pendências e o catálogo com controle de estoque.',
    onde: 'Menu ☰ › Operação e Cadastros',
  },
  {
    titulo: 'Financeiro',
    texto: 'Contas a pagar e receber, conciliação bancária, DRE e plano de contas.',
    onde: 'Menu ☰ › Financeiro',
  },
  {
    titulo: 'CRM, agenda e assistente',
    texto:
      'Pendências e contatos, compromissos por dia, e o assistente: pergunte em português — as mesmas perguntas funcionam pelo WhatsApp.',
    onde: 'Menu ☰ › Mais',
  },
  {
    titulo: 'Ache qualquer coisa',
    texto: 'Uma tela, um cliente, um produto ou uma venda — digite e toque.',
    onde: 'A lupa, no topo de cada tela',
  },
  {
    titulo: 'Avisos importantes',
    texto: 'Contas vencendo, respostas do suporte e outros avisos aparecem aqui.',
    onde: 'O sino, ao lado da lupa',
  },
  {
    titulo: 'Do seu jeito',
    texto: 'Quer desligar o som do bipe e da venda fechada? É por aqui.',
    onde: 'Menu ☰ › Som, no fim do menu',
  },
  {
    titulo: 'Pronto!',
    texto: 'Você já sabe o essencial. Pode rever este tutorial quando quiser.',
    onde: 'Menu ☰ › Mais › Rever o tutorial',
  },
]

/** O tutorial em cartoes, por cima de qualquer tela — NR-166. */
export default function Tutorial() {
  const [aberto, setAberto] = useState(tutorialAtivo())
  const [passo, setPasso] = useState(0)

  useEffect(
    () =>
      assinarTutorial((ativo) => {
        setAberto(ativo)
        if (ativo) setPasso(0)
      }),
    [],
  )

  const atual = PASSOS[passo]!
  const ultimo = passo === PASSOS.length - 1

  return (
    <Modal visible={aberto} transparent animationType="fade" onRequestClose={encerrarTutorial}>
      <View style={estilos.fundo}>
        <View style={estilos.cartao} accessibilityLiveRegion="polite">
          <Text style={estilos.contador}>
            {passo + 1} de {PASSOS.length}
          </Text>
          <Text style={estilos.titulo}>{atual.titulo}</Text>
          <Text style={estilos.texto}>{atual.texto}</Text>
          {atual.onde ? (
            <View style={estilos.onde}>
              <Text style={estilos.ondeTexto}>{atual.onde}</Text>
            </View>
          ) : null}

          <View style={estilos.pontos}>
            {PASSOS.map((_, i) => (
              <View key={i} style={[estilos.ponto, i === passo && estilos.pontoAtual]} />
            ))}
          </View>

          <View style={estilos.acoes}>
            {ultimo ? null : (
              <Pressable onPress={encerrarTutorial} accessibilityRole="button" hitSlop={10}>
                <Text style={estilos.pular}>Pular</Text>
              </Pressable>
            )}
            <View style={estilos.flex} />
            {passo > 0 ? (
              <Botao variante="secundario" onPress={() => setPasso((p) => p - 1)}>
                Voltar
              </Botao>
            ) : null}
            <Botao onPress={() => (ultimo ? encerrarTutorial() : setPasso((p) => p + 1))}>
              {ultimo ? 'Concluir' : 'Próximo'}
            </Botao>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fundo: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: espaco.lg,
    paddingBottom: espaco.xxl,
    backgroundColor: 'rgba(4, 6, 20, 0.6)',
  },
  cartao: { ...vidro.painel, borderRadius: raio.lg, padding: espaco.xl, gap: espaco.md },
  contador: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.acento },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  texto: { fontSize: fonte.corpo, lineHeight: 22, color: cores.textoFraco },
  onde: {
    ...vidro.campo,
    alignSelf: 'flex-start',
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
  },
  ondeTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  pontos: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: cores.borda },
  pontoAtual: { width: 18, backgroundColor: cores.ativo },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  flex: { flex: 1 },
  pular: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.textoFraco },
})
