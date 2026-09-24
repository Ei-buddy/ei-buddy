import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { estornarVenda } from '@/lib/vendas-api'
import { formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/** O motivo e obrigatorio no servidor, e o minimo la sao 3 caracteres. */
const MOTIVO_MINIMO = 3

/**
 * Estornar (cancelar) uma venda pelo celular — RF-043.
 *
 * Folha com o motivo, e nao um "tem certeza?": o servidor exige o motivo, e ele
 * fica na trilha. O `Alert.prompt` resolveria so no iPhone.
 */
export default function CancelarVendaModal({
  venda,
  onCancelada,
  onFechar,
}: {
  venda: { id: string; numero: string; total: number; clienteNome: string }
  /** A tela recarrega a lista: quem decide o status e o servidor. */
  onCancelada: () => void
  onFechar: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const podeConfirmar = motivo.trim().length >= MOTIVO_MINIMO && !processando

  async function confirmar() {
    setProcessando(true)
    setErro(null)
    const r = await estornarVenda(venda.id, motivo)
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
            <Text style={estilos.titulo}>Estornar venda #{venda.numero}</Text>
            <Text style={estilos.apoio}>
              {venda.clienteNome} · {formatMoney(venda.total)}
            </Text>
            <Text style={estilos.apoio}>
              Os itens voltam para o estoque e os valores a receber desta venda são cancelados.
            </Text>

            <Campo
              rotulo="Motivo do estorno"
              valor={motivo}
              onChange={setMotivo}
              placeholder="Ex.: cliente desistiu, item com defeito"
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
                desabilitado={!podeConfirmar}
                largura
              >
                {processando ? 'Estornando...' : 'Estornar'}
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
