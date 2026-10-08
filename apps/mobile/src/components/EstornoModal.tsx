import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import {
  type Baixa,
  estornarBaixa,
  FORMAS_DE_RECEBIMENTO,
  listarBaixas,
  type TipoDeTitulo,
} from '@/lib/financeiro-api'
import { formatDate, formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Vazio } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** O motivo e obrigatorio no servidor, e o minimo la sao 3 caracteres. */
const MOTIVO_MINIMO = 3

const rotuloDaForma = (m: string | null) =>
  m === null ? null : (FORMAS_DE_RECEBIMENTO.find((f) => f.valor === m)?.rotulo ?? m)

/**
 * Estorno de baixa no celular — RF-067.
 *
 * ## Por que precisa de tela, e nao de um "tem certeza?"
 *
 * O estorno endereca a BAIXA (`POST /baixas/:id/estorno`), e nao o titulo. Um
 * titulo pode ter varias — a parcial de ontem e o resto de hoje — e o servidor
 * desfaz UMA. "Estornar o titulo" e uma pergunta sem resposta, e era por isso
 * que o celular recusava a operacao: a lista de titulos nao carrega as baixas de
 * cada um, e sem elas estornar seria palpite sobre qual lancamento desfazer.
 *
 * Agora a tela CARREGA o historico (`GET /contas-a-{pagar,receber}/:id/baixas`,
 * que passou a existir na NR-081) e a escolha fica com quem sabe.
 *
 * ## O historico inteiro aparece
 *
 * Linhas de estorno (negativas) e baixas ja estornadas ficam visiveis, apagadas
 * e sem escolha. Esconde-las faria a soma da lista discordar do saldo do titulo,
 * e quem abre isto para entender por que o saldo mudou veria faltando justamente
 * o pedaco que explica.
 */
