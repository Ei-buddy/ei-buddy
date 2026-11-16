import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import { formatDate } from '@/lib/format'
import {
  BANDEIRAS,
  formularioDe,
  lerTaxasDeRecebimento,
  PARCELAS_DA_TABELA,
  salvarTaxasDeRecebimento,
  souResponsavel,
  taxasDoFormulario,
  type FormularioDeTaxas,
  type TabelaDeTaxas,
} from '@/lib/taxas-api'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

type Excecao = FormularioDeTaxas['excecoes'][number]

/**
 * Taxas de recebimento — DEC-027 (NR-224), a mesma tela do web.
 *
 * O que a maquininha cobra em cada forma e em quantos dias o dinheiro cai. A
 * venda grava o liquido com esta tabela; mudar aqui vale para as proximas
 * vendas. Todo mundo le; so o responsavel altera.
 */
export default function TaxasDeRecebimento() {
  const [tabela, setTabela] = useState<TabelaDeTaxas | null>(null)
  const [form, setForm] = useState<FormularioDeTaxas | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [responsavel, setResponsavel] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null)

  async function carregar() {
    const [r, dono] = await Promise.all([lerTaxasDeRecebimento(), souResponsavel()])
    if (r.ok) {
      setTabela(r.dados)
      setForm(formularioDe(r.dados))
      setErro(null)
    } else setErro(r.erro)
    setResponsavel(dono)
  }

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [])

  const mudar = (parte: Partial<FormularioDeTaxas>) => setForm((f) => (f ? { ...f, ...parte } : f))
  const mudarCredito = (i: number, v: string) =>
    setForm((f) => (f ? { ...f, credito: f.credito.map((x, j) => (j === i ? v : x)) } : f))
  const mudarExcecao = (i: number, parte: Partial<Excecao>) =>
    setForm((f) =>
      f ? { ...f, excecoes: f.excecoes.map((e, j) => (j === i ? { ...e, ...parte } : e)) } : f,
    )

  async function salvar() {
    if (form === null) return
    const montado = taxasDoFormulario(form)
    if (!montado.ok) {
      setMensagem({ texto: montado.erro, erro: true })
      return
    }
    setSalvando(true)
    const r = await salvarTaxasDeRecebimento(montado.dados)
    setSalvando(false)
    if (!r.ok) {
      setMensagem({ texto: r.erro, erro: true })
      return
    }
    setTabela(r.dados)
    setForm(formularioDe(r.dados))
    setMensagem({ texto: 'Taxas salvas. Valem para as próximas vendas.', erro: false })
  }

  const editavel = responsavel && !salvando

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Taxas de recebimento" subtitulo="Pix, débito, crédito e prazos" />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {erro !== null ? (
          <Vazio
            titulo="Não deu para carregar"
            descricao={erro}
            acao={<Botao onPress={() => void carregar()}>Tentar de novo</Botao>}
          />
        ) : form === null || tabela === null ? (
          <Vazio titulo="Carregando" descricao="Buscando as taxas da loja." />
        ) : (
          <>
            <Text style={estilos.apoio} accessibilityRole="text">
              {tabela.isDefault
                ? 'Estes são os valores padrão: a loja ainda não configurou as suas taxas. Confira com o contrato da sua maquininha e salve.'
                : `Taxas da loja, salvas em ${formatDate(tabela.updatedAt!.slice(0, 10))}. Vale para as próximas vendas; as já feitas continuam como foram gravadas.`}
              {responsavel ? '' : ' Somente o responsável pela loja altera as taxas.'}
            </Text>

            <Cartao titulo="Pix e débito">
              <View style={estilos.formulario}>
                <View style={estilos.linha}>
                  <View style={estilos.flex}>
                    <Campo
                      rotulo="Pix (%)"
                      valor={form.pix}
                      onChange={(v) => mudar({ pix: v })}
                      tipoTeclado="decimal-pad"
                      editavel={editavel}
                    />
                  </View>
                  <View style={estilos.flex}>
                    <Campo
                      rotulo="Débito (%)"
                      valor={form.debito}
                      onChange={(v) => mudar({ debito: v })}
                      tipoTeclado="decimal-pad"
                      editavel={editavel}
                    />
                  </View>
                </View>
                <Campo
                  rotulo="Débito cai em (dias)"
                  valor={form.diasDebito}
                  onChange={(v) => mudar({ diasDebito: v })}
                  tipoTeclado="numeric"
                  editavel={editavel}
                />
              </View>
            </Cartao>

            <Cartao titulo="Crédito por parcelas">
              <Text style={estilos.apoio}>
                Deixe em branco as parcelas que a loja não oferece: o caixa só mostra as que têm
                taxa.
              </Text>
              <View style={estilos.grade}>
                {Array.from({ length: PARCELAS_DA_TABELA }, (_, i) => (
                  <View key={i} style={estilos.celula}>
                    <Campo
                      rotulo={i === 0 ? 'À vista (%)' : `${i + 1}x (%)`}
                      valor={form.credito[i] ?? ''}
                      onChange={(v) => mudarCredito(i, v)}
                      tipoTeclado="decimal-pad"
                      editavel={editavel}
                    />
                  </View>
                ))}
              </View>
              <Campo
                rotulo="1ª parcela cai em (dias)"
                dica="as seguintes, a cada mês"
                valor={form.diasCredito}
                onChange={(v) => mudar({ diasCredito: v })}
                tipoTeclado="numeric"
                editavel={editavel}
              />
            </Cartao>

            <Cartao
              titulo="Bandeira com taxa diferente"
              acao={
                responsavel ? (
                  <Botao
                    variante="secundario"
                    onPress={() =>
                      mudar({
                        excecoes: [
                          ...form.excecoes,
                          { bandeira: 'amex', forma: 'credit', parcelas: 1, taxa: '' },
                        ],
                      })
                    }
                  >
                    Adicionar
                  </Botao>
                ) : undefined
              }
            >
              {form.excecoes.length === 0 ? (
                <Text style={estilos.apoio}>
                  Nenhuma: todas as bandeiras usam as taxas acima. Use quando o contrato cobra
                  diferente de uma bandeira (por exemplo, Amex).
                </Text>
              ) : (
                form.excecoes.map((ex, i) => (
                  <View key={i} style={estilos.excecao}>
                    <View style={estilos.chips}>
                      {BANDEIRAS.map((b) => (
                        <Chip
                          key={b.valor}
                          rotulo={b.rotulo}
                          ativo={ex.bandeira === b.valor}
                          onPress={
                            editavel ? () => mudarExcecao(i, { bandeira: b.valor }) : undefined
                          }
                        />
                      ))}
                    </View>
                    <View style={estilos.chips}>
                      <Chip
                        rotulo="Crédito"
                        ativo={ex.forma === 'credit'}
                        onPress={editavel ? () => mudarExcecao(i, { forma: 'credit' }) : undefined}
                      />
                      <Chip
                        rotulo="Débito"
                        ativo={ex.forma === 'debit'}
                        onPress={
                          editavel
                            ? () => mudarExcecao(i, { forma: 'debit', parcelas: 1 })
                            : undefined
                        }
                      />
                      {ex.forma === 'credit' ? (
                        <View style={estilos.passo}>
                          <Pressable
                            onPress={() =>
                              mudarExcecao(i, { parcelas: Math.max(1, ex.parcelas - 1) })
                            }
                            disabled={!editavel}
                            accessibilityLabel="Menos parcelas"
                            style={estilos.passoBotao}
                          >
                            <Text style={estilos.chipTexto}>−</Text>
                          </Pressable>
                          <Text style={estilos.chipTexto}>
                            {ex.parcelas === 1 ? 'À vista' : `${ex.parcelas}x`}
                          </Text>
                          <Pressable
                            onPress={() =>
                              mudarExcecao(i, {
                                parcelas: Math.min(PARCELAS_DA_TABELA, ex.parcelas + 1),
                              })
                            }
                            disabled={!editavel}
                            accessibilityLabel="Mais parcelas"
                            style={estilos.passoBotao}
                          >
                            <Text style={estilos.chipTexto}>+</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                    <View style={estilos.linha}>
                      <View style={estilos.flex}>
                        <Campo
                          rotulo="Taxa (%)"
                          valor={ex.taxa}
                          onChange={(v) => mudarExcecao(i, { taxa: v })}
                          tipoTeclado="decimal-pad"
                          editavel={editavel}
                        />
                      </View>
                      {responsavel ? (
                        <Pressable
                          onPress={() =>
                            mudar({ excecoes: form.excecoes.filter((_, j) => j !== i) })
                          }
                          accessibilityRole="button"
                          hitSlop={8}
                          style={estilos.remover}
                        >
                          <Text style={estilos.removerTexto}>Remover</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </Cartao>

            <Cartao titulo="Antecipação">
              <Text style={estilos.apoio}>
                Por enquanto só guarda o parâmetro: nenhum recebível é antecipado e nenhum
                vencimento muda.
              </Text>
              <View style={estilos.formulario}>
                <View style={estilos.alternar}>
                  <Text style={estilos.rotulo}>A loja antecipa os recebíveis do cartão</Text>
                  <Switch
                    value={form.antecipacao}
                    onValueChange={(v) => mudar({ antecipacao: v })}
                    disabled={!editavel}
                  />
                </View>
                <Campo
                  rotulo="Taxa mensal (%)"
                  valor={form.taxaAntecipacao}
                  onChange={(v) => mudar({ taxaAntecipacao: v })}
                  tipoTeclado="decimal-pad"
                  placeholder="em branco"
                  editavel={editavel}
                />
              </View>
            </Cartao>

            {mensagem !== null ? (
              <Text style={mensagem.erro ? estilos.erro : estilos.sucesso}>{mensagem.texto}</Text>
            ) : null}
            {responsavel ? (
              <Botao onPress={() => void salvar()} carregando={salvando} largura>
                Salvar taxas
              </Botao>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Chip({
  rotulo,
  ativo,
  onPress,
}: {
  rotulo: string
  ativo: boolean
  onPress: (() => void) | undefined
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={onPress === undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      style={[estilos.chip, ativo && estilos.chipAtivo]}
    >
      <Text style={[estilos.chipTexto, ativo && estilos.chipTextoAtivo]}>{rotulo}</Text>
    </Pressable>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1 },
  formulario: { gap: espaco.md },
  linha: { flexDirection: 'row', gap: espaco.md, alignItems: 'flex-end' },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginVertical: espaco.md },
  celula: { width: '30%', flexGrow: 1 },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  rotulo: { fontSize: fonte.pequeno, color: cores.texto, flex: 1 },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  sucesso: { fontSize: fonte.pequeno, color: cores.acento },
  alternar: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  excecao: {
    ...vidro.peca,
    gap: espaco.sm,
    padding: espaco.md,
    borderRadius: raio.md,
    marginTop: espaco.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, alignItems: 'center' },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.xs,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipAtivo: { backgroundColor: cores.acento, borderColor: cores.acento },
  chipTexto: { fontSize: fonte.micro, color: cores.textoFraco, fontWeight: peso.forte },
  chipTextoAtivo: { color: cores.fundo },
  passo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  passoBotao: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  remover: { paddingBottom: espaco.md },
  removerTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
}))
