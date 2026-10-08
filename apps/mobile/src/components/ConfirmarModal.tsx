import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Botao from '@/components/ui/Botao'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Confirmacao do proprio app, no lugar do `Alert.alert` com botoes.
 *
 * O alerta nativo nao existe no app aberto pelo navegador (react-native-web o
 * ignora), e ali "Fechar venda" simplesmente nao fazia nada. Esta janela se
 * comporta igual no celular e no navegador.
 */
export default function ConfirmarModal({
  titulo,
  mensagem,
  rotuloConfirmar,
  perigo = false,
  processando = false,
  onConfirmar,
  onFechar,
}: {
  titulo: string
  mensagem: string
  rotuloConfirmar: string
  perigo?: boolean
  processando?: boolean
  onConfirmar: () => void
  onFechar: () => void
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => !processando && onFechar()}
          accessibilityLabel="Fechar"
        />
        <View style={estilos.caixa} accessibilityRole="alert">
          <Text style={estilos.titulo}>{titulo}</Text>
          <Text style={estilos.mensagem}>{mensagem}</Text>
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={onFechar} desabilitado={processando} largura>
                Voltar
              </Botao>
            </View>
            <View style={estilos.flex}>
              <Botao
                variante={perigo ? 'perigo' : 'primario'}
                onPress={onConfirmar}
                carregando={processando}
                largura
              >
                {rotuloConfirmar}
              </Botao>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  fundo: {
    flex: 1,
    justifyContent: 'center',
    padding: espaco.xl,
    backgroundColor: cores.veu,
  },
  caixa: {
    ...vidro.painel,
    gap: espaco.md,
    padding: espaco.xl,
    borderRadius: raio.lg,
  },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  mensagem: { fontSize: fonte.corpo, lineHeight: 22, color: cores.textoFraco },
  acoes: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm },
  flex: { flex: 1 },
}))
