import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  aprovarParceiro,
  carregarPerfil,
  convidarSuperAdmin,
  entrarNaEmpresa,
  JUSTIFICATIVA_MINIMA,
  listarEmpresas,
  listarListaVip,
  listarParceirosPendentes,
  listarUsuarios,
  recusarParceiro,
  resumoListaVip,
  revogarSuperAdmin,
  ROTULO_DIFICULDADE,
  ROTULO_PAPEL,
  ROTULO_SISTEMA,
  ROTULO_VALOR,
  sairDoModoAdmin,
  type CandidaturaDeParceiro,
  type EmpresaListada,
  type Perfil,
  type RespostaListaVip,
  type ResumoDaListaVip,
  type UsuarioDaPlataforma,
} from '@/lib/plataforma-api'
import { atualizarEmpresaAtiva } from '@/lib/session'
import { formatDateTime } from '@/lib/format'
import { maskCNPJ, maskPhone } from '@/lib/validation'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

type Aba = 'empresas' | 'usuarios' | 'lista' | 'parceiros'

const ABAS: [Aba, string][] = [
  ['empresas', 'Empresas'],
  ['usuarios', 'Usuários'],
  ['lista', 'Lista de espera'],
  ['parceiros', 'Parceiros'],
]

/** O motivo da recusa vai para o pedido; o web pede 10 caracteres. */
const MOTIVO_MINIMO = 10

/**
 * Plataforma — area do Super Admin (ADR-0007), a mesma do web.
 *
 * Empresas (entrar numa, com justificativa que vai para a trilha), usuarios e
 * quem e Super Admin, a lista de espera do pre-lancamento e os pedidos de
 * Parceiro. O menu so mostra esta tela a quem e Super Admin, e o servidor
 * recusa as rotas para quem nao e.
 */
