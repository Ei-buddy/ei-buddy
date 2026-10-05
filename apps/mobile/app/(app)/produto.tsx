import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  ajustarEstoque,
  buscarProduto,
  calcularMargem,
  carregarMovimentos,
  nivelEstoque,
  ROTULO_DA_CAUSA,
  type MovimentoDeEstoque,
  type ProdutoDaFicha,
} from '@/lib/produtos-api'
import { formatDateTime, formatMoney, formatPercent } from '@/lib/format'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/** O motivo do ajuste vai para a trilha; o contrato pede ao menos 3 caracteres. */
const MOTIVO_MINIMO = 3

/**
 * A ficha do produto — RF-017, RF-022, RF-023, RF-124, a mesma do web.
 *
 * Preco, custo, margem e saldo; o ajuste de estoque pela contagem, com motivo;
 * e o historico de tudo que mexeu no saldo — venda, estorno, devolucao, ajuste.
 */
export default function ProdutoScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [produto, setProduto] = useState<ProdutoDaFicha | null>(null)
  const [movimentos, setMovimentos] = useState<MovimentoDeEstoque[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [ajustando, setAjustando] = useState(false)
  const [contagem, setContagem] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroAjuste, setErroAjuste] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [p, m] = await Promise.all([buscarProduto(id), carregarMovimentos(id)])
    if (!p.ok) {
      setErro(p.erro)
      return
    }
    setErro(null)
    setProduto(p.dados)
    setMovimentos(m.ok ? m.dados : [])
  }, [id])

  /* Voltar da edicao recarrega: preco ou minimo podem ter mudado. */
  useFocusEffect(
    useCallback(() => {
      void carregar()
    }, [carregar]),
  )

  async function confirmarAjuste() {
    const n = Number.parseInt(contagem, 10)
    if (!Number.isFinite(n) || n < 0) {
      setErroAjuste('Informe quantas unidades há na prateleira.')
      return
    }
    setEnviando(true)
    setErroAjuste(null)
    const r = await ajustarEstoque(id, n, motivo)
    setEnviando(false)
    if (!r.ok) {
      setErroAjuste(r.erro)
      return
    }
    setAjustando(false)
    setContagem('')
    setMotivo('')
    void carregar()
  }

  if (erro !== null || produto === null) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Produto" />
        {erro !== null ? (
          <Vazio
            titulo="Não deu para abrir o produto"
            descricao={erro}
            acao={<Botao onPress={() => void carregar()}>Tentar de novo</Botao>}
          />
        ) : (
          <Vazio titulo="Carregando" descricao="Abrindo a ficha do produto." />
        )}
      </SafeAreaView>
    )
  }

  const margem = calcularMargem(produto.precoCusto, produto.precoVenda)
  const nivel = nivelEstoque(produto)

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={produto.descricao}
        subtitulo={`Código ${produto.codigo}`}
        acao={
          <Botao
            variante="secundario"
            onPress={() => router.push({ pathname: '/produto-novo', params: { id: produto.id } })}
          >
            Editar
          </Botao>
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <View style={estilos.numeros}>
          <Numero rotulo="Venda" valor={formatMoney(produto.precoVenda)} />
          <Numero rotulo="Custo" valor={formatMoney(produto.precoCusto)} />
          <Numero rotulo="Margem" valor={margem === null ? '—' : formatPercent(margem)} />
        </View>

        <Cartao
          titulo="Estoque"
          acao={
            nivel === 'esgotado' ? (
              <Etiqueta tom="erro">Esgotado</Etiqueta>
            ) : nivel === 'baixo' ? (
              <Etiqueta tom="atencao">Abaixo do mínimo</Etiqueta>
            ) : (
              <Etiqueta tom="sucesso">Em dia</Etiqueta>
            )
          }
        >
          <Linha rotulo="Saldo" valor={`${produto.estoque} ${produto.unidade}`} />
          <Linha rotulo="Mínimo" valor={`${produto.estoqueMinimo} ${produto.unidade}`} />

          {ajustando ? (
            <View style={estilos.formulario}>
              <Campo
                rotulo="Quantas unidades há na prateleira"
                valor={contagem}
                onChange={(v) => setContagem(v.replace(/\D/g, ''))}
                tipoTeclado="numeric"
                dica={`Hoje o sistema diz ${produto.estoque}. A diferença vira um ajuste.`}
              />
              <Campo
                rotulo="Motivo"
                valor={motivo}
                onChange={setMotivo}
                placeholder="Ex.: contagem do mês, avaria"
              />
              {erroAjuste !== null ? <Text style={estilos.erro}>{erroAjuste}</Text> : null}
              <View style={estilos.acoes}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={() => setAjustando(false)} largura>
                    Cancelar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao
                    onPress={() => void confirmarAjuste()}
                    carregando={enviando}
                    desabilitado={contagem === '' || motivo.trim().length < MOTIVO_MINIMO}
                    largura
                  >
                    Ajustar
                  </Botao>
                </View>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setAjustando(true)} accessibilityRole="button">
              <Text style={estilos.link}>Ajustar pela contagem</Text>
            </Pressable>
          )}
        </Cartao>

        <Cartao titulo="Cadastro">
          <Linha rotulo="Código de barras" valor={produto.ean ?? '—'} />
          <Linha rotulo="Categoria" valor={produto.categoria ?? '—'} />
          <Linha rotulo="Fornecedor" valor={produto.fornecedor ?? '—'} />
          <Linha rotulo="NCM" valor={produto.ncm ?? 'falta para a nota'} />
          <Linha rotulo="CFOP" valor={produto.cfop ?? '—'} />
          <Linha rotulo="CSOSN" valor={produto.cst ?? '—'} />
        </Cartao>

        <Cartao titulo="Movimentações">
          {movimentos.length === 0 ? (
            <Text style={estilos.apoio}>Nenhuma movimentação ainda.</Text>
          ) : (
            movimentos.map((m) => (
              <View key={m.id} style={estilos.movimento}>
                <View style={estilos.flex}>
                  <Text style={estilos.movimentoTitulo}>
                    {ROTULO_DA_CAUSA[m.causa] ?? m.causa}
                    {m.motivo ? ` · ${m.motivo}` : ''}
                  </Text>
                  <Text style={estilos.apoio}>
                    {formatDateTime(m.quando)} · saldo {m.saldoDepois}
                  </Text>
                </View>
                <Text
                  style={[estilos.delta, m.delta < 0 ? estilos.deltaSaida : estilos.deltaEntrada]}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </Text>
              </View>
            ))
          )}
        </Cartao>
      </ScrollView>
    </SafeAreaView>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={estilos.numero}>
      <Text style={estilos.numeroRotulo}>{rotulo}</Text>
      <Text style={estilos.numeroValor}>{valor}</Text>
    </View>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={estilos.linha}>
      <Text style={[estilos.apoio, estilos.flex]}>{rotulo}</Text>
      <Text style={estilos.linhaValor}>{valor}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1 },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  numeros: { flexDirection: 'row', gap: espaco.sm },
  numero: {
    flex: 1,
    gap: 2,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  numeroRotulo: { fontSize: 11, color: cores.textoFraco },
  numeroValor: { fontSize: fonte.pequeno, fontWeight: peso.pesado, color: cores.texto },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: 4 },
  linhaValor: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  formulario: { gap: espaco.sm },
  acoes: { flexDirection: 'row', gap: espaco.sm },
  movimento: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: 6 },
  movimentoTitulo: { fontSize: fonte.pequeno, color: cores.texto },
  delta: { fontSize: fonte.corpo, fontWeight: peso.pesado },
  deltaEntrada: { color: cores.sucesso },
  deltaSaida: { color: cores.erro },
})
