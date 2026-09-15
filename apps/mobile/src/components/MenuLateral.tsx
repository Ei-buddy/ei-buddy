import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import type { DrawerContentComponentProps } from 'expo-router/drawer'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { escolherLoja, sair as encerrarNoServidor } from '@/lib/auth-api'
import { lerSessao, type Sessao } from '@/lib/session'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

type Item = { rota: string; rotulo: string }
type Grupo = { grupo: string; itens: Item[] }

/**
 * Modulos do app, agrupados como na sidebar do web.
 *
 * Sao doze destinos — nao cabem numa barra de abas, e uma lista corrida
 * de doze itens tambem nao ajuda ninguem. Por isso os grupos abrem e
 * fecham: quem vai ao financeiro nao precisa ver cadastro no caminho.
 */
const GRUPOS: Grupo[] = [
  {
    grupo: 'Operação',
    itens: [
      { rota: '/inicio', rotulo: 'Tela principal' },
      { rota: '/pdv', rotulo: 'Nova venda' },
      { rota: '/vendas', rotulo: 'Vendas' },
      { rota: '/agenda', rotulo: 'Agenda' },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { rota: '/clientes', rotulo: 'Clientes' },
      { rota: '/catalogo', rotulo: 'Produtos' },
      { rota: '/empresa', rotulo: 'Empresa' },
    ],
  },
  {
    grupo: 'Financeiro',
    itens: [
      { rota: '/contas-a-pagar', rotulo: 'Contas a pagar' },
      { rota: '/contas-a-receber', rotulo: 'Contas a receber' },
      { rota: '/plano-de-contas', rotulo: 'Plano de contas' },
      { rota: '/dre', rotulo: 'Resultado' },
      { rota: '/relatorios', rotulo: 'Relatórios' },
    ],
  },
  {
    grupo: 'Mais',
    itens: [
      { rota: '/crm', rotulo: 'CRM' },
      { rota: '/assistente', rotulo: 'Assistente' },
      { rota: '/assinatura', rotulo: 'Assinatura' },
      { rota: '/suporte', rotulo: 'Suporte' },
      /* Ponto fixo de acesso aos documentos legais — RF-01. */
      { rota: '/privacidade-e-termos', rotulo: 'Privacidade e Termos' },
    ],
  },
]

