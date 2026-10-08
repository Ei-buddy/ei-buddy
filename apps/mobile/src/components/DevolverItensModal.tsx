import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { devolverItens, type ResultadoDaDevolucao, type VendaHistorico } from '@/lib/vendas-api'
import { formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

const MOTIVO_MINIMO = 3

/**
 * Devolucao parcial pelo celular — RF-044.
 *
 * A pessoa diz quantas unidades de cada item voltam; o valor quem calcula e o
 * servidor, proporcional ao que foi cobrado. Item avulso (sem produto) nao
 * aparece: nao tem estoque para onde voltar.
 */
export default function DevolverItensModal({
  venda,
  onDevolvido,
  onFechar,
}: {
  venda: VendaHistorico
  onDevolvido: (resultado: ResultadoDaDevolucao) => void
  onFechar: () => void
}) {
  const devolviveis = venda.itens
    .map((i, idx) => ({ ...i, idx, resta: i.quantidade - i.devolvido }))
    .filter((i): i is typeof i & { produtoId: string } => i.produtoId !== null && i.resta > 0)

  const [quantidades, setQuantidades] = useState<Record<number, number>>({})
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const escolhidos = devolviveis
    .filter((i) => (quantidades[i.idx] ?? 0) > 0)
    .map((i) => ({ produtoId: i.produtoId, quantidade: quantidades[i.idx] ?? 0 }))

  const pode = escolhidos.length > 0 && motivo.trim().length >= MOTIVO_MINIMO && !processando

  function mudar(idx: number, resta: number, delta: number) {
    setQuantidades((q) => ({ ...q, [idx]: Math.min(resta, Math.max(0, (q[idx] ?? 0) + delta)) }))
  }

  async function confirmar() {
    setProcessando(true)
    setErro(null)
    const r = await devolverItens(venda.id, motivo, escolhidos)
    setProcessando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }
    onDevolvido(r.dados)
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
            <Text style={estilos.titulo}>Devolver itens da venda #{venda.numero}</Text>
            <Text style={estilos.apoio}>
              Os itens voltam ao estoque. O valor é calculado pelo que foi cobrado em cada item.
            </Text>

            {devolviveis.map((i) => (
              <View key={i.idx} style={estilos.linha}>
                <View style={estilos.linhaInfo}>
                  <Text style={estilos.linhaNome} numberOfLines={2}>
                    {i.descricao}
                  </Text>
                  <Text style={estilos.apoio}>
                    {i.resta} de {i.quantidade} · {formatMoney(i.precoUnitario)} un
                  </Text>
                </View>
                <Pressable
                  onPress={() => mudar(i.idx, i.resta, -1)}
                  style={estilos.contador}
                  accessibilityLabel={`Devolver menos ${i.descricao}`}
                >
                  <Text style={estilos.sinal}>−</Text>
                </Pressable>
                <Text style={estilos.quantidade}>{quantidades[i.idx] ?? 0}</Text>
                <Pressable
                  onPress={() => mudar(i.idx, i.resta, 1)}
                  style={estilos.contador}
                  accessibilityLabel={`Devolver mais ${i.descricao}`}
                >
                  <Text style={estilos.sinal}>+</Text>
                </Pressable>
              </View>
            ))}

            <Campo
              rotulo="Motivo da devolução"
              valor={motivo}
              onChange={setMotivo}
              placeholder="Ex.: produto com defeito"
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
                onPress={() => void confirmar()}
                carregando={processando}
                desabilitado={!pode}
                largura
              >
                {processando ? 'Devolvendo...' : 'Devolver'}
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
    ...vidro.painel,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    maxHeight: '88%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  linhaInfo: { flex: 1, gap: 2 },
  linhaNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  contador: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  sinal: { fontSize: 20, color: cores.texto },
  quantidade: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  acoes: { flexDirection: 'row', gap: espaco.md },
})
