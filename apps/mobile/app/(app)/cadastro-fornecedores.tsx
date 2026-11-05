import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  type DadosDoFornecedor,
  documentoFormatado,
  excluirFornecedor,
  type FornecedorCadastrado,
  listarFornecedores,
  salvarFornecedor,
  telefoneFormatado,
} from '@/lib/cadastro-fornecedores-api'
import { buscarCep, buscarCnpj } from '@/lib/empresa-api'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

type Campos = {
  nome: string
  fantasia: string
  documento: string
  ie: string
  contato: string
  telefone: string
  email: string
  cep: string
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  observacao: string
  ativo: boolean
}

const VAZIO: Campos = {
  nome: '',
  fantasia: '',
  documento: '',
  ie: '',
  contato: '',
  telefone: '',
  email: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  observacao: '',
  ativo: true,
}

const digitos = (t: string) => t.replace(/\D/g, '')

const doFornecedor = (f: FornecedorCadastrado): Campos => ({
  nome: f.name,
  fantasia: f.tradeName ?? '',
  documento: documentoFormatado(f.document),
  ie: f.stateRegistration ?? '',
  contato: f.contactName ?? '',
  telefone: telefoneFormatado(f.phone),
  email: f.email ?? '',
  cep: f.address.zipCode ?? '',
  rua: f.address.street ?? '',
  numero: f.address.number ?? '',
  complemento: f.address.complement ?? '',
  bairro: f.address.district ?? '',
  cidade: f.address.city ?? '',
  uf: f.address.state ?? '',
  observacao: f.notes ?? '',
  ativo: f.isActive,
})

/** O mesmo do web: vazio nao vai no cadastro e vira `null` na edicao. */
function paraApi(c: Campos, editando: boolean): DadosDoFornecedor {
  const opcional = (v: string) => (v.trim() === '' ? (editando ? null : undefined) : v.trim())
  const endereco = Object.fromEntries(
    Object.entries({
      zipCode: digitos(c.cep),
      street: c.rua.trim(),
      number: c.numero.trim(),
      complement: c.complemento.trim(),
      district: c.bairro.trim(),
      city: c.cidade.trim(),
      state: c.uf.trim().toUpperCase(),
    }).filter(([, v]) => v !== ''),
  )
  const dados: DadosDoFornecedor = {
    name: c.nome.trim(),
    tradeName: opcional(c.fantasia),
    document: digitos(c.documento) === '' ? (editando ? null : undefined) : digitos(c.documento),
    stateRegistration: opcional(c.ie),
    contactName: opcional(c.contato),
    phone: digitos(c.telefone) === '' ? (editando ? null : undefined) : digitos(c.telefone),
    email: opcional(c.email),
    notes: opcional(c.observacao),
    ...(Object.keys(endereco).length > 0 || editando ? { address: endereco } : {}),
    ...(editando ? { isActive: c.ativo } : {}),
  }
  return Object.fromEntries(
    Object.entries(dados).filter(([, v]) => v !== undefined),
  ) as DadosDoFornecedor
}

/**
 * Cadastro de fornecedor — NR-191, o par da tela do web. So o nome e
 * obrigatorio; o CNPJ preenche o resto pela Receita.
 */
