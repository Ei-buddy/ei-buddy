import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  type DadosDaBaixa,
  FORMAS_DE_RECEBIMENTO,
  type FormaDeRecebimento,
  NOMES_BANCOS,
  nomesDasContasDaLoja,
  type TipoDeTitulo,
} from '@/lib/financeiro-api'
import { diaLocal, formatMoney, hoje } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { centavosDoTexto } from '@/lib/valor'

/**
 * Baixa de titulo no celular — RF-059, RF-066.
 *
 * ## Por que esta tela precisou existir
 *
 * O botao "Baixar" do celular abria um `Alert` que dizia para fazer a baixa no
 * computador. O motivo era real: as duas rotas exigem uma escolha — de qual
 * conta o dinheiro saiu (a pagar) ou como ele entrou (a receber) — e um `Alert`
 * nao tem onde oferecer nada. Mandar um padrao inventado seria pior que nao ter
 * o botao, porque a baixa entraria com dado errado com cara de certo.
 *
 * Mas esconder a operacao mais diaria do financeiro do aparelho que o lojista
 * carrega no bolso nao era resposta. A resposta e PERGUNTAR.
 *
 * ## A data
 *
 * "Hoje" e "Ontem" cobrem quase tudo — a conta paga na hora e a lancada na
 * manha seguinte. O campo aberto existe para o resto, porque a data e o que faz
 * a baixa casar com o extrato: lancada no dia em que alguem lembrou, ela nao
 * casa com nada.
 */

/** "08/09/2026" para "2026-09-08". Devolve nulo quando nao e data. */
function paraIso(texto: string): string | null {
  const partes = texto.split('/')
  if (partes.length !== 3) return null

  const [d, m, a] = partes
  if (d === undefined || m === undefined || a === undefined) return null
  if (d.length !== 2 || m.length !== 2 || a.length !== 4) return null

  const dia = Number(d)
  const mes = Number(m)
  const ano = Number(a)
  if (!Number.isInteger(dia) || !Number.isInteger(mes) || !Number.isInteger(ano)) return null

  /*
   * `new Date` corrige 31/02 para 03/03 em silencio. Comparar os campos de
   * volta e o que recusa uma data que nao existe, em vez de gravar a baixa
   * quatro dias depois do que a pessoa digitou.
   */
  const d0 = new Date(ano, mes - 1, dia)
  if (d0.getFullYear() !== ano || d0.getMonth() !== mes - 1 || d0.getDate() !== dia) return null

  return diaLocal(d0)
}

