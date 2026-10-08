import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  cancelarTitulo,
  corrigirTitulo,
  type CorrecaoDeTitulo,
  type TipoDeTitulo,
  type Titulo,
} from '@/lib/financeiro-api'
import { dataDoTexto, formatDate, mascaraData } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/** O minimo do servidor para o motivo do cancelamento. */
const MOTIVO_MINIMO = 3

const paraTexto = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/**
 * Corrigir ou cancelar um titulo lancado errado — NR-150. Par do
 * `CorrecaoTitulo` do web, com as mesmas regras.
 *
 * So aparece para titulo SEM baixa (e, no a receber, so o avulso): com
 * dinheiro registrado, o caminho e estornar antes. O servidor confere de novo.
 * Manda so o que MUDOU, para a trilha mostrar exatamente o que foi alterado.
 */
export default function CorrecaoTituloModal({
  tipo,
  modo,
  titulo,
  onFeito,
  onFechar,
}: {
  tipo: TipoDeTitulo
  modo: 'corrigir' | 'cancelar'
  titulo: Titulo
  onFeito: (mensagem: string) => void
  onFechar: () => void
}) {
  const pagar = tipo === 'pagar'
  const cancelar = modo === 'cancelar'

  const [fornecedor, setFornecedor] = useState(titulo.contraparte)
  const [descricao, setDescricao] = useState(titulo.descricao)
  const [valor, setValor] = useState(paraTexto(titulo.valorCents))
  const [vencimento, setVencimento] = useState(formatDate(titulo.vencimento))
  const [motivo, setMotivo] = useState('')

  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function confirmar() {
    setErro(null)

    if (cancelar) {
      if (motivo.trim().length < MOTIVO_MINIMO) {
        setErro('Diga por que está cancelando.')
        return
      }
      setSalvando(true)
      const r = await cancelarTitulo(tipo, titulo.id, motivo.trim())
      setSalvando(false)
      if (!r.ok) {
        setErro(r.message)
        return
      }
      onFeito('Lançamento cancelado.')
      return
    }

    const cents = centavosDoTexto(valor)
    const data = dataDoTexto(vencimento)
    if (cents === null || cents <= 0) {
      setErro('Informe um valor maior que zero.')
      return
    }
    if (pagar && fornecedor.trim().length < 2) {
      setErro('Informe o fornecedor.')
      return
    }
    if (descricao.trim().length < 2) {
      setErro('Descreva o lançamento.')
      return
    }
    if (data === null) {
      setErro('Informe o vencimento no formato DD/MM/AAAA.')
      return
    }

    const mudancas: CorrecaoDeTitulo = {}
    if (pagar && fornecedor.trim() !== titulo.contraparte) mudancas.supplier = fornecedor.trim()
    if (descricao.trim() !== titulo.descricao) mudancas.description = descricao.trim()
    if (cents !== titulo.valorCents) mudancas.amountCents = cents
    if (data !== titulo.vencimento) mudancas.dueDate = data

    if (Object.keys(mudancas).length === 0) {
      onFechar()
      return
    }

    setSalvando(true)
    const r = await corrigirTitulo(tipo, titulo.id, mudancas)
    setSalvando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    onFeito('Lançamento corrigido.')
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable
          style={estilos.foraDaFolha}
          onPress={() => !salvando && onFechar()}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={estilos.folha}>
          <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
            <Text style={estilos.titulo}>
              {cancelar ? 'Cancelar lançamento' : 'Corrigir lançamento'}
            </Text>

            {cancelar ? (
              <>
                <Text style={estilos.apoio}>
                  {titulo.contraparte} · {titulo.descricao}. O lançamento sai das contas em aberto,
                  mas continua no histórico com o motivo.
                </Text>
                <Campo
                  rotulo="Motivo do cancelamento"
                  valor={motivo}
                  onChange={setMotivo}
                  placeholder="Ex.: lançado em dobro"
                />
              </>
            ) : (
              <>
                {pagar ? (
                  <Campo rotulo="Fornecedor" valor={fornecedor} onChange={setFornecedor} />
                ) : null}

                <View style={estilos.linha}>
                  <View style={estilos.flex}>
                    <Campo
                      rotulo="Vencimento"
                      valor={vencimento}
                      onChange={(v) => setVencimento(mascaraData(v))}
                      tipoTeclado="numeric"
                      placeholder="DD/MM/AAAA"
                    />
                  </View>
                  <View style={estilos.flex}>
                    <Campo
                      rotulo="Valor (R$)"
                      valor={valor}
                      onChange={setValor}
                      tipoTeclado="decimal-pad"
                    />
                  </View>
                </View>

                <Campo
                  rotulo={pagar ? 'Descrição' : 'Referente a'}
                  valor={descricao}
                  onChange={setDescricao}
                />
              </>
            )}

            {erro !== null ? (
              <Text style={estilos.erro} accessibilityRole="alert">
                {erro}
              </Text>
            ) : null}

            <View style={estilos.linha}>
              <View style={estilos.flex}>
                <Botao variante="secundario" onPress={onFechar} desabilitado={salvando} largura>
                  Voltar
                </Botao>
              </View>
              <View style={estilos.flex}>
                <Botao
                  variante={cancelar ? 'perigo' : 'primario'}
                  onPress={() => void confirmar()}
                  carregando={salvando}
                  largura
                >
                  {cancelar ? 'Cancelar' : 'Salvar'}
                </Botao>
              </View>
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
    maxHeight: '92%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  linha: { flexDirection: 'row', gap: espaco.md },
  flex: { flex: 1 },
})
