import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  baixarTitulo,
  exportarTitulos,
  type DadosDaBaixa,
  listarContasPagar,
  listarContasReceber,
  situacaoDoTitulo,
  ROTULO_SITUACAO,
  type Titulo,
} from '@/lib/financeiro-api'
import { daysUntil, describeDueDate, formatDate, formatMoney } from '@/lib/format'
import Cabecalho from '@/components/Cabecalho'
import BaixaModal from '@/components/BaixaModal'
import CorrecaoTituloModal from '@/components/CorrecaoTituloModal'
import EstornoModal from '@/components/EstornoModal'
import NovoTituloModal from '@/components/NovoTituloModal'
import Botao from '@/components/ui/Botao'
import Sanfona from '@/components/ui/Sanfona'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Forma comum entre conta a pagar e a receber — vem pronta de `financeiro-api`.
 *
 * As duas telas sao a mesma estrutura com a contraparte trocada, e o mapeamento
 * mora num lugar so: fazer aqui obrigaria esta tela a conhecer o formato das
 * DUAS respostas da api, e a divergir da proxima tela que ler as mesmas listas.
 */
type Linha = Titulo

/**
 * Contas a pagar / a receber.
 *
 * As duas telas sao a mesma estrutura — muda a contraparte e o verbo —
 * entao compartilham este componente, como no web.
 *
 * Agrupado em sanfonas por situacao: no celular, uma lista corrida de
 * titulos mistura o que vence hoje com o que ja foi pago. Vencidos ficam
 * abertos por padrao, que e o que exige acao.
 */
