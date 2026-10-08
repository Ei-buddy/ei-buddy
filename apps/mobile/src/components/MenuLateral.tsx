import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import type { DrawerContentComponentProps } from 'expo-router/drawer'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { escolherLoja, sair as encerrarNoServidor } from '@/lib/auth-api'
import { lerSessao, type Sessao } from '@/lib/session'
import { carregarAvisos } from '@/lib/avisos-api'
import { alternarSom, assinarSom, lerSom, type PreferenciaDeSom } from '@/lib/som'
import { ACAO_TUTORIAL, GRUPOS } from '@/lib/navegacao'
import { iniciarTutorial } from '@/lib/tutorial'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

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
    if (rota === ACAO_TUTORIAL) return iniciarTutorial()
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

  /* O liga/desliga do som — o mesmo botao da barra do topo do web (NR-163). */
  const [som, setSom] = useState<PreferenciaDeSom>('ligado')
  useEffect(() => {
    void lerSom().then(setSom)
    return assinarSom(setSom)
  }, [])

  /* Respostas novas do suporte no item do menu, como o badge da barra do web
     (NR-162). Mesma fonte do sino, para os dois numeros nunca divergirem. */
  const [respostasDoSuporte, setRespostasDoSuporte] = useState(0)
  useEffect(() => {
    void carregarAvisos().then((avisos) =>
      setRespostasDoSuporte(avisos.find((a) => a.rota.pathname === '/suporte')?.contagem ?? 0),
    )
  }, [caminho])

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
        {(sessao?.admin === true
          ? [
              ...GRUPOS,
              { grupo: 'Plataforma', itens: [{ rota: '/plataforma', rotulo: 'Plataforma' }] },
            ]
          : GRUPOS
        ).map((g) => {
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
                        {i.rota === '/suporte' && respostasDoSuporte > 0 ? (
                          <View
                            style={estilos.badge}
                            accessibilityLabel={`${respostasDoSuporte} resposta(s) nova(s)`}
                          >
                            <Text style={estilos.badgeTexto}>{respostasDoSuporte}</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    )
                  })
                : null}
            </View>
          )
        })}
      </ScrollView>

      <View style={estilos.som}>
        <View style={estilos.flex}>
          <Text style={estilos.somTitulo}>Som</Text>
          <Text style={estilos.somApoio}>Bipe do leitor e venda fechada</Text>
        </View>
        <Switch
          value={som === 'ligado'}
          onValueChange={() => void alternarSom()}
          trackColor={{ true: cores.ativo, false: cores.borda }}
          thumbColor={cores.texto}
          accessibilityLabel={som === 'ligado' ? 'Desligar o som' : 'Ligar o som'}
        />
      </View>

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
  /* A barra lateral e um painel de vidro, como a do web — NR-160. */
  menu: { flex: 1, ...vidro.painel },

  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingBottom: espaco.lg,
  },
  /* A loja ativa. Alvo de toque de 56 — a pessoa troca em pe, com uma mao. */
  loja: {
    ...vidro.peca,
    marginHorizontal: espaco.lg,
    minHeight: 56,
    justifyContent: 'center',
    gap: 1,
    marginTop: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
  },
  /* O item ativo e o azul de vidro do web, brilhando para fora. */
  itemAtivo: { ...vidro.ativo },
  itemTexto: { flex: 1, fontSize: fonte.pequeno, color: cores.textoFraco },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.acento,
  },
  badgeTexto: { fontSize: 11, fontWeight: peso.pesado, color: cores.textoSobreAcento },
  itemTextoAtivo: { color: cores.textoSobreAtivo, fontWeight: peso.forte },

  som: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginHorizontal: espaco.lg,
    marginBottom: espaco.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.md,
    ...vidro.peca,
  },
  flex: { flex: 1 },
  somTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  somApoio: { fontSize: fonte.micro, color: cores.textoFraco },
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
