import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { exportarLista, type ListaExportavel } from '@/lib/exportar-api'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * CSV e PDF de uma lista — NR-155. Os mesmos dois botoes de contas a pagar e a
 * receber; o arquivo leva os filtros que a tela tem aplicados.
 */
export default function BotoesExportar({
  lista,
  filtros = {},
}: {
  lista: ListaExportavel
  filtros?: Record<string, string | undefined>
}) {
  const [exportando, setExportando] = useState(false)

  async function exportar(formato: 'csv' | 'pdf') {
    setExportando(true)
    const r = await exportarLista(lista, formato, filtros)
    setExportando(false)
    if (!r.ok) Alert.alert('Não deu para exportar', r.erro)
  }

  return (
    <View style={estilos.linha}>
      {(['csv', 'pdf'] as const).map((f) => (
        <Pressable
          key={f}
          style={estilos.botao}
          onPress={() => void exportar(f)}
          disabled={exportando}
          accessibilityRole="button"
          accessibilityLabel={`Exportar ${f.toUpperCase()}`}
        >
          <Text style={estilos.texto}>{f.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', gap: espaco.sm },
  botao: {
    minHeight: 40,
    paddingHorizontal: espaco.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  texto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
})