export default function Plataforma() {
  const [aba, setAba] = useState<Aba>('empresas')
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const router = useRouter()

  const carregar = useCallback(async () => {
    const r = await carregarPerfil()
    if (r.ok) setPerfil(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function sair() {
    const r = await sairDoModoAdmin()
    if (!r.ok) {
      Alert.alert('Não deu para sair', r.erro)
      return
    }
    await atualizarEmpresaAtiva(null, '')
    await carregar()
  }

  if (perfil !== null && !perfil.isPlatformAdmin) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Plataforma" />
        <Vazio
          titulo="Sem acesso"
          descricao="Esta área é de quem administra o EiBuddy inteiro, e sua conta não tem esse acesso."
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Plataforma" subtitulo="Administração do EiBuddy" />

      {perfil?.isImpersonating ? (
        <View style={estilos.faixa}>
          <Text style={estilos.faixaTexto}>
            Você está dentro de {perfil.companyName ?? 'uma empresa'} como Super Admin.
          </Text>
          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={() => router.push('/inicio')} largura>
                Ir para a loja
              </Botao>
            </View>
            <View style={estilos.flex}>
              <Botao variante="perigo" onPress={() => void sair()} largura>
                Sair da empresa
              </Botao>
            </View>
          </View>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={estilos.abasRolagem}
        contentContainerStyle={estilos.abas}
      >
        {ABAS.map(([valor, rotulo]) => (
          <Pressable
            key={valor}
            onPress={() => setAba(valor)}
            style={[estilos.aba, aba === valor && estilos.abaAtiva]}
            accessibilityRole="button"
            accessibilityState={{ selected: aba === valor }}
          >
            <Text style={[estilos.abaTexto, aba === valor && estilos.abaTextoAtiva]}>{rotulo}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {aba === 'empresas' ? (
          <Empresas
            onEntrou={async (empresa) => {
              await atualizarEmpresaAtiva(empresa.id, empresa.tradeName ?? empresa.legalName)
              router.replace('/inicio')
            }}
          />
        ) : aba === 'usuarios' ? (
          <Usuarios />
        ) : aba === 'lista' ? (
          <ListaDeEspera />
        ) : (
          <Parceiros />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Empresas({ onEntrou }: { onEntrou: (empresa: EmpresaListada) => Promise<void> }) {
  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [entrando, setEntrando] = useState<EmpresaListada | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await listarEmpresas()
      if (cancelado) return
      if (r.ok) setEmpresas(r.dados.companies)
      else setErro(r.erro)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function entrar() {
    if (entrando === null) return
    setEnviando(true)
    const r = await entrarNaEmpresa(entrando.id, justificativa)
    setEnviando(false)
    if (!r.ok) {
      Alert.alert('Não deu para entrar', r.erro)
      return
    }
    await onEntrou(entrando)
  }

  if (erro !== null) return <Vazio titulo="Não deu para carregar" descricao={erro} />
  if (empresas === null) return <Vazio titulo="Carregando" />

  const termo = busca.trim().toLowerCase()
  const visiveis = empresas.filter(
    (e) =>
      termo === '' ||
      e.legalName.toLowerCase().includes(termo) ||
      (e.tradeName ?? '').toLowerCase().includes(termo) ||
      e.cnpj.includes(termo.replace(/\D/g, '') || '§'),
  )

  return (
    <>
      <Busca valor={busca} onChange={setBusca} placeholder="Nome ou CNPJ" />
      <Text style={estilos.apoio}>{empresas.length} empresa(s)</Text>
      {visiveis.map((e) => (
        <View key={e.id} style={estilos.cartao}>
          <View style={estilos.linha}>
            <View style={estilos.flex}>
              <Text style={estilos.nome}>{e.tradeName ?? e.legalName}</Text>
              <Text style={estilos.apoio}>
                {maskCNPJ(e.cnpj)} · desde {formatDateTime(e.createdAt).slice(0, 10)}
              </Text>
            </View>
            {e.isActive ? null : <Etiqueta tom="erro">Inativa</Etiqueta>}
          </View>
          {entrando?.id === e.id ? (
            <View style={estilos.formulario}>
              <Campo
                rotulo="Por que você vai entrar nesta empresa"
                valor={justificativa}
                onChange={setJustificativa}
                placeholder="Ex.: chamado de suporte sobre a nota fiscal"
                dica="Vai para a trilha de auditoria da loja."
              />
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={() => setEntrando(null)} largura>
                    Cancelar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao
                    onPress={() => void entrar()}
                    carregando={enviando}
                    desabilitado={justificativa.trim().length < JUSTIFICATIVA_MINIMA}
                    largura
                  >
                    Entrar
                  </Botao>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setJustificativa('')
                setEntrando(e)
              }}
              accessibilityRole="button"
            >
              <Text style={estilos.link}>Entrar nesta empresa</Text>
            </Pressable>
          )}
        </View>
      ))}
    </>
  )
}

function Usuarios() {
  const [busca, setBusca] = useState('')
  const [usuarios, setUsuarios] = useState<UsuarioDaPlataforma[] | null>(null)
  const [total, setTotal] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [convidando, setConvidando] = useState(false)
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(() => {
      void (async () => {
        const r = await listarUsuarios({ q: busca.trim() })
        if (cancelado) return
        if (!r.ok) {
          setErro(r.erro)
          return
        }
        setErro(null)
        setUsuarios(r.dados.users)
        setTotal(r.dados.total)
      })()
    }, 400)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [busca, tentativa])

  function alternarAdmin(u: UsuarioDaPlataforma) {
    Alert.alert(
      u.isPlatformAdmin ? `Tirar o Super Admin de ${u.name}?` : `Tornar ${u.name} Super Admin?`,
      u.isPlatformAdmin
        ? 'A pessoa perde o acesso a esta área.'
        : 'A pessoa passa a ver e entrar em todas as empresas.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: u.isPlatformAdmin ? 'destructive' : 'default',
          onPress: () =>
            void (async () => {
              const r = u.isPlatformAdmin
                ? await revogarSuperAdmin(u.userId)
                : await convidarSuperAdmin(u.email)
              if (!r.ok) Alert.alert('Não deu certo', r.erro)
              setTentativa((n) => n + 1)
            })(),
        },
      ],
    )
  }

  async function convidar() {
    const r = await convidarSuperAdmin(email.trim(), nome)
    if (!r.ok) {
      Alert.alert('Não deu para convidar', r.erro)
      return
    }
    Alert.alert(
      'Super Admin',
      r.dados.temporaryPassword
        ? `Conta criada. Senha provisória: ${r.dados.temporaryPassword}`
        : 'Acesso concedido.',
    )
    setConvidando(false)
    setEmail('')
    setNome('')
    setTentativa((n) => n + 1)
  }

  return (
    <>
      <Busca valor={busca} onChange={setBusca} placeholder="Nome ou e-mail" />
      {convidando ? (
        <Cartao titulo="Convidar Super Admin">
          <View style={estilos.formulario}>
            <Campo
              rotulo="E-mail"
              valor={email}
              onChange={setEmail}
              tipoTeclado="email-address"
              autoCap="none"
            />
            <Campo rotulo="Nome (se a conta ainda não existe)" valor={nome} onChange={setNome} />
            <View style={estilos.linha}>
              <View style={estilos.flex}>
                <Botao variante="secundario" onPress={() => setConvidando(false)} largura>
                  Cancelar
                </Botao>
              </View>
              <View style={estilos.flex}>
                <Botao onPress={() => void convidar()} desabilitado={!email.includes('@')} largura>
                  Convidar
                </Botao>
              </View>
            </View>
          </View>
        </Cartao>
      ) : (
        <Pressable onPress={() => setConvidando(true)} accessibilityRole="button">
          <Text style={estilos.link}>+ Convidar Super Admin</Text>
        </Pressable>
      )}
      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
      {usuarios === null ? (
        <Vazio titulo="Carregando" />
      ) : (
        <>
          <Text style={estilos.apoio}>{total} usuário(s)</Text>
          {usuarios.map((u) => (
            <View key={u.userId} style={estilos.cartao}>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Text style={estilos.nome}>{u.name}</Text>
                  <Text style={estilos.apoio}>{u.email}</Text>
                </View>
                {u.isPlatformAdmin ? <Etiqueta tom="atencao">Super Admin</Etiqueta> : null}
                {u.isActive ? null : <Etiqueta tom="erro">Inativo</Etiqueta>}
              </View>
              {u.companies.map((c) => (
                <Text key={c.companyId} style={estilos.apoio}>
                  {c.name} · {ROTULO_PAPEL[c.role] ?? c.role}
                </Text>
              ))}
              <Text style={estilos.apoio}>
                {u.lastAccessAt
                  ? `Último acesso ${formatDateTime(u.lastAccessAt)}`
                  : 'Nunca entrou'}
              </Text>
              <Pressable onPress={() => alternarAdmin(u)} accessibilityRole="button">
                <Text style={u.isPlatformAdmin ? estilos.linkPerigo : estilos.link}>
                  {u.isPlatformAdmin ? 'Tirar Super Admin' : 'Tornar Super Admin'}
                </Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </>
  )
}

function ListaDeEspera() {
  const [resumo, setResumo] = useState<ResumoDaListaVip | null>(null)
  const [respostas, setRespostas] = useState<RespostaListaVip[] | null>(null)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await resumoListaVip()
      if (!cancelado && r.ok) setResumo(r.dados)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(() => {
      void (async () => {
        const r = await listarListaVip({ q: busca.trim(), page: pagina })
        if (cancelado) return
        if (!r.ok) {
          setErro(r.erro)
          return
        }
        setErro(null)
        setTotal(r.dados.total)
        setRespostas((atual) =>
          pagina === 1 ? r.dados.entries : [...(atual ?? []), ...r.dados.entries],
        )
      })()
    }, 400)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [busca, pagina])

  return (
    <>
      {resumo !== null ? (
        <>
          <Text style={estilos.nome}>{resumo.total} pessoa(s) na lista</Text>
          <Contagens
            titulo="Maior dificuldade"
            itens={resumo.painPoints}
            rotulos={ROTULO_DIFICULDADE}
          />
          <Contagens titulo="Usa sistema hoje" itens={resumo.usesSystem} rotulos={ROTULO_SISTEMA} />
          <Contagens titulo="Preço justo" itens={resumo.fairPrice} rotulos={ROTULO_VALOR} />
        </>
      ) : null}
      <Busca
        valor={busca}
        onChange={(v) => {
          setBusca(v)
          setPagina(1)
        }}
        placeholder="Nome, negócio ou telefone"
      />
      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
      {(respostas ?? []).map((r) => (
        <View key={r.id} style={estilos.cartao}>
          <Text style={estilos.nome}>
            {r.name}
            {r.businessType ? ` · ${r.businessType}` : ''}
          </Text>
          <Text style={estilos.apoio}>
            {maskPhone(r.phone)} · {formatDateTime(r.createdAt)}
          </Text>
          <Text style={estilos.texto}>{r.expectation}</Text>
        </View>
      ))}
      {respostas !== null && respostas.length < total ? (
        <Botao variante="secundario" onPress={() => setPagina((p) => p + 1)} largura>
          Carregar mais
        </Botao>
      ) : null}
    </>
  )
}

function Contagens({
  titulo,
  itens,
  rotulos,
}: {
  titulo: string
  itens: { value: string; count: number }[]
  rotulos: Record<string, string>
}) {
  const maior = Math.max(1, ...itens.map((i) => i.count))
  return (
    <Cartao titulo={titulo}>
      {itens.length === 0 ? <Text style={estilos.apoio}>Ninguém respondeu ainda.</Text> : null}
      {itens.map((i) => (
        <View key={i.value} style={estilos.barraLinha}>
          <Text style={estilos.barraRotulo} numberOfLines={1}>
            {rotulos[i.value] ?? i.value}
          </Text>
          <View style={estilos.barraFundo}>
            <View style={[estilos.barra, { width: `${(i.count / maior) * 100}%` }]} />
          </View>
          <Text style={estilos.barraValor}>{i.count}</Text>
        </View>
      ))}
    </Cartao>
  )
}

function Parceiros() {
  const [pedidos, setPedidos] = useState<CandidaturaDeParceiro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [emAcao, setEmAcao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await listarParceirosPendentes()
    if (r.ok) {
      setPedidos(r.dados.applications)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function agir(id: string, acao: () => Promise<{ ok: boolean; erro?: string }>) {
    setEmAcao(id)
    const r = await acao()
    setEmAcao(null)
    if (!r.ok) {
      Alert.alert('Não deu certo', r.erro ?? '')
      return
    }
    setRecusando(null)
    setMotivo('')
    await carregar()
  }

  if (erro !== null) return <Vazio titulo="Não deu para carregar" descricao={erro} />
  if (pedidos === null) return <Vazio titulo="Carregando" />
  if (pedidos.length === 0) return <Vazio titulo="Nenhum pedido pendente" />

  return (
    <>
      {pedidos.map((p) => (
        <View key={p.partnerId} style={estilos.cartao}>
          <Text style={estilos.nome}>{p.companyName}</Text>
          <Text style={estilos.apoio}>
            {maskPhone(p.companyPhone)} · {p.companyEmail}
          </Text>
          <Text style={estilos.apoio}>
            PIX ({p.pixKeyType}): {p.pixKey}
            {p.couponCode ? ` · cupom ${p.couponCode}` : ''}
          </Text>
          <Text style={estilos.texto}>{p.message}</Text>
          {recusando === p.partnerId ? (
            <View style={estilos.formulario}>
              <Campo rotulo="Motivo da recusa" valor={motivo} onChange={setMotivo} />
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Botao variante="secundario" onPress={() => setRecusando(null)} largura>
                    Voltar
                  </Botao>
                </View>
                <View style={estilos.flex}>
                  <Botao
                    variante="perigo"
                    onPress={() =>
                      void agir(p.partnerId, () => recusarParceiro(p.partnerId, motivo))
                    }
                    carregando={emAcao === p.partnerId}
                    desabilitado={motivo.trim().length < MOTIVO_MINIMO}
                    largura
                  >
                    Recusar
                  </Botao>
                </View>
              </View>
            </View>
          ) : (
            <View style={estilos.linha}>
              <View style={estilos.flex}>
                <Botao variante="secundario" onPress={() => setRecusando(p.partnerId)} largura>
                  Recusar
                </Botao>
              </View>
              <View style={estilos.flex}>
                <Botao
                  onPress={() => void agir(p.partnerId, () => aprovarParceiro(p.partnerId))}
                  carregando={emAcao === p.partnerId}
                  largura
                >
                  Aprovar
                </Botao>
              </View>
            </View>
          )}
        </View>
      ))}
    </>
  )
}

function Busca({
  valor,
  onChange,
  placeholder,
}: {
  valor: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <TextInput
      style={estilos.busca}
      value={valor}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={cores.textoFraco}
      autoCorrect={false}
      autoCapitalize="none"
      accessibilityLabel={placeholder}
    />
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  faixa: {
    gap: espaco.sm,
    marginHorizontal: espaco.lg,
    padding: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.atencaoFundo,
  },
  faixaTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.atencao },
  abasRolagem: { flexGrow: 0, marginTop: espaco.md },
  abas: { flexDirection: 'row', gap: espaco.sm, paddingHorizontal: espaco.lg },
  aba: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  abaAtiva: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  abaTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  abaTextoAtiva: { color: cores.acento, fontWeight: peso.forte },
  busca: {
    minHeight: 48,
    paddingHorizontal: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
    backgroundColor: cores.campo,
    color: cores.texto,
    fontSize: fonte.corpo,
  },
  cartao: {
    gap: espaco.xs,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  texto: { fontSize: fonte.pequeno, color: cores.texto },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  linkPerigo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.erro },
  formulario: { gap: espaco.sm, marginTop: espaco.sm },
  barraLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, paddingVertical: 3 },
  barraRotulo: { width: 130, fontSize: fonte.micro, color: cores.textoFraco },
  barraFundo: { flex: 1, height: 8, borderRadius: 4, backgroundColor: cores.campo },
  barra: { height: 8, borderRadius: 4, backgroundColor: cores.acento },
  barraValor: { minWidth: 28, textAlign: 'right', fontSize: fonte.micro, color: cores.texto },
})
