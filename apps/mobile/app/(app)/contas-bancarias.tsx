import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  cadastrarContaBancaria,
  editarContaBancaria,
  excluirContaBancaria,
  listarContasBancarias,
  type ContaBancaria,
} from '@/lib/contas-bancarias-api'
import { NOMES_BANCOS } from '@/lib/financeiro-api'
import { dataDoTexto, formatDate, formatMoney, hoje, mascaraData } from '@/lib/format'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Contas bancarias — RF-073, a mesma tela do web.
 *
 * Onde o dinheiro da loja esta. O saldo e o inicial mais as baixas lancadas
 * em cada conta; cadastrar a conta com o saldo de hoje faz as baixas passarem
 * a dizer em qual conta o dinheiro entrou ou saiu.
 */
export default function ContasBancarias() {
  const [contas, setContas] = useState<ContaBancaria[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const [nome, setNome] = useState('')
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [numero, setNumero] = useState('')
  const [saldo, setSaldo] = useState('')
  const [data, setData] = useState(formatDate(hoje()))
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  /* Editar usa o mesmo formulario do cadastro — NR-152. */
  const [editando, setEditando] = useState<ContaBancaria | null>(null)

  const carregar = useCallback(async () => {
    const r = await listarContasBancarias()
    if (r.ok) {
      setContas(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function cadastrar() {
    if (nome.trim().length < 2) {
      setErroForm('Dê um nome à conta, ex.: "Nubank PJ".')
      return
    }
    /* Saldo vazio e zero; negativo e permitido (cheque especial). */
    const texto = saldo.trim()
    const negativo = texto.startsWith('-')
    const cents = texto === '' ? 0 : centavosDoTexto(texto.replace(/^-/, ''))
    if (cents === null) {
      setErroForm('Saldo inicial inválido.')
      return
    }
    const abertura = dataDoTexto(data)
    if (abertura === null) {
      setErroForm('Data do saldo inválida.')
      return
    }

    setSalvando(true)
    setErroForm(null)
    const dados = {
      name: nome.trim(),
      ...(banco.trim() ? { bank: banco.trim() } : {}),
      ...(agencia.trim() ? { agency: agencia.trim() } : {}),
      ...(numero.trim() ? { accountNumber: numero.trim() } : {}),
      openingBalanceCents: negativo ? -cents : cents,
      openingDate: abertura,
    }
    const r =
      editando === null
        ? await cadastrarContaBancaria(dados)
        : await editarContaBancaria(editando.id, dados)
    setSalvando(false)
    if (!r.ok) {
      setErroForm(r.erro)
      return
    }
    fecharFormulario()
    void carregar()
  }

  function fecharFormulario() {
    setCadastrando(false)
    setEditando(null)
    setErroForm(null)
    setNome('')
    setBanco('')
    setAgencia('')
    setNumero('')
    setSaldo('')
    setData(formatDate(hoje()))
  }

  function editar(conta: ContaBancaria) {
    setEditando(conta)
    setNome(conta.name)
    setBanco(conta.bank ?? '')
    setAgencia(conta.agency ?? '')
    setNumero(conta.accountNumber ?? '')
    setSaldo((conta.openingBalanceCents / 100).toFixed(2).replace('.', ','))
    setData(formatDate(conta.openingDate))
    setErroForm(null)
    setCadastrando(true)
  }

  function excluir(conta: ContaBancaria) {
    Alert.alert(
      `Excluir ${conta.name}?`,
      'As baixas já lançadas nesta conta continuam como estão.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              const r = await excluirContaBancaria(conta.id)
              if (!r.ok) Alert.alert('Não deu para excluir', r.erro)
              else void carregar()
            })(),
        },
      ],
    )
  }

  const total = (contas ?? []).reduce((acc, c) => acc + c.balanceCents, 0)

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Contas bancárias"
        subtitulo={
          contas && contas.length > 0 ? `Saldo total ${formatMoney(total / 100)}` : undefined
        }
        acao={cadastrando ? undefined : <Botao onPress={() => setCadastrando(true)}>Nova</Botao>}
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {cadastrando ? (
          <Cartao titulo={editando === null ? 'Nova conta' : `Editar ${editando.name}`}>
            <View style={estilos.formulario}>
              <Campo rotulo="Nome" valor={nome} onChange={setNome} placeholder="Nubank PJ" />
              <Campo rotulo="Banco" valor={banco} onChange={setBanco} />
              <View style={estilos.chips}>
                {NOMES_BANCOS.filter(
                  (b) => b !== banco && b.toLowerCase().includes(banco.trim().toLowerCase()),
                )
                  .slice(0, 6)
                  .map((b) => (
                    <Pressable key={b} onPress={() => setBanco(b)} style={estilos.chip}>
                      <Text style={estilos.chipTexto}>{b}</Text>
                    </Pressable>
                  ))}
              </View>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Agência"
                    valor={agencia}
                    onChange={setAgencia}
                    tipoTeclado="numeric"
                  />
                </View>
                <View style={estilos.flex}>
                  <Campo rotulo="Conta" valor={numero} onChange={setNumero} tipoTeclado="numeric" />
                </View>
              </View>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Saldo de hoje (R$)"
                    valor={saldo}
                    onChange={setSaldo}
                    tipoTeclado="default"
                    placeholder="0,00"
                  />
                </View>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Em"
                    valor={data}
                    onChange={(v) => setData(mascaraData(v))}
                    tipoTeclado="numeric"
                    placeholder="DD/MM/AAAA"
                  />
                </View>
              </View>
              {erroForm !== null ? <Text style={estilos.erro}>{erroForm}</Text> : null}
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={fecharFormulario} largura>
                    Cancelar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao onPress={() => void cadastrar()} carregando={salvando} largura>
                    {editando === null ? 'Cadastrar' : 'Salvar'}
                  </Botao>
                </View>
              </View>
            </View>
          </Cartao>
        ) : null}

        {erro !== null ? (
          <Vazio
            titulo="Não deu para carregar"
            descricao={erro}
            acao={<Botao onPress={() => void carregar()}>Tentar de novo</Botao>}
          />
        ) : contas === null ? (
          <Vazio titulo="Carregando" descricao="Buscando as contas da loja." />
        ) : contas.length === 0 ? (
          <Vazio
            titulo="Nenhuma conta cadastrada"
            descricao="Cadastre a conta da loja com o saldo de hoje, e as baixas passam a dizer em qual conta o dinheiro entrou ou saiu."
          />
        ) : (
          contas.map((c) => (
            <View key={c.id} style={estilos.conta}>
              <View style={estilos.flex}>
                <Text style={estilos.contaNome}>{c.name}</Text>
                <Text style={estilos.apoio}>
                  {[
                    c.bank,
                    c.agency && `ag. ${c.agency}`,
                    c.accountNumber && `cc ${c.accountNumber}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'sem dados bancários'}
                </Text>
                <Text style={estilos.apoio}>
                  Inicial {formatMoney(c.openingBalanceCents / 100)} em {formatDate(c.openingDate)}
                </Text>
              </View>
              <View style={estilos.contaDireita}>
                <Text style={[estilos.saldo, c.balanceCents < 0 && estilos.negativo]}>
                  {formatMoney(c.balanceCents / 100)}
                </Text>
                <View style={estilos.acoesConta}>
                  <Pressable onPress={() => editar(c)} accessibilityRole="button" hitSlop={8}>
                    <Text style={estilos.editar}>Editar</Text>
                  </Pressable>
                  <Pressable onPress={() => excluir(c)} accessibilityRole="button" hitSlop={8}>
                    <Text style={estilos.excluir}>Excluir</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1 },
  formulario: { gap: espaco.md },
  linha: { flexDirection: 'row', gap: espaco.md },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: -espaco.xs },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.xs,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  conta: {
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  contaNome: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  contaDireita: { alignItems: 'flex-end', justifyContent: 'space-between' },
  saldo: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.texto },
  negativo: { color: cores.erro },
  excluir: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
  editar: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
  acoesConta: { flexDirection: 'row', gap: espaco.md },
})