export default function CadastroFornecedores() {
  const [lista, setLista] = useState<FornecedorCadastrado[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [formAberto, setFormAberto] = useState(false)
  const [editando, setEditando] = useState<FornecedorCadastrado | null>(null)
  const [campos, setCampos] = useState<Campos>(VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)

  const carregar = useCallback(async (termo: string) => {
    const r = await listarFornecedores({ termo, incluirInativos: true })
    if (r.ok) {
      setLista(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        await carregar(busca)
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [busca, carregar])

  const set =
    <K extends keyof Campos>(k: K) =>
    (v: Campos[K]) =>
      setCampos((c) => ({ ...c, [k]: v }))

  function abrir(f: FornecedorCadastrado | null) {
    setEditando(f)
    setCampos(f === null ? VAZIO : doFornecedor(f))
    setErroForm(null)
    setFormAberto(true)
  }

  function fechar() {
    setFormAberto(false)
    setEditando(null)
    setCampos(VAZIO)
  }

  async function preencherPeloCnpj(silencioso: boolean) {
    if (digitos(campos.documento).length !== 14) {
      if (!silencioso) Alert.alert('CNPJ', 'Informe o CNPJ completo para buscar.')
      return
    }
    const r = await buscarCnpj(campos.documento)
    if (!r.ok) {
      if (!silencioso) Alert.alert('Não deu para buscar', r.erro)
      return
    }
    setCampos((c) => ({
      ...c,
      nome: r.dados.razaoSocial,
      fantasia: r.dados.nomeFantasia,
      cep: r.dados.cep,
      rua: r.dados.logradouro,
      numero: r.dados.numero,
      bairro: r.dados.bairro,
      cidade: r.dados.cidade,
      uf: r.dados.uf,
    }))
  }

  async function preencherPeloCep() {
    if (digitos(campos.cep).length !== 8) return
    const r = await buscarCep(campos.cep)
    if (!r.ok) return
    setCampos((c) => ({
      ...c,
      rua: r.dados.logradouro || c.rua,
      bairro: r.dados.bairro || c.bairro,
      cidade: r.dados.cidade || c.cidade,
      uf: r.dados.uf || c.uf,
    }))
  }

  async function salvar() {
    if (campos.nome.trim().length < 2) {
      setErroForm('Informe o nome do fornecedor.')
      return
    }
    setSalvando(true)
    const r = await salvarFornecedor(paraApi(campos, editando !== null), editando?.id)
    setSalvando(false)
    if (!r.ok) {
      setErroForm(r.erro)
      return
    }
    fechar()
    void carregar(busca)
  }

  function excluir(f: FornecedorCadastrado) {
    Alert.alert(`Excluir ${f.name}?`, 'As compras já lançadas continuam mostrando de quem foram.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const r = await excluirFornecedor(f.id)
            if (!r.ok) Alert.alert('Não deu para excluir', r.erro)
            else void carregar(busca)
          })(),
      },
    ])
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Fornecedores"
        acao={formAberto ? undefined : <Botao onPress={() => abrir(null)}>Novo</Botao>}
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {formAberto ? (
          <Cartao titulo={editando === null ? 'Novo fornecedor' : `Editar ${editando.name}`}>
            <View style={estilos.form}>
              <Campo
                rotulo="CNPJ ou CPF"
                valor={campos.documento}
                onChange={set('documento')}
                tipoTeclado="numeric"
                dica="O CNPJ busca razão social e endereço na Receita."
                aoSair={() => {
                  if (!editando && campos.nome.trim() === '') void preencherPeloCnpj(true)
                }}
              />
              <Campo
                rotulo="Razão social ou nome *"
                valor={campos.nome}
                onChange={set('nome')}
                autoCap="words"
              />
              <Campo rotulo="Nome fantasia" valor={campos.fantasia} onChange={set('fantasia')} />
              <Campo rotulo="Inscrição estadual" valor={campos.ie} onChange={set('ie')} />
              <Campo rotulo="Contato" valor={campos.contato} onChange={set('contato')} />
              <Campo
                rotulo="Telefone"
                valor={campos.telefone}
                onChange={set('telefone')}
                tipoTeclado="phone-pad"
              />
              <Campo
                rotulo="E-mail"
                valor={campos.email}
                onChange={set('email')}
                tipoTeclado="email-address"
                autoCap="none"
              />
              <Campo
                rotulo="CEP"
                valor={campos.cep}
                onChange={set('cep')}
                tipoTeclado="numeric"
                aoSair={() => void preencherPeloCep()}
              />
              <Campo rotulo="Rua" valor={campos.rua} onChange={set('rua')} />
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Campo rotulo="Número" valor={campos.numero} onChange={set('numero')} />
                </View>
                <View style={estilos.flex}>
                  <Campo
                    rotulo="Complemento"
                    valor={campos.complemento}
                    onChange={set('complemento')}
                  />
                </View>
              </View>
              <Campo rotulo="Bairro" valor={campos.bairro} onChange={set('bairro')} />
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Campo rotulo="Cidade" valor={campos.cidade} onChange={set('cidade')} />
                </View>
                <View style={estilos.uf}>
                  <Campo
                    rotulo="UF"
                    valor={campos.uf}
                    onChange={(v) => set('uf')(v.toUpperCase().slice(0, 2))}
                    autoCap="characters"
                  />
                </View>
              </View>
              <Campo rotulo="Observação" valor={campos.observacao} onChange={set('observacao')} />
              {editando !== null ? (
                <View style={estilos.ativo}>
                  <Text style={estilos.apoio}>Ativo</Text>
                  <Switch value={campos.ativo} onValueChange={set('ativo')} />
                </View>
              ) : null}
              {erroForm !== null ? <Text style={estilos.erro}>{erroForm}</Text> : null}
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={fechar} largura>
                    Cancelar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao onPress={() => void salvar()} carregando={salvando} largura>
                    {editando === null ? 'Cadastrar' : 'Salvar'}
                  </Botao>
                </View>
              </View>
            </View>
          </Cartao>
        ) : null}

        <Campo
          rotulo="Buscar"
          valor={busca}
          onChange={setBusca}
          placeholder="Nome, CNPJ ou telefone"
          autoCap="none"
        />

        {erro !== null ? (
          <Vazio titulo="Não deu para carregar" descricao={erro} />
        ) : lista === null ? (
          <Vazio titulo="Carregando" descricao="Buscando os fornecedores." />
        ) : lista.length === 0 ? (
          <Vazio
            titulo={busca ? 'Nenhum encontrado' : 'Nenhum fornecedor cadastrado'}
            descricao="Toque em Novo. Só o nome é obrigatório."
          />
        ) : (
          lista.map((f) => (
            <View key={f.id} style={estilos.item}>
              <View style={estilos.flex}>
                <Text style={estilos.nome}>
                  {f.tradeName ?? f.name}
                  {f.isActive ? '' : ' (inativo)'}
                </Text>
                <Text style={estilos.apoio} numberOfLines={2}>
                  {[
                    documentoFormatado(f.document) || null,
                    telefoneFormatado(f.phone) || null,
                    f.contactName,
                    f.address.city ? `${f.address.city}/${f.address.state ?? ''}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Só o nome cadastrado'}
                </Text>
              </View>
              <View style={estilos.acoes}>
                <Pressable onPress={() => abrir(f)} accessibilityRole="button" hitSlop={8}>
                  <Text style={estilos.editar}>Editar</Text>
                </Pressable>
                <Pressable onPress={() => excluir(f)} accessibilityRole="button" hitSlop={8}>
                  <Text style={estilos.excluir}>Excluir</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  form: { gap: espaco.md },
  linha: { flexDirection: 'row', gap: espaco.md },
  flex: { flex: 1 },
  uf: { width: 80 },
  ativo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  item: {
    ...vidro.peca,
    flexDirection: 'row',
    gap: espaco.md,
    padding: espaco.lg,
    borderRadius: raio.md,
  },
  nome: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  acoes: { gap: espaco.sm, alignItems: 'flex-end' },
  editar: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.texto },
  excluir: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.erro },
}))
