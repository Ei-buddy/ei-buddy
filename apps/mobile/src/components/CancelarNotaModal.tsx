import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { cancelarNota, JUSTIFICATIVA_MINIMA } from '@/lib/vendas-api'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Cancelar a NFC-e pelo celular — RF-050.
 *
 * E o que libera estorno e devolucao de uma venda com nota. A justificativa
 * vai para a SEFAZ, que exige ao menos 15 caracteres.
 */
export default function CancelarNotaModal({
  venda,
  onCancelada,
  onFechar,
}: {
  venda: { id: string; numero: string; notaNumero: string }
  onCancelada: () => void
  onFechar: () => void
}) {
  const [justificativa, setJustificativa] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const curta = justificativa.trim().length < JUSTIFICATIVA_MINIMA

  async function confirmar() {
    setProcessando(true)
    setErro(null)
    const r = await cancelarNota(venda.id, justificativa)
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }
    onCancelada()
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable
          style={estilos.foraDaFolha}
          onPress={() => !processando && onFechar()}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />

        <View style={estilos.folha}>
          <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
            <Text style={estilos.titulo}>Cancelar NFC-e {venda.notaNumero}</Text>
            <Text style={estilos.apoio}>
              Venda #{venda.numero}. A SEFAZ aceita o cancelamento até 30 minutos depois da
              autorização. A venda continua registrada — cancelada a nota, ela pode ser estornada ou
              devolvida.
            </Text>

            <Campo
              rotulo="Justificativa"
              valor={justificativa}
              onChange={setJustificativa}
              placeholder="Ex.: valor digitado errado na venda"
              dica={`Mínimo de ${JUSTIFICATIVA_MINIMA} caracteres.`}
              editavel={!processando}
            />

            {erro !== null ? (
              <Text style={estilos.erro} accessibilityRole="alert">
                {erro}
              </Text>
            ) : null}

            <View style={estilos.acoes}>
              <Botao variante="secundario" onPress={onFechar} desabilitado={processando} largura>
                Voltar
              </Botao>
              <Botao
                variante="perigo"
                onPress={() => void confirmar()}
                carregando={processando}
                desabilitado={curta}
                largura
              >
                {processando ? 'Cancelando...' : 'Cancelar nota'}
              </Botao>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  foraDaFolha: { flex: 1 },
  folha: {
    maxHeight: '88%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
    backgroundColor: cores.fundo,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  acoes: { flexDirection: 'row', gap: espaco.md },
})