export default function EstornoModal({
  tipo,
  tituloId,
  contraparte,
  descricao,
  onEstornado,
  onFechar,
}: {
  tipo: TipoDeTitulo
  tituloId: string
  contraparte: string
  descricao: string
  /** A tela recarrega a lista: saldo e status quem decide e o servidor. */
  onEstornado: (mensagem: string) => void
  onFechar: () => void
}) {
  const [baixas, setBaixas] = useState<Baixa[] | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    void (async () => {
      const r = await listarBaixas(tipo, tituloId)
      if (cancelado) return

      if (!r.ok) {
        setErroCarga(r.message)
        setBaixas([])
        return
      }

      setBaixas(r.dados)

      /* Ja marca a primeira estornavel: a lista vem da mais recente para a mais
         antiga, e "a ultima baixa foi errada" e o motivo de quase toda visita. */
      const estornadas = new Set(r.dados.map((b) => b.reversesId).filter((id) => id !== null))
      setEscolhida(r.dados.find((b) => b.amountCents > 0 && !estornadas.has(b.id))?.id ?? null)
    })()

    return () => {
      cancelado = true
    }
  }, [tipo, tituloId])

  const estornadas = new Set((baixas ?? []).map((b) => b.reversesId).filter((id) => id !== null))
  const podeSerEstornada = (b: Baixa) => b.amountCents > 0 && !estornadas.has(b.id)
  const estornaveis = (baixas ?? []).filter(podeSerEstornada)

  const podeConfirmar = escolhida !== null && motivo.trim().length >= MOTIVO_MINIMO && !processando

  async function confirmar() {
    if (escolhida === null) return

    setProcessando(true)
    setErro(null)

    const r = await estornarBaixa(escolhida, motivo.trim())
    setProcessando(false)

    if (!r.ok) {
      setErro(r.message)
      return
    }

    /* O valor vem do servidor, negativo. O modulo e o que foi devolvido. */
    onEstornado(`Estorno de ${formatMoney(Math.abs(r.dados.amountCents) / 100)} registrado.`)
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
          <View style={estilos.alcaWrap}>
            <View style={estilos.alca} />
          </View>

          <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
            <Text style={estilos.titulo}>Estornar baixa</Text>

            <View style={estilos.alvo}>
              <Text style={estilos.alvoNome} numberOfLines={1}>
                {contraparte}
              </Text>
              <Text style={estilos.alvoApoio} numberOfLines={2}>
                {descricao}
              </Text>
            </View>

            {baixas === null ? (
              <Vazio titulo="Carregando" descricao="Buscando as baixas do título." />
            ) : erroCarga !== null ? (
              <Vazio
                titulo="Não foi possível carregar"
                descricao={`${erroCarga} Feche e tente de novo.`}
              />
            ) : baixas.length === 0 ? (
              <Vazio titulo="Este título não tem baixas" descricao="Não há nada para estornar." />
            ) : (
              <>
                <View style={estilos.lista}>
                  {baixas.map((b) => {
                    const estornavel = podeSerEstornada(b)
                    const negativa = b.amountCents < 0
                    const marcada = escolhida === b.id

                    const detalhe = negativa
                      ? 'Estorno'
                      : estornadas.has(b.id)
                        ? 'Baixa já estornada'
                        : [rotuloDaForma(b.method), b.bankAccount].filter(Boolean).join(' · ') ||
                          'Baixa'

                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => estornavel && setEscolhida(b.id)}
                        disabled={!estornavel || processando}
                        style={[
                          estilos.item,
                          marcada && estilos.itemMarcado,
                          !estornavel && estilos.itemInerte,
                        ]}
                        accessibilityRole={estornavel ? 'radio' : 'text'}
                        accessibilityState={estornavel ? { selected: marcada } : undefined}
                      >
                        <View style={estilos.itemTopo}>
                          <Text style={[estilos.itemValor, negativa && estilos.itemValorNegativo]}>
                            {negativa ? '−' : ''}
                            {formatMoney(Math.abs(b.amountCents) / 100)}
                          </Text>
                          <Text style={estilos.itemData}>{formatDate(b.settledOn)}</Text>
                        </View>
                        <Text style={estilos.itemDetalhe} numberOfLines={2}>
                          {detalhe}
                          {b.notes !== null && b.notes !== '' ? ` — ${b.notes}` : ''}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>

                {estornaveis.length === 0 ? (
                  <Text style={estilos.aviso}>
                    Todas as baixas deste título já foram estornadas. Para baixar de novo, lance uma
                    baixa — o estorno de um estorno nao existe.
                  </Text>
                ) : (
                  <Campo
                    rotulo="Motivo do estorno"
                    valor={motivo}
                    onChange={setMotivo}
                    placeholder="Ex.: lançado na conta errada"
                    dica="Fica na trilha: é a resposta para “por que esse saldo mudou”."
                    editavel={!processando}
                  />
                )}
              </>
            )}

            {erro !== null ? (
              <Text style={estilos.erro} accessibilityRole="alert">
                {erro}
              </Text>
            ) : null}

            <View style={estilos.acoes}>
              <Botao variante="secundario" onPress={onFechar} desabilitado={processando} largura>
                {estornaveis.length === 0 ? 'Fechar' : 'Cancelar'}
              </Botao>
              {estornaveis.length > 0 ? (
                <Botao
                  variante="perigo"
                  onPress={confirmar}
                  carregando={processando}
                  desabilitado={!podeConfirmar}
                  largura
                >
                  {processando ? 'Estornando...' : 'Estornar'}
                </Botao>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: cores.veu },
  foraDaFolha: { flex: 1 },

  folha: {
    ...vidro.painel,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
    maxHeight: '88%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  alcaWrap: { alignItems: 'center', paddingTop: espaco.sm },
  alca: { width: 40, height: 4, borderRadius: 2, backgroundColor: cores.borda },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },

  alvo: { gap: 2 },
  alvoNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  alvoApoio: { fontSize: fonte.micro, color: cores.textoFraco },

  lista: { gap: espaco.sm },
  item: {
    ...vidro.peca,
    gap: 3,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
  },
  itemMarcado: { borderColor: cores.acento },
  /* Ja estornada ou linha de estorno: aparece, mas nao e escolhivel. */
  itemInerte: { opacity: 0.62 },
  itemTopo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  itemValor: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },
  /* O estorno e uma linha NEGATIVA — o sinal e informacao, nao defeito. */
  itemValorNegativo: { color: cores.erro },
  itemData: { fontSize: fonte.micro, color: cores.textoFraco },
  itemDetalhe: { fontSize: fonte.micro, color: cores.textoFraco, lineHeight: 17 },

  aviso: { fontSize: fonte.micro, color: cores.atencao, lineHeight: 19 },

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
}))
