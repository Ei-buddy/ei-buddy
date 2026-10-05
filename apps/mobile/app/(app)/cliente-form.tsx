import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import {
  atualizarCliente,
  buscarCliente,
  salvarCliente,
  type CandidatoCliente,
  type DadosCliente,
  type EnderecoDoCliente,
} from '@/lib/clientes-api'
import { buscarCep, buscarCnpj } from '@/lib/empresa-api'
import {
  isValidCNPJ,
  isValidCPF,
  maskCEP,
  maskCNPJ,
  maskCPF,
  maskPhone,
  validateEmail,
} from '@/lib/validation'
import { cores, espaco, fonte, peso } from '@/theme/tokens'

const ENDERECO_VAZIO: EnderecoDoCliente = {
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
}

/** CPF ate 11 digitos, CNPJ dali para cima — o mesmo campo serve aos dois. */
const mascaraDoDocumento = (v: string) =>
  v.replace(/\D/g, '').length <= 11 ? maskCPF(v) : maskCNPJ(v)

/**
 * Cadastro e edicao de cliente — RF-008, RF-010, os mesmos campos do web.
 *
 * Com `id` na rota, edita; sem, cadastra. CNPJ completo busca razao social e
 * endereco na Receita; CEP completo preenche o endereco. Se o servidor achar
 * alguem parecido (mesmo documento ou telefone), mostra quem e e deixa a
 * pessoa decidir.
 */
