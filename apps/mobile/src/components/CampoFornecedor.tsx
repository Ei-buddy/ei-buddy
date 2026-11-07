import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import {
  type DadosDoFornecedor,
  documentoFormatado,
  type FornecedorCadastrado,
  listarFornecedores,
  nomeDoFornecedor,
  pareceDocumento,
  salvarFornecedor,
} from '@/lib/cadastro-fornecedores-api'
import { buscarCnpj, type DadosDoCnpj } from '@/lib/empresa-api'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

const digitos = (t: string) => t.replace(/\D/g, '')

/**
 * Campo de fornecedor ligado ao CADASTRO de fornecedores — o par do web.
 * Achado do QA: "assumir a busca no novo cadastro do fornecedor".
 *
 * Digitar busca no cadastro (nome, fantasia, CNPJ ou telefone); quem nao esta
 * la e cadastrado sem sair da tela, num formulario curto que ja vem com o que
 * foi digitado. O texto livre continua valendo, como na entrada de mercadoria.
 */
export default function CampoFornecedor({
  valor,
  onChange,
  rotulo = 'Fornecedor',
}: {
  valor: string
  /** `fornecedor` e `null` quando o nome foi digitado e nao escolhido. */
  onChange: (nome: string, fornecedor: FornecedorCadastrado | null) => void
  rotulo?: string
}) {
  const [achados, setAchados] = useState<FornecedorCadastrado[] | null>(null)
  /* O termo da busca aberta; `null` com a lista fechada. */
  const [buscando, setBuscando] = useState<string | null>(null)
  const [doCadastro, setDoCadastro] = useState<boolean | null>(null)
  const [cadastrando, setCadastrando] = useState<string | null>(null)

  useEffect(() => {
    if (buscando === null) return
    let cancelado = false
    const t = setTimeout(() => {
      void listarFornecedores({ termo: buscando }).then((r) => {
        if (!cancelado) setAchados(r.ok ? r.dados.slice(0, 6) : [])
      })
    }, 250)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [buscando])

  function escolher(f: FornecedorCadastrado) {
    setBuscando(null)
    setAchados(null)
    setDoCadastro(true)
    onChange(nomeDoFornecedor(f), f)
  }

  const limpo = valor.trim()
  const lista = buscando === null ? [] : (achados ?? [])
  const jaExiste = lista.some(
    (f) =>
      f.name.toLowerCase() === limpo.toLowerCase() ||
      (f.tradeName ?? '').toLowerCase() === limpo.toLowerCase(),
  )

  return (
    <View style={estilos.bloco}>
      <Campo
        rotulo={rotulo}
        valor={valor}
        onChange={(v) => {
          setDoCadastro(false)
          onChange(v, null)
          setBuscando(v.trim() === '' ? null : v)
        }}
        placeholder="Busque pelo nome ou CNPJ"
        dica={
          doCadastro === true
            ? 'Fornecedor do cadastro'
            : doCadastro === false && limpo !== '' && buscando === null
              ? 'Fora do cadastro de fornecedores'
              : 'Enter mostra os cadastrados'
        }
        aoConfirmar={() => {
          if (lista.length === 1 && buscando !== null) return escolher(lista[0]!)
          setBuscando(valor)
        }}
      />

      {buscando !== null ? (
        <View style={estilos.lista} accessibilityLabel="Fornecedores cadastrados">
          {achados === null ? <Text style={estilos.apoio}>Buscando…</Text> : null}
          {achados !== null && lista.length === 0 ? (
            <Text style={estilos.apoio}>
              {limpo === ''
                ? 'Nenhum fornecedor cadastrado ainda.'
                : 'Nenhum fornecedor cadastrado com esse nome.'}
            </Text>
          ) : null}
          {lista.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => escolher(f)}
              style={({ pressed }) => [estilos.achado, pressed && estilos.pressionado]}
              accessibilityRole="button"
              accessibilityLabel={nomeDoFornecedor(f)}
            >
              <Text style={estilos.nome}>{nomeDoFornecedor(f)}</Text>
              {f.tradeName || f.document ? (
                <Text style={estilos.apoio}>
                  {[f.tradeName ? f.name : null, documentoFormatado(f.document) || null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </Pressable>
          ))}
          {achados !== null && !jaExiste ? (
            <Pressable
              onPress={() => {
                setBuscando(null)
                setCadastrando(limpo)
              }}
              style={({ pressed }) => [estilos.criar, pressed && estilos.pressionado]}
              accessibilityRole="button"
            >
              <Text style={estilos.criarTexto}>
                {limpo === ''
                  ? '+ Cadastrar novo fornecedor'
                  : `+ Cadastrar “${limpo}” como fornecedor`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : doCadastro === false && limpo !== '' ? (
        <Pressable onPress={() => setCadastrando(limpo)} accessibilityRole="button" hitSlop={8}>
          <Text style={estilos.link}>Cadastrar “{limpo}” como fornecedor</Text>
        </Pressable>
      ) : null}

      {cadastrando !== null ? (
        <NovoFornecedorModal
          buscado={cadastrando}
          onCadastrado={(f) => {
            setCadastrando(null)
            escolher(f)
          }}
          onFechar={() => setCadastrando(null)}
        />
      ) : null}
    </View>
  )
}

type Endereco = Record<string, string>

function dadosDoCnpj(r: DadosDoCnpj): {
  nome: string
  fantasia: string
  endereco: Endereco | null
} {
  const endereco = Object.fromEntries(
    Object.entries({
      zipCode: digitos(r.cep),
      street: r.logradouro,
      number: r.numero,
      district: r.bairro,
      city: r.cidade,
      state: r.uf,
    }).filter(([, v]) => v.trim() !== ''),
  )
  return {
    nome: r.razaoSocial,
    fantasia: r.nomeFantasia,
    endereco: Object.keys(endereco).length > 0 ? endereco : null,
  }
}

/**
 * Cadastro rapido de fornecedor, aberto de dentro de outro formulario.
 * Comeca com o que foi buscado: digitos de CNPJ/CPF vao para o documento (o
 * CNPJ completo ja busca os dados na Receita); o resto vai para o nome.
 */
export function NovoFornecedorModal({
  buscado,
  onCadastrado,
  onFechar,
}: {
  buscado: string
  onCadastrado: (f: FornecedorCadastrado) => void
  onFechar: () => void
}) {
  const documentoInicial = pareceDocumento(buscado) ? buscado.trim() : ''
  const [documento, setDocumento] = useState(documentoInicial)
  const [nome, setNome] = useState(documentoInicial === '' ? buscado.trim() : '')
  const [fantasia, setFantasia] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [endereco, setEndereco] = useState<Endereco | null>(null)
  const [buscandoDoc, setBuscandoDoc] = useState(digitos(documentoInicial).length === 14)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function aplicar(r: DadosDoCnpj) {
    const d = dadosDoCnpj(r)
    setNome(d.nome)
    setFantasia(d.fantasia)
    setEndereco(d.endereco)
  }

  /* CNPJ completo vindo da busca: ja traz os dados, sem pedir toque. */
  useEffect(() => {
    if (digitos(documentoInicial).length !== 14) return
    let cancelado = false
    void buscarCnpj(documentoInicial).then((r) => {
      if (cancelado) return
      setBuscandoDoc(false)
      if (!r.ok) return
      const d = dadosDoCnpj(r.dados)
      setNome(d.nome)
      setFantasia(d.fantasia)
      setEndereco(d.endereco)
    })
    return () => {
      cancelado = true
    }
  }, [documentoInicial])

  async function preencherPeloCnpj() {
    if (digitos(documento).length !== 14) return setErro('Informe o CNPJ completo para buscar.')
    setBuscandoDoc(true)
    const r = await buscarCnpj(documento)
    setBuscandoDoc(false)
    if (!r.ok) return setErro(r.erro)
    setErro(null)
    aplicar(r.dados)
  }

  async function salvar() {
    if (nome.trim().length < 2) return setErro('Informe o nome do fornecedor.')
    setSalvando(true)
    setErro(null)
    const dados: DadosDoFornecedor = {
      name: nome.trim(),
      ...(fantasia.trim() !== '' ? { tradeName: fantasia.trim() } : {}),
      ...(digitos(documento) !== '' ? { document: digitos(documento) } : {}),
      ...(digitos(telefone) !== '' ? { phone: digitos(telefone) } : {}),
      ...(email.trim() !== '' ? { email: email.trim() } : {}),
      ...(endereco !== null ? { address: endereco } : {}),
    }
    const r = await salvarFornecedor(dados)
    setSalvando(false)
    if (!r.ok) return setErro(r.erro)
    onCadastrado(r.dados)
  }

  const linhaDoEndereco =
    endereco === null
      ? null
      : [
          [endereco.street, endereco.number].filter(Boolean).join(', '),
          [endereco.city, endereco.state].filter(Boolean).join('/'),
        ]
          .filter(Boolean)
          .join(' — ')

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
            <Text style={estilos.titulo}>Novo fornecedor</Text>
            <Campo
              rotulo="CNPJ ou CPF"
              valor={documento}
              onChange={setDocumento}
              tipoTeclado="numeric"
              placeholder="00.000.000/0000-00"
              dica={buscandoDoc ? 'Buscando na Receita…' : 'O CNPJ busca os dados na Receita'}
              aoConfirmar={() => void preencherPeloCnpj()}
            />
            <Botao variante="secundario" onPress={() => void preencherPeloCnpj()}>
              Buscar CNPJ
            </Botao>
            <Campo rotulo="Razão social ou nome *" valor={nome} onChange={setNome} />
            <Campo rotulo="Nome fantasia" valor={fantasia} onChange={setFantasia} />
            <Campo
              rotulo="Telefone"
              valor={telefone}
              onChange={setTelefone}
              tipoTeclado="phone-pad"
              placeholder="(41) 3333-4444"
            />
            <Campo
              rotulo="E-mail"
              valor={email}
              onChange={setEmail}
              tipoTeclado="email-address"
              autoCap="none"
            />
            {linhaDoEndereco !== null ? (
              <Text style={estilos.apoio}>Endereço da Receita: {linhaDoEndereco}</Text>
            ) : null}
            {erro !== null ? (
              <Text style={estilos.erro} accessibilityRole="alert">
                {erro}
              </Text>
            ) : null}
            <Botao onPress={() => void salvar()} carregando={salvando} largura>
              Cadastrar e usar
            </Botao>
            <Botao variante="fantasma" onPress={onFechar} largura>
              Cancelar
            </Botao>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  bloco: { gap: espaco.sm },
  lista: { gap: espaco.sm },
  achado: {
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
    gap: 2,
  },
  pressionado: { opacity: 0.7 },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.pequeno, color: cores.textoFraco },
  criar: {
    padding: espaco.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cores.acento,
    borderRadius: raio.md,
  },
  criarTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: cores.veu },
  foraDaFolha: { flex: 1 },
  folha: {
    ...vidro.painel,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
    maxHeight: '92%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
}))
