import { View } from 'react-native'
import { cores } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Icones desenhados com View.
 *
 * Sem biblioteca de propósito: a arvore de dependencias do projeto tem um
 * conflito de peer (react-native-worklets, vindo do expo-router) e
 * acrescentar pacote agora so aumentaria o risco. Sao formas simples,
 * suficientes para a barra de abas — quando o conflito for resolvido,
 * vale trocar por @expo/vector-icons.
 */

export type NomeIcone = 'catalogo' | 'pdv' | 'clientes' | 'agenda'

export default function Icone({
  nome,
  ativo = false,
  tamanho = 22,
}: {
  nome: NomeIcone
  ativo?: boolean
  tamanho?: number
}) {
  const cor = ativo ? cores.acento : cores.textoFraco
  const base = { width: tamanho, height: tamanho }

  if (nome === 'catalogo') {
    /* Grade 2x2 — representa o grid de produtos. */
    return (
      <View style={[base, estilos.grade]}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              estilos.gradeItem,
              { borderColor: cor, width: tamanho / 2 - 3, height: tamanho / 2 - 3 },
            ]}
          />
        ))}
      </View>
    )
  }

  if (nome === 'pdv') {
    /* Sacola de compras. */
    return (
      <View style={[base, estilos.centro]}>
        <View
          style={[
            estilos.alca,
            { borderColor: cor, width: tamanho * 0.42, height: tamanho * 0.28 },
          ]}
        />
        <View
          style={[
            estilos.sacola,
            { borderColor: cor, width: tamanho * 0.8, height: tamanho * 0.58 },
          ]}
        />
      </View>
    )
  }

  if (nome === 'clientes') {
    /* Cabeca e ombros. */
    return (
      <View style={[base, estilos.centro]}>
        <View
          style={[
            estilos.cabeca,
            { borderColor: cor, width: tamanho * 0.4, height: tamanho * 0.4 },
          ]}
        />
        <View
          style={[
            estilos.ombros,
            { borderColor: cor, width: tamanho * 0.78, height: tamanho * 0.34 },
          ]}
        />
      </View>
    )
  }

  /* agenda — folha de calendario com argolas */
  return (
    <View style={[base, estilos.centro]}>
      <View style={[estilos.argolas, { width: tamanho * 0.5 }]}>
        <View style={[estilos.argola, { backgroundColor: cor }]} />
        <View style={[estilos.argola, { backgroundColor: cor }]} />
      </View>
      <View
        style={[
          estilos.calendario,
          { borderColor: cor, width: tamanho * 0.82, height: tamanho * 0.68 },
        ]}
      >
        <View style={[estilos.calendarioLinha, { backgroundColor: cor }]} />
      </View>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  centro: { alignItems: 'center', justifyContent: 'flex-end' },

  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  gradeItem: { borderWidth: 1.8, borderRadius: 2.5 },

  alca: {
    borderWidth: 1.8,
    borderBottomWidth: 0,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    marginBottom: -2,
  },
  sacola: { borderWidth: 1.8, borderRadius: 3 },

  cabeca: { borderWidth: 1.8, borderRadius: 999, marginBottom: 1 },
  ombros: {
    borderWidth: 1.8,
    borderBottomWidth: 0,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },

  argolas: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: -1,
  },
  argola: { width: 1.8, height: 4, borderRadius: 1 },
  calendario: { borderWidth: 1.8, borderRadius: 3, justifyContent: 'flex-start' },
  calendarioLinha: { height: 1.8, marginTop: 4 },
}))