export default function ClienteFormScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const editando = typeof id === 'string' && id !== ''

  const [documento, setDocumento] = useState('')
  const [nome, setNome] = useState('')
  const [nomeFantasia, setNomeFantasia] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [limiteFiado, setLimiteFiado] = useState('')
  const [endereco, setEndereco] = useState<EnderecoDoCliente>(ENDERECO_VAZIO)
  const [carregando, setCarregando] = useState(editando)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [duplicados, setDuplicados] = useState<CandidatoCliente[] | null>(null)

  const digitosDoc = documento.replace(/\D/g, '')
  const pj = digitosDoc.length > 11

  useEffect(() => {
    if (!editando) return
    let cancelado = false
    void (async () => {
      const r = await buscarCliente(id)
      if (cancelado) return
      setCarregando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      const c = r.dados
      setDocumento(c.documento ? mascaraDoDocumento(c.documento) : '')
      setNome(c.nome)
      setNomeFantasia(c.nomeFantasia ?? '')
      setTelefone(c.telefone ? maskPhone(c.telefone) : '')
      setEmail(c.email ?? '')
      setLimiteFiado(c.limiteFiado > 0 ? c.limiteFiado.toFixed(2).replace('.', ',') : '')
      setEndereco({ ...c.endereco, cep: maskCEP(c.endereco.cep) })
    })()
    return () => {
      cancelado = true
    }
  }, [editando, id])

  const mudarEndereco = (campo: keyof EnderecoDoCliente) => (valor: string) =>
    setEndereco((e) => ({ ...e, [campo]: valor }))

  async function mudarCep(valor: string) {
    const cep = maskCEP(valor)
    setEndereco((e) => ({ ...e, cep }))
    if (cep.replace(/\D/g, '').length !== 8) return
    const r = await buscarCep(cep)
    if (!r.ok) return
    /* So preenche o que veio: CEP de cidade inteira nao tem rua, e apagar a rua
       que a pessoa ja digitou seria pior que nao ajudar. */
    setEndereco((e) => ({
      ...e,
      logradouro: r.dados.logradouro || e.logradouro,
      bairro: r.dados.bairro || e.bairro,
      cidade: r.dados.cidade || e.cidade,
      uf: r.dados.uf || e.uf,
    }))
  }

  async function preencherPeloCnpj() {
    setBuscandoCnpj(true)
    const r = await buscarCnpj(documento)
    setBuscandoCnpj(false)
    if (!r.ok) {
      Alert.alert('Não deu para buscar', r.erro)
      return
    }
    setNome(r.dados.razaoSocial)
    setNomeFantasia(r.dados.nomeFantasia)
    setEndereco((e) => ({
      ...e,
      cep: maskCEP(r.dados.cep),
      logradouro: r.dados.logradouro,
      numero: r.dados.numero,
      bairro: r.dados.bairro,
      cidade: r.dados.cidade,
      uf: r.dados.uf,
    }))
  }

  function validar(): string | null {
    if (nome.trim().length < 2) return 'Informe o nome do cliente.'
    if (digitosDoc !== '') {
      const valido =
        digitosDoc.length === 11
          ? isValidCPF(digitosDoc)
          : digitosDoc.length === 14
            ? isValidCNPJ(digitosDoc)
            : false
      if (!valido) return pj ? 'CNPJ inválido.' : 'CPF inválido.'
    }
    if (email.trim() !== '' && validateEmail(email) !== null) return 'E-mail inválido.'
    return null
  }

  async function salvar(permitirDuplicado = false) {
    const problema = validar()
    if (problema !== null) {
      setErro(problema)
      return
    }

    setErro(null)
    setSalvando(true)
    const dados: DadosCliente = {
      documento,
      nome,
      nomeFantasia,
      telefone,
      email,
      limiteFiado,
      endereco,
    }
    const r = editando
      ? await atualizarCliente(id, dados)
      : await salvarCliente(dados, { permitirDuplicado })
    setSalvando(false)

    if (!r.ok) {
      if ('duplicados' in r) setDuplicados(r.duplicados)
      else setErro(r.erro)
      return
    }

    if (editando) router.back()
    else router.replace({ pathname: '/cliente', params: { id: r.id } })
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo={editando ? 'Editar cliente' : 'Novo cliente'} />

      <KeyboardAvoidingView
        style={estilos.tela}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          {carregando ? <Text style={estilos.apoio}>Carregando o cadastro...</Text> : null}

          <Campo
            rotulo="CPF ou CNPJ"
            valor={documento}
            onChange={(v) => setDocumento(mascaraDoDocumento(v))}
            tipoTeclado="numeric"
            placeholder="Opcional"
            dica="Sem documento, o cliente pode comprar; só a nota sai sem CPF."
          />
          {digitosDoc.length === 14 ? (
            <Botao
              variante="secundario"
              onPress={() => void preencherPeloCnpj()}
              carregando={buscandoCnpj}
            >
              Preencher pela Receita
            </Botao>
          ) : null}

          <Campo
            rotulo={pj ? 'Razão social' : 'Nome'}
            valor={nome}
            onChange={setNome}
            autoCap="words"
          />
          {pj ? (
            <Campo
              rotulo="Nome fantasia"
              valor={nomeFantasia}
              onChange={setNomeFantasia}
              autoCap="words"
            />
          ) : null}
          <Campo
            rotulo="Celular com DDD"
            valor={telefone}
            onChange={(v) => setTelefone(maskPhone(v))}
            tipoTeclado="phone-pad"
            placeholder="(41) 99876-5432"
          />
          <Campo
            rotulo="E-mail"
            valor={email}
            onChange={setEmail}
            tipoTeclado="email-address"
            autoCap="none"
          />
          <Campo
            rotulo="Limite do fiado (R$)"
            valor={limiteFiado}
            onChange={setLimiteFiado}
            tipoTeclado="decimal-pad"
            placeholder="0,00"
            dica="Vazio = sem fiado. Acima disso, o PDV recusa vender na carteira."
          />

          <Text style={estilos.secao}>Endereço</Text>
          <Campo
            rotulo="CEP"
            valor={endereco.cep}
            onChange={(v) => void mudarCep(v)}
            tipoTeclado="numeric"
          />
          <Campo rotulo="Rua" valor={endereco.logradouro} onChange={mudarEndereco('logradouro')} />
          <View style={estilos.linha}>
            <View style={estilos.estreito}>
              <Campo rotulo="Número" valor={endereco.numero} onChange={mudarEndereco('numero')} />
            </View>
            <View style={estilos.largo}>
              <Campo
                rotulo="Complemento"
                valor={endereco.complemento}
                onChange={mudarEndereco('complemento')}
              />
            </View>
          </View>
          <Campo rotulo="Bairro" valor={endereco.bairro} onChange={mudarEndereco('bairro')} />
          <View style={estilos.linha}>
            <View style={estilos.largo}>
              <Campo rotulo="Cidade" valor={endereco.cidade} onChange={mudarEndereco('cidade')} />
            </View>
            <View style={estilos.estreito}>
              <Campo
                rotulo="UF"
                valor={endereco.uf}
                onChange={(v) => mudarEndereco('uf')(v.toUpperCase().slice(0, 2))}
                autoCap="characters"
              />
            </View>
          </View>

          {duplicados !== null ? (
            <View style={estilos.duplicados}>
              <Text style={estilos.duplicadosTitulo}>Parece que este cliente já existe</Text>
              {duplicados.map((c) => (
                <Botao
                  key={c.id}
                  variante="secundario"
                  onPress={() => router.replace({ pathname: '/cliente', params: { id: c.id } })}
                  largura
                >
                  {`${c.name}${c.phone ? ` · ${maskPhone(c.phone)}` : ''}`}
                </Botao>
              ))}
              <Botao onPress={() => void salvar(true)} carregando={salvando} largura>
                Cadastrar mesmo assim
              </Botao>
            </View>
          ) : null}

          {erro !== null ? (
            <Text style={estilos.erro} accessibilityRole="alert">
              {erro}
            </Text>
          ) : null}

          <View style={estilos.linha}>
            <View style={estilos.largo}>
              <Botao variante="secundario" onPress={() => router.back()} largura>
                Voltar
              </Botao>
            </View>
            <View style={estilos.largo}>
              <Botao
                onPress={() => void salvar()}
                carregando={salvando}
                desabilitado={carregando}
                largura
              >
                {editando ? 'Salvar' : 'Cadastrar'}
              </Botao>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  secao: {
    marginTop: espaco.sm,
    fontSize: fonte.corpo,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  linha: { flexDirection: 'row', gap: espaco.md },
  estreito: { flex: 1 },
  largo: { flex: 2 },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  duplicados: {
    gap: espaco.sm,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.atencao,
    borderRadius: 12,
    backgroundColor: cores.atencaoFundo,
  },
  duplicadosTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.atencao },
})
