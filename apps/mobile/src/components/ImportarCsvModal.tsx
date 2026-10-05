import { getDocumentAsync } from 'expo-document-picker'
import { File } from 'expo-file-system'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { lerCsv, type PlanilhaLida } from '@/lib/planilha'
import Botao from '@/components/ui/Botao'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

export type CampoDaImportacao = {
  key: string
  label: string
  obrigatorio: boolean
  /** Reconhece a coluna pelo nome, ja em minusculas. */
  reconhece: (coluna: string) => boolean
}

type Resultado = {
  importados: number
  recusadas: { index: number; description: string; reason: string }[]
}

/**
 * Importar por planilha CSV — o mesmo fluxo do web, em tres passos: escolher
 * o arquivo, conferir a coluna de cada campo (ja adivinhada pelo nome) e
 * importar, com o relatorio do que entrou e do que foi recusado e por que.
 */
export default function ImportarCsvModal({
  titulo,
  campos,
  validar,
  onConfirmar,
  onFechar,
}: {
  titulo: string
  campos: CampoDaImportacao[]
  validar: (valores: Record<string, string>) => string | null
  onConfirmar: (registros: Record<string, string>[]) => Promise<Resultado>
  onFechar: () => void
}) {
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null)
  const [mapa, setMapa] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function escolher() {
    setErro(null)
    const r = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
    if (r.canceled) return
    const a = r.assets[0]
    if (!a) return
    if (!a.name.toLowerCase().endsWith('.csv')) {
      setErro('Envie um arquivo .csv. No Excel ou Google Planilhas: Salvar como → CSV.')
      return
    }
    let lida: PlanilhaLida
    try {
      lida = lerCsv(await new File(a.uri).text())
    } catch {
      setErro('Não foi possível ler o arquivo.')
      return
    }
    if (lida.colunas.length === 0 || lida.linhas.length === 0) {
      setErro('A planilha parece vazia. Confira se há cabeçalho e ao menos uma linha.')
      return
    }
    const automatico: Record<string, string> = {}
    for (const c of campos) {
      const achou = lida.colunas.find((col) => c.reconhece(col.toLowerCase()))
      if (achou) automatico[c.key] = achou
    }
    setPlanilha(lida)
    setMapa(automatico)
  }

  function valoresDa(linha: string[]): Record<string, string> {
    const valores: Record<string, string> = {}
    for (const c of campos) {
      const i = planilha && mapa[c.key] ? planilha.colunas.indexOf(mapa[c.key]!) : -1
      valores[c.key] = i >= 0 ? (linha[i] ?? '') : ''
    }
    return valores
  }

  const obrigatoriosOk = campos.filter((c) => c.obrigatorio).every((c) => mapa[c.key])

  async function importar() {
    if (planilha === null) return
    const validos: Record<string, string>[] = []
    const origem: number[] = []
    const recusadasLocais: Resultado['recusadas'] = []
    planilha.linhas.forEach((linha, i) => {
      const v = valoresDa(linha)
      const motivo = validar(v)
      if (motivo !== null) {
        recusadasLocais.push({ index: i, description: v[campos[0]!.key] ?? '', reason: motivo })
        return
      }
      validos.push(v)
      origem.push(i)
    })
    setEnviando(true)
    const r = validos.length === 0 ? { importados: 0, recusadas: [] } : await onConfirmar(validos)
    setEnviando(false)
    setResultado({
      importados: r.importados,
      recusadas: [
        ...recusadasLocais,
        ...r.recusadas.map((x) => ({ ...x, index: origem[x.index] ?? x.index })),
      ].sort((a, b) => a.index - b.index),
    })
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable style={estilos.fora} onPress={onFechar} accessibilityLabel="Fechar" />
        <View style={estilos.folha}>
          <ScrollView contentContainerStyle={estilos.conteudo}>
            <Text style={estilos.titulo}>{titulo}</Text>

            {resultado !== null ? (
              <>
                <Text style={estilos.ok}>{resultado.importados} importado(s).</Text>
                {resultado.recusadas.length > 0 ? (
                  <>
                    <Text style={estilos.apoio}>
                      {resultado.recusadas.length} linha(s) recusada(s):
                    </Text>
                    {resultado.recusadas.slice(0, 50).map((r) => (
                      <Text key={`${r.index}-${r.reason}`} style={estilos.recusada}>
                        Linha {r.index + 2}
                        {r.description ? ` (${r.description})` : ''}: {r.reason}
                      </Text>
                    ))}
                  </>
                ) : null}
                <Botao onPress={onFechar} largura>
                  Concluir
                </Botao>
              </>
            ) : planilha === null ? (
              <>
                <Text style={estilos.apoio}>
                  Envie um arquivo .csv com uma linha de cabeçalho. No Excel ou no Google Planilhas:
                  Salvar como → CSV.
                </Text>
                <Botao onPress={() => void escolher()} largura>
                  Escolher arquivo
                </Botao>
              </>
            ) : (
              <>
                <Text style={estilos.apoio}>
                  {planilha.linhas.length} linha(s). Confira de qual coluna sai cada campo.
                </Text>
                {campos.map((c) => (
                  <View key={c.key} style={estilos.campo}>
                    <Text style={estilos.campoNome}>
                      {c.label}
                      {c.obrigatorio ? ' *' : ''}
                    </Text>
                    <View style={estilos.chips}>
                      {['', ...planilha.colunas].map((col) => (
                        <Pressable
                          key={col || 'nenhuma'}
                          onPress={() => setMapa((m) => ({ ...m, [c.key]: col }))}
                          style={[estilos.chip, (mapa[c.key] ?? '') === col && estilos.chipAtivo]}
                        >
                          <Text
                            style={[
                              estilos.chipTexto,
                              (mapa[c.key] ?? '') === col && estilos.chipTextoAtivo,
                            ]}
                          >
                            {col || 'Não importar'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
                <Botao
                  onPress={() => void importar()}
                  carregando={enviando}
                  desabilitado={!obrigatoriosOk}
                  largura
                >
                  Importar
                </Botao>
              </>
            )}

            {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  fora: { flex: 1 },
  folha: {
    maxHeight: '92%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
    backgroundColor: cores.fundo,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  ok: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.sucesso },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  recusada: { fontSize: fonte.micro, color: cores.atencao },
  campo: { gap: espaco.xs },
  campoNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.xs },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.xs,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  chipTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  chipTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
})
