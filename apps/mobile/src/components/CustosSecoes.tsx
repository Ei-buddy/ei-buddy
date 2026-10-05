import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ContaContabil } from '@/lib/contabilidade-api'
import {
  carregarCustosFixos,
  carregarCustosVariaveis,
  criarCustoVariavel,
  excluirCustoFixo,
  excluirCustoVariavel,
  gerarContasDoMes,
  salvarCustoFixo,
  type CustoFixo,
  type CustoVariavel,
} from '@/lib/custos-api'
import { formatMoney, hoje } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import Sanfona from '@/components/ui/Sanfona'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Custos fixos — NR-110, como no web.
 *
 * O que vence todo mes. "Gerar contas do mes" cria as contas a pagar do mes
 * corrente; as que ja existiam sao puladas, entao tocar duas vezes nao duplica.
 */
export function CustosFixos({ contas }: { contas: ContaContabil[] }) {
  const [custos, setCustos] = useState<CustoFixo[] | null>(null)
  const [editando, setEditando] = useState<CustoFixo | 'novo' | null>(null)
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(async () => {
    const r = await carregarCustosFixos()
    if (r.ok) setCustos(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function gerar() {
    setGerando(true)
    const r = await gerarContasDoMes(hoje().slice(0, 7))
    setGerando(false)
    if (!r.ok) {
      Alert.alert('Não deu para gerar', r.erro)
      return
    }
    Alert.alert(
      'Contas do mês',
      r.dados.jaExistiam > 0
        ? `${r.dados.geradas} conta(s) gerada(s). ${r.dados.jaExistiam} já existiam neste mês e foram puladas.`
        : `${r.dados.geradas} conta(s) a pagar gerada(s) para este mês.`,
    )
  }

  function excluir(c: CustoFixo) {
    Alert.alert(`Excluir ${c.nome}?`, 'As contas já geradas continuam em contas a pagar.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const r = await excluirCustoFixo(c.id)
            if (!r.ok) Alert.alert('Não deu para excluir', r.erro)
            else await carregar()
          })(),
      },
    ])
  }

  const total = (custos ?? []).reduce((s, c) => s + c.valorCents, 0)

  return (
    <Sanfona
      titulo="Custos fixos"
      resumo={custos === null ? 'carregando' : `${custos.length} · ${formatMoney(total / 100)}/mês`}
    >
      <View style={estilos.bloco}>
        {(custos ?? []).map((c) =>
          editando !== null && editando !== 'novo' && editando.id === c.id ? (
            <FormCustoFixo
              key={c.id}
              custo={c}
              contas={contas}
              onSalvo={() => {
                setEditando(null)
                void carregar()
              }}
              onCancelar={() => setEditando(null)}
            />
          ) : (
            <Pressable
              key={c.id}
              style={estilos.linha}
              onPress={() => setEditando(c)}
              onLongPress={() => excluir(c)}
              accessibilityRole="button"
              accessibilityHint="Toque para editar, segure para excluir"
            >
              <View style={estilos.flex}>
                <Text style={estilos.nome}>{c.nome}</Text>
                <Text style={estilos.apoio}>
                  todo dia {c.diaVencimento}
                  {c.planoContasNome ? ` · ${c.planoContasNome}` : ''}
                </Text>
              </View>
              <Text style={estilos.valor}>{formatMoney(c.valorCents / 100)}</Text>
            </Pressable>
          ),
        )}

        {editando === 'novo' ? (
          <FormCustoFixo
            custo={null}
            contas={contas}
            onSalvo={() => {
              setEditando(null)
              void carregar()
            }}
            onCancelar={() => setEditando(null)}
          />
        ) : (
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={() => setEditando('novo')} largura>
                Novo custo fixo
              </Botao>
            </View>
            {custos !== null && custos.length > 0 ? (
              <View style={estilos.flex}>
                <Botao onPress={() => void gerar()} carregando={gerando} largura>
                  Gerar contas do mês
                </Botao>
              </View>
            ) : null}
          </View>
        )}
        {custos !== null && custos.length > 0 ? (
          <Text style={estilos.apoio}>Toque para editar; segure para excluir.</Text>
        ) : null}
      </View>
    </Sanfona>
  )
}

