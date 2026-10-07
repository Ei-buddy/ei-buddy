import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { carregarPlano, criarConta, type ContaContabil } from '@/lib/contabilidade-api'
import { lancarContaAPagar, lancarContaAReceber } from '@/lib/financeiro-api'
import { dataDoTexto, formatDate, hoje, mascaraData } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { SeletorCliente } from '@/components/SeletoresDoPdv'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/**
 * Lancar conta a pagar ou a receber — RF-061, RF-064, o mesmo formulario do web.
 *
 * A pagar pede fornecedor e plano de conta (o DRE soma por ele); um nome de
 * conta que ainda nao existe vira conta de despesa nova. A receber aceita
 * cliente, opcional: recebivel avulso sem cliente e caminho normal.
 */
export default function NovoTituloModal({
  tipo,
  contrapartesConhecidas,
  onSalvo,
  onFechar,
}: {
  tipo: 'pagar' | 'receber'
  contrapartesConhecidas: string[]
  onSalvo: (mensagem: string) => void
  onFechar: () => void
}) {
  const pagar = tipo === 'pagar'
  const [fornecedor, setFornecedor] = useState('')
  const [plano, setPlano] = useState('')
  const [contas, setContas] = useState<ContaContabil[]>([])
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)
  const [escolhendoCliente, setEscolhendoCliente] = useState(false)
  const [vencimento, setVencimento] = useState(formatDate(hoje()))
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!pagar) return
    let cancelado = false
    void (async () => {
      const r = await carregarPlano()
      if (!cancelado && r.ok) {
        setContas(r.dados.accounts.filter((c) => c.type === 'cost' || c.type === 'expense'))
      }
    })()
    return () => {
      cancelado = true
    }
  }, [pagar])

  const centavos = centavosDoTexto(valor)
  const data = dataDoTexto(vencimento)

  function validar(): string | null {
    if (pagar && fornecedor.trim() === '') return 'Informe o fornecedor.'
    if (pagar && plano.trim() === '') return 'Escolha o plano de conta.'
    if (data === null) return 'Data de vencimento inválida.'
    if (centavos === null || centavos <= 0) return 'Informe um valor maior que zero.'
    if (descricao.trim() === '') return pagar ? 'Descreva o que é.' : 'Informe a que se refere.'
    return null
  }

  async function contaPeloNome(nome: string): Promise<string | null> {
    const existente = contas.find((c) => c.name.toLowerCase() === nome.trim().toLowerCase())
    if (existente) return existente.id
    const criada = await criarConta({ name: nome.trim(), type: 'expense' })
    return criada.ok ? criada.dados.id : null
  }

  async function salvar() {
    const problema = validar()
    if (problema !== null || data === null || centavos === null) {
      setErro(problema)
      return
    }
    setErro(null)
    setSalvando(true)

    if (pagar) {
      const contaId = await contaPeloNome(plano)
      if (contaId === null) {
        setSalvando(false)
        setErro('Não foi possível gravar o plano de conta. Tente de novo.')
        return
      }
      const r = await lancarContaAPagar({
        supplier: fornecedor.trim(),
        description: descricao.trim(),
        amountCents: centavos,
        dueDate: data,
        accountId: contaId,
      })
      setSalvando(false)
      if (!r.ok) {
        setErro(r.message)
        return
      }
      onSalvo('Conta a pagar lançada.')
      return
    }

    const r = await lancarContaAReceber({
      description: descricao.trim(),
      amountCents: centavos,
      dueDate: data,
      ...(cliente === null ? {} : { customerId: cliente.id }),
    })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    onSalvo('Conta a receber lançada.')
  }

  const termoFornecedor = fornecedor.trim().toLowerCase()
  const fornecedoresSugeridos = contrapartesConhecidas
    .filter((c) => c.toLowerCase() !== termoFornecedor && c.toLowerCase().includes(termoFornecedor))
    .slice(0, 5)

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
              {pagar ? 'Nova conta a pagar' : 'Nova conta a receber'}
            </Text>

            {pagar ? (
              <>
                <Campo rotulo="Fornecedor" valor={fornecedor} onChange={setFornecedor} />
                <Chips opcoes={fornecedoresSugeridos} onEscolher={setFornecedor} />

                <Campo
                  rotulo="Plano de conta"
                  valor={plano}
                  onChange={setPlano}
                  dica="Escolha uma das contas ou digite o nome de uma nova."
                />
                <Chips
                  opcoes={contas
                    .map((c) => c.name)
                    .filter((n) => n.toLowerCase().includes(plano.trim().toLowerCase()))
                    .slice(0, 8)}
                  atual={plano}
                  onEscolher={setPlano}
                />
              </>
            ) : (
              <Pressable
                style={estilos.cliente}
                onPress={() => setEscolhendoCliente(true)}
                accessibilityRole="button"
              >
                <Text style={estilos.rotulo}>Cliente (opcional)</Text>
                <Text style={estilos.clienteNome}>{cliente?.nome ?? 'Escolher cliente'}</Text>
              </Pressable>
            )}

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
                  placeholder="0,00"
                />
              </View>
            </View>

            <Campo
              rotulo={pagar ? 'Descrição' : 'Referente a'}
              valor={descricao}
              onChange={setDescricao}
              placeholder={pagar ? 'Ex.: aluguel de outubro' : 'Ex.: conserto do freezer'}
            />

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
                <Botao onPress={() => void salvar()} carregando={salvando} largura>
                  Lançar
                </Botao>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>

      {escolhendoCliente ? (
        <SeletorCliente
          onEscolher={(c) => {
            setCliente({ id: c.id, nome: c.nome })
            setEscolhendoCliente(false)
          }}
          onFechar={() => setEscolhendoCliente(false)}
        />
      ) : null}
    </Modal>
  )
}

function Chips({
  opcoes,
  atual,
  onEscolher,
}: {
  opcoes: string[]
  atual?: string
  onEscolher: (v: string) => void
}) {
  if (opcoes.length === 0) return null
  return (
    <View style={estilos.chips}>
      {opcoes.map((o) => (
        <Pressable
          key={o}
          onPress={() => onEscolher(o)}
          style={[estilos.chip, atual === o && estilos.chipAtivo]}
          accessibilityRole="button"
        >
          <Text style={[estilos.chipTexto, atual === o && estilos.chipTextoAtivo]}>{o}</Text>
        </Pressable>
      ))}
    </View>
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
  rotulo: { fontSize: fonte.pequeno, fontWeight: peso.medio, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  linha: { flexDirection: 'row', gap: espaco.md },
  flex: { flex: 1 },
  cliente: {
    gap: espaco.xs,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
  },
  clienteNome: { fontSize: fonte.corpo, color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: -espaco.xs },
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