export default function ContasView({ tipo }: { tipo: 'pagar' | 'receber' }) {
  const pagar = tipo === 'pagar'

  /*
   * Comeca VAZIO e busca no servidor.
   *
   * A tela lia `lib/mock-data`: as mesmas contas de exemplo para qualquer
   * loja, com o total no cabecalho somando dinheiro que nao existia. O lojista
   * abria "Contas a pagar" e via o vencimento de outra empresa.
   */
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const buscar = useCallback(async () => {
    const r = await (pagar ? listarContasPagar() : listarContasReceber())
    setCarregando(false)
    setAtualizando(false)

    if (!r.ok) {
      setErro(r.message)
      return
    }

    setErro(null)
    setLinhas(r.dados.titulos)
  }, [pagar])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await buscar()
    })()
  }, [buscar])

  /*
   * Baixa e estorno acontecem AQUI agora — NR-081.
   *
   * O `aviso` e a resposta curta que a tela da depois: nao ha `Toast` no
   * mobile, e um `Alert` de sucesso obriga a pessoa a tocar em "ok" para voltar
   * a ver a lista que acabou de mudar. Uma faixa que aparece e sai sozinha
   * mostra o resultado sem interromper.
   */
  const [baixando, setBaixando] = useState<Linha | null>(null)
  const [estornando, setEstornando] = useState<Linha | null>(null)
  const [mudando, setMudando] = useState<{ linha: Linha; modo: 'corrigir' | 'cancelar' } | null>(
    null,
  )
  const [processando, setProcessando] = useState(false)
  const [erroDoDialogo, setErroDoDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [lancando, setLancando] = useState(false)
  const [busca, setBusca] = useState('')
  const [exportando, setExportando] = useState(false)

  async function exportar(formato: 'csv' | 'pdf') {
    setExportando(true)
    const r = await exportarTitulos(tipo, formato)
    setExportando(false)
    if (!r.ok) Alert.alert('Não deu para exportar', r.erro)
  }

  useEffect(() => {
    if (aviso === null) return

    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const grupos = useMemo(() => {
    /* Busca por contraparte ou descricao — o filtro que o web tem no topo. */
    const termo = busca.trim().toLowerCase()
    const visiveis =
      termo === ''
        ? linhas
        : linhas.filter(
            (l) =>
              l.contraparte.toLowerCase().includes(termo) ||
              l.descricao.toLowerCase().includes(termo),
          )
    const abertos = visiveis.filter((l) => l.status !== 'pago')
    return {
      vencidos: abertos.filter((l) => daysUntil(l.vencimento) < 0),
      aVencer: abertos.filter((l) => daysUntil(l.vencimento) >= 0),
      quitados: visiveis.filter((l) => l.status === 'pago'),
    }
  }, [linhas, busca])

  const soma = (lista: Linha[]) => lista.reduce((a, l) => a + (l.valorCents - l.baixadoCents), 0)

  /**
   * Confirma a baixa contra a api — RF-059, RF-066.
   *
   * A lista RECARREGA em vez de ser remendada na memoria: quem decide o novo
   * saldo e o novo status e `core`, com o titulo lido dentro da transacao. Se
   * outra pessoa baixou o mesmo titulo enquanto esta folha estava aberta, um
   * remendo local mostraria um saldo que nao existe — e no celular a tela fica
   * aberta por muito mais tempo que no computador.
   */
  async function confirmarBaixa(dados: DadosDaBaixa) {
    if (baixando === null) return

    setProcessando(true)
    setErroDoDialogo(null)

    const r = await baixarTitulo(tipo, baixando.id, dados)
    setProcessando(false)

    if (!r.ok) {
      /* O erro fica DENTRO da folha: valor acima do saldo e conta em branco sao
         coisas que a pessoa corrige ali. Fechar a obrigaria a preencher tudo de
         novo, com o teclado no caminho. */
      setErroDoDialogo(r.message)
      return
    }

    const quitou = baixando.baixadoCents + r.dados.amountCents >= baixando.valorCents

    setBaixando(null)
    setAviso(
      quitou
        ? `Título quitado: ${formatMoney(r.dados.amountCents / 100)}.`
        : `Baixa parcial de ${formatMoney(r.dados.amountCents / 100)} registrada.`,
    )

    await buscar()
  }

  const totalAberto = soma([...grupos.vencidos, ...grupos.aVencer])

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={pagar ? 'Contas a pagar' : 'Contas a receber'}
        subtitulo={`${formatMoney(totalAberto / 100)} em aberto`}
        acao={<Botao onPress={() => setLancando(true)}>Lançar</Botao>}
      />

      <ScrollView
        contentContainerStyle={estilos.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true)
              void buscar()
            }}
          />
        }
      >
        <View style={estilos.ferramentas}>
          <TextInput
            style={estilos.busca}
            value={busca}
            onChangeText={setBusca}
            placeholder={pagar ? 'Fornecedor ou descrição' : 'Cliente ou descrição'}
            placeholderTextColor={cores.textoFraco}
            accessibilityLabel="Buscar título"
          />
          <Pressable
            style={estilos.exportar}
            onPress={() => void exportar('csv')}
            disabled={exportando}
            accessibilityRole="button"
            accessibilityLabel="Exportar CSV"
          >
            <Text style={estilos.exportarTexto}>CSV</Text>
          </Pressable>
          <Pressable
            style={estilos.exportar}
            onPress={() => void exportar('pdf')}
            disabled={exportando}
            accessibilityRole="button"
            accessibilityLabel="Exportar PDF"
          >
            <Text style={estilos.exportarTexto}>PDF</Text>
          </Pressable>
        </View>

        {carregando ? (
          <Vazio titulo="Carregando" descricao="Buscando os títulos da loja." />
        ) : erro !== null ? (
          <Vazio
            titulo="Não foi possível carregar"
            /* Puxar para atualizar continua valendo: no balcao o sinal cai, e
               o caminho de tentar de novo tem de estar a mao. */
            descricao={`${erro} Puxe para baixo para tentar de novo.`}
          />
        ) : linhas.length === 0 ? (
          <Vazio
            titulo={pagar ? 'Nenhuma conta a pagar' : 'Nenhuma conta a receber'}
            descricao="Toque em Lançar para registrar o primeiro."
          />
        ) : (
          <>
            <Sanfona
              titulo="Vencidos"
              resumo={
                grupos.vencidos.length
                  ? `${grupos.vencidos.length} · ${formatMoney(soma(grupos.vencidos) / 100)}`
                  : 'nada em atraso'
              }
              etiqueta={
                grupos.vencidos.length > 0 ? (
                  <Etiqueta tom="atencao">{grupos.vencidos.length}</Etiqueta>
                ) : undefined
              }
              /* Abre sozinho: e o grupo que pede acao. */
              inicialAberta={grupos.vencidos.length > 0}
            >
              {grupos.vencidos.length === 0 ? (
                <Text style={estilos.vazioTexto}>Nada em atraso.</Text>
              ) : (
                grupos.vencidos.map((l) => (
                  <LinhaTitulo
                    key={l.id}
                    linha={l}
                    onBaixar={() => {
                      setErroDoDialogo(null)
                      setBaixando(l)
                    }}
                    onEstornar={() => setEstornando(l)}
                    onCorrigir={() => setMudando({ linha: l, modo: 'corrigir' })}
                    onCancelar={() => setMudando({ linha: l, modo: 'cancelar' })}
                  />
                ))
              )}
            </Sanfona>

            <Sanfona
              titulo="A vencer"
              resumo={`${grupos.aVencer.length} · ${formatMoney(soma(grupos.aVencer) / 100)}`}
              inicialAberta={grupos.vencidos.length === 0}
            >
              {grupos.aVencer.length === 0 ? (
                <Text style={estilos.vazioTexto}>Nada a vencer.</Text>
              ) : (
                grupos.aVencer.map((l) => (
                  <LinhaTitulo
                    key={l.id}
                    linha={l}
                    onBaixar={() => {
                      setErroDoDialogo(null)
                      setBaixando(l)
                    }}
                    onEstornar={() => setEstornando(l)}
                    onCorrigir={() => setMudando({ linha: l, modo: 'corrigir' })}
                    onCancelar={() => setMudando({ linha: l, modo: 'cancelar' })}
                  />
                ))
              )}
            </Sanfona>

            <Sanfona
              titulo={pagar ? 'Pagos' : 'Recebidos'}
              resumo={`${grupos.quitados.length} título(s)`}
            >
              {grupos.quitados.length === 0 ? (
                <Text style={estilos.vazioTexto}>Nada baixado ainda.</Text>
              ) : (
                grupos.quitados.map((l) => (
                  <LinhaTitulo
                    key={l.id}
                    linha={l}
                    onBaixar={() => {
                      setErroDoDialogo(null)
                      setBaixando(l)
                    }}
                    onEstornar={() => setEstornando(l)}
                    onCorrigir={() => setMudando({ linha: l, modo: 'corrigir' })}
                    onCancelar={() => setMudando({ linha: l, modo: 'cancelar' })}
                  />
                ))
              )}
            </Sanfona>
          </>
        )}
      </ScrollView>

      {/* A faixa de resposta. Sai sozinha em 4s — no balcao ninguem toca em
          "ok" para poder voltar a olhar a lista. */}
      {aviso !== null ? (
        <View style={estilos.aviso} accessibilityLiveRegion="polite">
          <Text style={estilos.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}

      {lancando ? (
        <NovoTituloModal
          tipo={tipo}
          /* Os fornecedores que a loja ja usou, para "Copel" nao virar "copel". */
          contrapartesConhecidas={[...new Set(linhas.map((l) => l.contraparte))]}
          onSalvo={(msg) => {
            setLancando(false)
            setAviso(msg)
            void buscar()
          }}
          onFechar={() => setLancando(false)}
        />
      ) : null}

      {baixando !== null ? (
        <BaixaModal
          tipo={tipo}
          contraparte={baixando.contraparte}
          descricao={`${baixando.descricao} · vence ${formatDate(baixando.vencimento)}`}
          saldoCents={baixando.valorCents - baixando.baixadoCents}
          processando={processando}
          erro={erroDoDialogo}
          onConfirmar={confirmarBaixa}
          onFechar={() => {
            setBaixando(null)
            setErroDoDialogo(null)
          }}
        />
      ) : null}

      {mudando !== null ? (
        <CorrecaoTituloModal
          tipo={tipo}
          modo={mudando.modo}
          titulo={mudando.linha}
          onFeito={(msg) => {
            setMudando(null)
            setAviso(msg)
            void buscar()
          }}
          onFechar={() => setMudando(null)}
        />
      ) : null}

      {estornando !== null ? (
        <EstornoModal
          tipo={tipo}
          tituloId={estornando.id}
          contraparte={estornando.contraparte}
          descricao={`${estornando.descricao} · vence ${formatDate(estornando.vencimento)}`}
          onEstornado={(msg) => {
            setEstornando(null)
            setAviso(msg)
            void buscar()
          }}
          onFechar={() => setEstornando(null)}
        />
      ) : null}
    </SafeAreaView>
  )
}