function FormCustoFixo({
  custo,
  contas,
  onSalvo,
  onCancelar,
}: {
  custo: CustoFixo | null
  contas: ContaContabil[]
  onSalvo: () => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(custo?.nome ?? '')
  const [dia, setDia] = useState(custo ? String(custo.diaVencimento) : '')
  const [valor, setValor] = useState(
    custo ? (custo.valorCents / 100).toFixed(2).replace('.', ',') : '',
  )
  const [contaId, setContaId] = useState<string | null>(custo?.planoContasId ?? null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const despesas = contas.filter((c) => c.type === 'expense' || c.type === 'cost')

  async function salvar() {
    const centavos = centavosDoTexto(valor)
    const d = Number(dia)
    if (nome.trim().length < 2) return setErro('Informe o nome do custo.')
    if (!Number.isInteger(d) || d < 1 || d > 31) return setErro('Dia do vencimento entre 1 e 31.')
    if (centavos === null || centavos <= 0) return setErro('Informe o valor.')
    setErro(null)
    setSalvando(true)
    const r = await salvarCustoFixo(
      { nome, valorCents: centavos, diaVencimento: d, planoContasId: contaId },
      custo?.id,
    )
    setSalvando(false)
    if (!r.ok) return setErro(r.erro)
    onSalvo()
  }

  return (
    <View style={estilos.form}>
      <Campo rotulo="Nome" valor={nome} onChange={setNome} placeholder="Aluguel do ponto" />
      <View style={estilos.acoes}>
        <View style={estilos.flex}>
          <Campo
            rotulo="Dia do vencimento"
            valor={dia}
            onChange={(v) => setDia(v.replace(/\D/g, '').slice(0, 2))}
            tipoTeclado="numeric"
            placeholder="5"
          />
        </View>
        <View style={estilos.flex}>
          <Campo
            rotulo="Valor (R$)"
            valor={valor}
            onChange={setValor}
            tipoTeclado="decimal-pad"
            placeholder="0,00"
          />
        </View>
      </View>
      <Text style={estilos.apoio}>Plano de conta</Text>
      <View style={estilos.chips}>
        {[{ id: null, name: 'Sem classificação' }, ...despesas].map((c) => (
          <Pressable
            key={c.id ?? 'nenhum'}
            onPress={() => setContaId(c.id)}
            style={[estilos.chip, contaId === c.id && estilos.chipAtivo]}
          >
            <Text style={[estilos.chipTexto, contaId === c.id && estilos.chipTextoAtivo]}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </View>
      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
      <View style={estilos.acoes}>
        <View style={estilos.flex}>
          <Botao variante="secundario" onPress={onCancelar} largura>
            Cancelar
          </Botao>
        </View>
        <View style={estilos.flex}>
          <Botao onPress={() => void salvar()} carregando={salvando} largura>
            {custo ? 'Salvar' : 'Criar'}
          </Botao>
        </View>
      </View>
    </View>
  )
}

const SUGESTOES = ['Tarifa do cartão', 'Imposto', 'Custo operacional', 'Comissão']

/**
 * Custos variaveis — percentual sobre o preco de venda, como no web. Vale para
 * todo produto; o cadastro de produto mostra quanto sobra depois deles.
 */
export function CustosVariaveis() {
  const [custos, setCustos] = useState<CustoVariavel[] | null>(null)
  const [nome, setNome] = useState('')
  const [percentual, setPercentual] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await carregarCustosVariaveis()
      if (cancelado) return
      if (r.ok) setCustos(r.dados)
      else setErro(r.erro)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function adicionar() {
    const p = Number(percentual.trim().replace(',', '.'))
    if (nome.trim().length < 2) return setErro('Informe o nome do custo.')
    if (!(p > 0 && p <= 100)) return setErro('Informe um percentual entre 0 e 100.')
    setErro(null)
    setSalvando(true)
    const r = await criarCustoVariavel(nome, p)
    setSalvando(false)
    if (!r.ok) return setErro(r.erro)
    setCustos((c) => [...(c ?? []), r.dados])
    setNome('')
    setPercentual('')
  }

  async function excluir(c: CustoVariavel) {
    const r = await excluirCustoVariavel(c.id)
    if (!r.ok) return setErro(r.erro)
    setCustos((atual) => (atual ?? []).filter((x) => x.id !== c.id))
  }

  const total = (custos ?? []).reduce((s, c) => s + c.percentual, 0)
  const pct = (n: number) =>
    `${n
      .toFixed(2)
      .replace(/\.?0+$/, '')
      .replace('.', ',')}%`
  const livres = SUGESTOES.filter((s) => !(custos ?? []).some((c) => c.nome === s))

  return (
    <Sanfona titulo="Custos variáveis" resumo={custos === null ? 'carregando' : pct(total)}>
      <View style={estilos.bloco}>
        <Text style={estilos.apoio}>Percentual sobre o preço de venda de todo produto.</Text>
        {(custos ?? []).map((c) => (
          <View key={c.id} style={estilos.linha}>
            <Text style={[estilos.nome, estilos.flex]}>{c.nome}</Text>
            <Text style={estilos.valor}>{pct(c.percentual)}</Text>
            <Pressable
              onPress={() => void excluir(c)}
              hitSlop={8}
              accessibilityLabel={`Excluir ${c.nome}`}
            >
              <Text style={estilos.apagar}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={estilos.chips}>
          {livres.map((s) => (
            <Pressable key={s} onPress={() => setNome(s)} style={estilos.chip}>
              <Text style={estilos.chipTexto}>{s}</Text>
            </Pressable>
          ))}
        </View>
        <View style={estilos.acoes}>
          <View style={estilos.flexDois}>
            <Campo rotulo="Nome" valor={nome} onChange={setNome} />
          </View>
          <View style={estilos.flex}>
            <Campo
              rotulo="%"
              valor={percentual}
              onChange={setPercentual}
              tipoTeclado="decimal-pad"
              placeholder="3,5"
            />
          </View>
        </View>
        {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
        <Botao variante="secundario" onPress={() => void adicionar()} carregando={salvando} largura>
          Adicionar
        </Botao>
      </View>
    </Sanfona>
  )
}

const estilos = StyleSheet.create({
  bloco: { gap: espaco.sm },
  form: {
    gap: espaco.sm,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
  },
  flex: { flex: 1 },
  flexDois: { flex: 2 },
  acoes: { flexDirection: 'row', gap: espaco.sm },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: 6 },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  valor: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  apagar: { fontSize: 20, color: cores.textoFraco, paddingHorizontal: espaco.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
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