/** "2026-09-08" para "08/09/2026". */
function paraBr(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/** Digitacao com barras automaticas: 08092026 vira 08/09/2026. */
function mascaraDeData(texto: string): string {
  const n = texto.replace(/\D/g, '').slice(0, 8)
  if (n.length <= 2) return n
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`
}

const ontem = (): string => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return diaLocal(d)
}

export default function BaixaModal({
  tipo,
  contraparte,
  descricao,
  saldoCents,
  processando,
  erro,
  onConfirmar,
  onFechar,
}: {
  tipo: TipoDeTitulo
  contraparte: string
  descricao: string
  saldoCents: number
  processando: boolean
  erro: string | null
  onConfirmar: (dados: DadosDaBaixa) => void
  onFechar: () => void
}) {
  const pagar = tipo === 'pagar'

  const [modo, setModo] = useState<'total' | 'parcial'>('total')
  const [valorParcial, setValorParcial] = useState('')
  const [dataBr, setDataBr] = useState(() => paraBr(hoje()))
  const [conta, setConta] = useState('')
  /* As contas da loja (RF-073); sem nenhuma, as sugestoes genericas. */
  const [contasDaLoja, setContasDaLoja] = useState<string[]>([])
  useEffect(() => {
    let cancelado = false
    void nomesDasContasDaLoja().then((nomes) => {
      if (cancelado) return
      setContasDaLoja(nomes)
      if (nomes.length === 1 && pagar) setConta(nomes[0]!)
    })
    return () => {
      cancelado = true
    }
  }, [pagar])
  const sugestoes = contasDaLoja.length > 0 ? contasDaLoja : NOMES_BANCOS
  const [forma, setForma] = useState<FormaDeRecebimento>('pix')

  /* Na baixa TOTAL o valor e o saldo exato — nao passa por reais e volta. */
  const valorCents = modo === 'total' ? saldoCents : (centavosDoTexto(valorParcial) ?? 0)
  const restanteCents = saldoCents - valorCents
  const dataIso = paraIso(dataBr)

  const erroValor =
    valorCents <= 0 ? null : valorCents > saldoCents ? 'Valor maior que o saldo em aberto.' : null

  const podeConfirmar =
    valorCents > 0 &&
    valorCents <= saldoCents &&
    dataIso !== null &&
    (!pagar || conta.trim() !== '')

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        {/* Toque fora fecha, como em toda folha do app. Nao fecha durante a
            gravacao: perder o formulario no meio de um POST faria a pessoa nao
            saber se a baixa entrou. */}
        <Pressable
          style={estilos.foraDaFolha}
          onPress={() => !processando && onFechar()}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />

        <View style={estilos.folha}>
          <View style={estilos.alcaWrap}>
            <View style={estilos.alca} />
          </View>

          <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
            <Text style={estilos.titulo}>{pagar ? 'Baixar pagamento' : 'Baixar recebimento'}</Text>

            <View style={estilos.alvo}>
              <Text style={estilos.alvoNome} numberOfLines={1}>
                {contraparte}
              </Text>
              <Text style={estilos.alvoApoio} numberOfLines={2}>
                {descricao}
              </Text>
            </View>

            <View style={estilos.saldo}>
              <Text style={estilos.saldoRotulo}>Saldo em aberto</Text>
              <Text style={estilos.saldoValor}>{formatMoney(saldoCents / 100)}</Text>
            </View>

            <View style={estilos.chips} accessibilityRole="radiogroup">
              {(
                [
                  ['total', 'Baixa total'],
                  ['parcial', 'Baixa parcial'],
                ] as const
              ).map(([valor, rotulo]) => (
                <Pressable
                  key={valor}
                  onPress={() => setModo(valor)}
                  disabled={processando}
                  style={[estilos.chip, modo === valor && estilos.chipAtivo]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: modo === valor }}
                >
                  <Text style={[estilos.chipTexto, modo === valor && estilos.chipTextoAtivo]}>
                    {rotulo}
                  </Text>
                </Pressable>
              ))}
            </View>

            {modo === 'parcial' ? (
              <Campo
                rotulo={pagar ? 'Valor pago agora' : 'Valor recebido agora'}
                valor={valorParcial}
                onChange={setValorParcial}
                erro={erroValor}
                dica={
                  valorCents > 0 && restanteCents > 0
                    ? `Restam ${formatMoney(restanteCents / 100)} em aberto`
                    : valorCents > 0 && restanteCents === 0
                      ? 'Este valor quita o título'
                      : undefined
                }
                placeholder="0,00"
                tipoTeclado="decimal-pad"
                editavel={!processando}
              />
            ) : null}

            <View style={estilos.chips}>
              {(
                [
                  ['Hoje', hoje()],
                  ['Ontem', ontem()],
                ] as const
              ).map(([rotulo, iso]) => (
                <Pressable
                  key={rotulo}
                  onPress={() => setDataBr(paraBr(iso))}
                  disabled={processando}
                  style={[estilos.chip, dataIso === iso && estilos.chipAtivo]}
                  accessibilityRole="button"
                >
                  <Text style={[estilos.chipTexto, dataIso === iso && estilos.chipTextoAtivo]}>
                    {rotulo}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Campo
              rotulo={pagar ? 'Data da saída' : 'Data da entrada'}
              valor={dataBr}
              onChange={(v) => setDataBr(mascaraDeData(v))}
              erro={dataBr.length === 10 && dataIso === null ? 'Data inválida.' : null}
              placeholder="dd/mm/aaaa"
              tipoTeclado="numeric"
              editavel={!processando}
            />

            {pagar ? (
              <>
                <Campo
                  rotulo="Conta de onde saiu"
                  valor={conta}
                  onChange={setConta}
                  placeholder="Ex.: Banco do Brasil"
                  editavel={!processando}
                />
                {/* Atalhos para as contas conhecidas. Digitar o nome do banco
                    inteiro no celular e o tipo de atrito que faz a pessoa
                    desistir e deixar a baixa para depois — e depois nao vem. */}
                <View style={estilos.chips}>
                  {sugestoes.map((b) => (
                    <Pressable
                      key={b}
                      onPress={() => setConta(b)}
                      disabled={processando}
                      style={[estilos.chip, conta === b && estilos.chipAtivo]}
                      accessibilityRole="button"
                    >
                      <Text style={[estilos.chipTexto, conta === b && estilos.chipTextoAtivo]}>
                        {b}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <View style={estilos.grupo}>
                <Text style={estilos.grupoRotulo}>Como o cliente pagou</Text>
                <View style={estilos.chips} accessibilityRole="radiogroup">
                  {FORMAS_DE_RECEBIMENTO.map((f) => (
                    <Pressable
                      key={f.valor}
                      onPress={() => setForma(f.valor)}
                      disabled={processando}
                      style={[estilos.chip, forma === f.valor && estilos.chipAtivo]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: forma === f.valor }}
                    >
                      <Text
                        style={[estilos.chipTexto, forma === f.valor && estilos.chipTextoAtivo]}
                      >
                        {f.rotulo}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {erro !== null ? (
              <Text style={estilos.erro} accessibilityRole="alert">
                {erro}
              </Text>
            ) : null}

            <View style={estilos.acoes}>
              <Botao variante="secundario" onPress={onFechar} desabilitado={processando} largura>
                Cancelar
              </Botao>
              <Botao
                onPress={() => {
                  if (dataIso === null) return
                  onConfirmar({
                    amountCents: valorCents,
                    settledOn: dataIso,
                    ...(pagar ? { bankAccount: conta.trim() } : { method: forma }),
                  })
                }}
                carregando={processando}
                desabilitado={!podeConfirmar}
                largura
              >
                {processando ? 'Registrando...' : `Confirmar ${formatMoney(valorCents / 100)}`}
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
  alcaWrap: { alignItems: 'center', paddingTop: espaco.sm },
  alca: { width: 40, height: 4, borderRadius: 2, backgroundColor: cores.borda },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },

  alvo: { gap: 2 },
  alvoNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  alvoApoio: { fontSize: fonte.micro, color: cores.textoFraco },

  saldo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: espaco.md,
    paddingHorizontal: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  saldoRotulo: { fontSize: fonte.micro, color: cores.textoFraco },
  saldoValor: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },

  grupo: { gap: espaco.sm },
  grupoRotulo: { fontSize: fonte.micro, color: cores.textoFraco },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
    borderWidth: 1,
    borderColor: cores.borda,
    backgroundColor: cores.superficie,
  },
  chipAtivo: { borderColor: cores.acento, backgroundColor: cores.acento },
  chipTexto: { fontSize: fonte.micro, color: cores.texto },
  chipTextoAtivo: { color: cores.textoSobreAcento, fontWeight: peso.forte },

  erro: {
    padding: espaco.md,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: cores.erro,
    color: cores.erro,
    fontSize: fonte.micro,
    lineHeight: 19,
  },

  acoes: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm },
})