export default function MenuLateral(props: DrawerContentComponentProps) {
  const router = useRouter()
  const caminho = usePathname()
  const insets = useSafeAreaInsets()

  /* Abre ja no grupo onde a pessoa esta, para ela se localizar. */
  const [abertos, setAbertos] = useState<Set<string>>(() => {
    const atual = GRUPOS.find((g) => g.itens.some((i) => caminho.endsWith(i.rota)))
    return new Set([atual?.grupo ?? 'Operação'])
  })

  function alternarGrupo(grupo: string) {
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (novo.has(grupo)) {
        novo.delete(grupo)
      } else {
        novo.add(grupo)
      }
      return novo
    })
  }

  function navegar(rota: string) {
    props.navigation.closeDrawer()
    router.push(rota as never)
  }

  /*
   * A sessao e lida aqui, e nao recebida por prop: o menu e montado pelo
   * Drawer, que nao passa nada nosso. Ler no efeito custa uma leitura de
   * AsyncStorage por abertura — barato, e mantem o nome da loja em dia depois
   * de uma troca.
   */
  const [sessao, setSessao] = useState<Sessao | null>(null)
  const [trocando, setTrocando] = useState(false)
  const [trocandoPara, setTrocandoPara] = useState<string | null>(null)

  const recarregarSessao = useCallback(async () => {
    setSessao(await lerSessao())
  }, [])

  useEffect(() => {
    void recarregarSessao()
  }, [recarregarSessao])

  /**
   * Troca de loja sem sair — US-059.
   *
   * Volta para a tela inicial de proposito. A tela aberta pode ser o detalhe de
   * uma venda ou de um cliente da loja ANTERIOR, e mante-la depois da troca
   * mostraria "nao encontrado" — ou, pior, deixaria a pessoa achando que aquele
   * dado e da loja nova.
   */
  async function trocarDeLoja(companyId: string) {
    setTrocandoPara(companyId)

    const r = await escolherLoja(companyId)

    setTrocandoPara(null)

    if (r.estado !== 'pronto') {
      /* Nao troca e nao mente: o nome no menu continua o da loja de verdade. */
      return
    }

    setTrocando(false)
    await recarregarSessao()
    props.navigation.closeDrawer()
    router.replace('/inicio')
  }

  async function sair() {
    /* `sair` do `auth-api`, e nao `encerrarSessao` direto: ele avisa o servidor
       ANTES de apagar o token, e sem esse aviso o token continuava valido por
       doze horas depois de a pessoa tocar aqui (NR-083). */
    await encerrarNoServidor()
    props.navigation.closeDrawer()
    router.replace('/login')
  }

  return (
    <View style={[estilos.menu, { paddingTop: insets.top + espaco.lg }]}>
      <View style={estilos.marca}>
        <Text style={estilos.marcaNome}>EiBuddy</Text>
      </View>

      {/*
        A loja ATIVA, sempre visivel.
        A sessao guardava o nome dela desde sempre e nenhuma tela o mostrava —
        um comentario no `auth-api` chegava a afirmar que "o menu lateral mostra
        qual e". Nao mostrava. Quem opera mais de uma loja nao tinha como saber
        em qual estava, e lancar no lugar errado nao dava nenhum sinal.
      */}
      {sessao !== null && sessao.empresa !== '' ? (
        <Pressable
          onPress={() => setTrocando((v) => !v)}
          disabled={sessao.lojas.length < 2}
          style={({ pressed }) => [estilos.loja, pressed && estilos.lojaPressionada]}
          accessibilityRole={sessao.lojas.length < 2 ? 'text' : 'button'}
          accessibilityLabel={
            sessao.lojas.length < 2
              ? `Loja ativa: ${sessao.empresa}`
              : `Loja ativa: ${sessao.empresa}. Toque para trocar.`
          }
        >
          <Text style={estilos.lojaRotulo}>Loja</Text>
          <Text style={estilos.lojaNome} numberOfLines={1}>
            {sessao.empresa}
          </Text>
          {sessao.lojas.length > 1 ? (
            <Text style={estilos.lojaTrocar}>{trocando ? 'fechar' : 'trocar'}</Text>
          ) : null}
        </Pressable>
      ) : null}

      {trocando && sessao !== null ? (
        <View style={estilos.outras}>
          {sessao.lojas
            .filter((l) => l.companyId !== sessao.empresaId)
            .map((l) => (
              <Pressable
                key={l.companyId}
                onPress={() => void trocarDeLoja(l.companyId)}
                disabled={trocandoPara !== null}
                style={({ pressed }) => [estilos.outra, pressed && estilos.lojaPressionada]}
                accessibilityRole="button"
              >
                <Text style={estilos.outraNome} numberOfLines={1}>
                  {trocandoPara === l.companyId ? 'Abrindo...' : l.companyName}
                </Text>
              </Pressable>
            ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={estilos.lista}>
        {GRUPOS.map((g) => {
          const aberto = abertos.has(g.grupo)

          return (
            <View key={g.grupo} style={estilos.grupo}>
              <Pressable
                onPress={() => alternarGrupo(g.grupo)}
                style={estilos.grupoCabecalho}
                accessibilityRole="button"
                accessibilityState={{ expanded: aberto }}
              >
                <Text style={estilos.grupoTitulo}>{g.grupo}</Text>
                <Text style={[estilos.seta, aberto && estilos.setaAberta]}>⌄</Text>
              </Pressable>

              {aberto
                ? g.itens.map((i) => {
                    const ativo = caminho.endsWith(i.rota)
                    return (
                      <Pressable
                        key={i.rota}
                        onPress={() => navegar(i.rota)}
                        style={[estilos.item, ativo && estilos.itemAtivo]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: ativo }}
                      >
                        <Text style={[estilos.itemTexto, ativo && estilos.itemTextoAtivo]}>
                          {i.rotulo}
                        </Text>
                      </Pressable>
                    )
                  })
                : null}
            </View>
          )
        })}
      </ScrollView>

      <Pressable
        onPress={sair}
        style={[estilos.sair, { marginBottom: insets.bottom + espaco.md }]}
        accessibilityRole="button"
      >
        <Text style={estilos.sairTexto}>Sair</Text>
      </Pressable>
    </View>
  )
}

const estilos = StyleSheet.create({
  menu: { flex: 1, backgroundColor: '#0b1029' },

  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingBottom: espaco.lg,
  },
  /* A loja ativa. Alvo de toque de 56 — a pessoa troca em pe, com uma mao. */
  loja: {
    minHeight: 56,
    justifyContent: 'center',
    gap: 1,
    marginTop: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  lojaPressionada: { borderColor: cores.acento },
  lojaRotulo: { fontSize: fonte.micro, color: cores.textoFraco },
  lojaNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  lojaTrocar: { fontSize: fonte.micro, color: cores.acento },
  outras: { gap: 2, marginTop: espaco.xs },
  outra: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: espaco.md,
    borderRadius: raio.md,
    backgroundColor: cores.campo,
  },
  outraNome: { fontSize: fonte.pequeno, color: cores.texto },

  marcaNome: { fontSize: fonte.medio, fontWeight: peso.pesado, color: cores.texto },

  lista: { paddingHorizontal: espaco.md, gap: espaco.sm, paddingBottom: espaco.lg },
  grupo: { gap: 2 },
  grupoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.md,
  },
  grupoTitulo: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.textoFraco,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  seta: { fontSize: 16, color: cores.textoFraco },
  setaAberta: { transform: [{ rotate: '180deg' }], color: cores.acento },

  item: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.md,
    borderRadius: raio.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  itemAtivo: { backgroundColor: cores.sucessoFundo },
  itemTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  itemTextoAtivo: { color: cores.acento, fontWeight: peso.forte },

  sair: {
    marginHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  sairTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.textoFraco },
})