function LinhaTitulo({
  linha,
  onBaixar,
  onEstornar,
  onCorrigir,
  onCancelar,
}: {
  linha: Linha
  onBaixar: () => void
  onEstornar: () => void
  onCorrigir: () => void
  onCancelar: () => void
}) {
  const saldoCents = linha.valorCents - linha.baixadoCents
  const quitado = linha.status === 'pago'
  const situacao = situacaoDoTitulo(linha.status, linha.vencimento, daysUntil(linha.vencimento))

  const tom =
    situacao === 'vencido'
      ? 'erro'
      : situacao === 'aVencer'
        ? 'atencao'
        : situacao === 'quitado'
          ? 'sucesso'
          : 'neutro'

  return (
    <View style={estilos.titulo}>
      <View style={estilos.tituloTopo}>
        <View style={estilos.tituloInfo}>
          <Text style={estilos.tituloNome} numberOfLines={1}>
            {linha.contraparte}
          </Text>
          <Text style={estilos.tituloApoio} numberOfLines={1}>
            {linha.descricao}
          </Text>
        </View>
        <Text style={estilos.tituloValor}>
          {formatMoney((quitado ? linha.valorCents : saldoCents) / 100)}
        </Text>
      </View>

      <View style={estilos.tituloRodape}>
        <View style={estilos.tituloSituacao}>
          <Etiqueta tom={tom}>{ROTULO_SITUACAO[situacao]}</Etiqueta>
          <Text style={estilos.tituloData}>
            {quitado ? formatDate(linha.vencimento) : describeDueDate(linha.vencimento)}
          </Text>
        </View>

        <View style={estilos.acoes}>
          {linha.mutavel ? (
            <>
              <Pressable
                onPress={onCorrigir}
                style={[estilos.acao, estilos.acaoSecundaria]}
                accessibilityRole="button"
              >
                <Text style={[estilos.acaoTexto, estilos.acaoTextoSecundario]}>Corrigir</Text>
              </Pressable>
              <Pressable
                onPress={onCancelar}
                style={[estilos.acao, estilos.acaoSecundaria]}
                accessibilityRole="button"
              >
                <Text style={[estilos.acaoTexto, estilos.acaoTextoSecundario]}>Cancelar</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={quitado || linha.baixadoCents > 0 ? onEstornar : onBaixar}
            style={[estilos.acao, quitado && estilos.acaoSecundaria]}
            accessibilityRole="button"
          >
            <Text style={[estilos.acaoTexto, quitado && estilos.acaoTextoSecundario]}>
              {quitado || linha.baixadoCents > 0 ? 'Estornar' : 'Baixar'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  ferramentas: { flexDirection: 'row', gap: espaco.sm, alignItems: 'center' },
  busca: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
    backgroundColor: cores.campo,
    color: cores.texto,
    fontSize: fonte.pequeno,
  },
  exportar: {
    minHeight: 44,
    paddingHorizontal: espaco.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  exportarTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  vazioTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },

  titulo: {
    gap: espaco.md,
    paddingVertical: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  tituloTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  tituloInfo: { flex: 1, gap: 1 },
  tituloNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  tituloApoio: { fontSize: fonte.micro, color: cores.textoFraco },
  tituloValor: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },

  tituloRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
  },
  tituloSituacao: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: espaco.xs },
  tituloData: { fontSize: fonte.micro, color: cores.textoFraco },

  acao: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    backgroundColor: cores.acento,
    minHeight: 36,
    justifyContent: 'center',
  },
  acaoSecundaria: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: cores.borda,
  },
  acaoTexto: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoSobreAcento,
  },
  acaoTextoSecundario: { color: cores.textoFraco },

  aviso: {
    position: 'absolute',
    left: espaco.lg,
    right: espaco.lg,
    bottom: espaco.xl,
    padding: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.superficieAlta,
    borderWidth: 1,
    borderColor: cores.sucesso,
  },
  avisoTexto: { fontSize: fonte.pequeno, color: cores.texto },
})
