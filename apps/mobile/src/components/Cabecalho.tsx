import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from 'expo-router'
import type { DrawerActionType } from '@react-navigation/native'
import Avisos from '@/components/Avisos'
import BuscaGlobal from '@/components/BuscaGlobal'
import { BotaoCompacto } from '@/components/ui/Botao'
import {
  avisosNovos,
  carregarAvisos,
  lerAvisosVistos,
  marcarAvisosVistos,
  type Aviso,
} from '@/lib/avisos-api'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Cabecalho das telas do app.
 *
 * Traz o botao que abre a gaveta — sem ele, so o gesto de deslizar
 * abriria o menu, e gesto sozinho e descoberta que muita gente nao faz.
 */
export default function Cabecalho({
  titulo,
  subtitulo,
  acao,
}: {
  titulo: string
  subtitulo?: string
  acao?: ReactNode
}) {
  const navigation = useNavigation()
  const [buscando, setBuscando] = useState(false)
  const [vendoAvisos, setVendoAvisos] = useState(false)
  const [avisos, setAvisos] = useState<Aviso[] | null>(null)
  const [novos, setNovos] = useState(0)

  /*
   * A busca e o sino moram no cabecalho, como na barra do topo do web
   * (NR-162). Telas com acao propria (o PDV, com Buscar e Bipar) ficam sem
   * eles para nao espremer o titulo; o menu continua a um toque.
   */
  const comAtalhos = acao === undefined

  useFocusEffect(
    useCallback(() => {
      if (!comAtalhos) return
      let cancelado = false
      void (async () => {
        const [lista, vistos] = await Promise.all([carregarAvisos(), lerAvisosVistos()])
        if (cancelado) return
        setAvisos(lista)
        setNovos(avisosNovos(lista, vistos).reduce((t, a) => t + a.contagem, 0))
      })()
      return () => {
        cancelado = true
      }
    }, [comAtalhos]),
  )

  function abrirAvisos() {
    setVendoAvisos(true)
    setNovos(0)
    if (avisos !== null) void marcarAvisosVistos(avisos)
  }

  function abrirMenu() {
    navigation.dispatch({ type: 'OPEN_DRAWER' } as unknown as DrawerActionType)
  }

  return (
    <View style={estilos.cabecalho}>
      <Pressable
        onPress={abrirMenu}
        style={estilos.botaoMenu}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Abrir menu"
      >
        {/* Tres barras desenhadas com View — sem dependencia de icone. */}
        <View style={estilos.barra} />
        <View style={estilos.barra} />
        <View style={estilos.barra} />
      </Pressable>

      <View style={estilos.textos}>
        {/* No celular estreito o titulo encolhe um pouco antes de cortar. */}
        <Text style={estilos.titulo} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {titulo}
        </Text>
        {subtitulo ? (
          <Text style={estilos.subtitulo} numberOfLines={1}>
            {subtitulo}
          </Text>
        ) : null}
      </View>

      <BotaoCompacto.Provider value={true}>{acao}</BotaoCompacto.Provider>

      {comAtalhos ? (
        <>
          <Pressable
            onPress={() => setBuscando(true)}
            style={estilos.atalho}
            accessibilityRole="button"
            accessibilityLabel="Buscar tela, cliente, produto ou venda"
            hitSlop={4}
          >
            {/* Lupa desenhada com View, como o resto dos icones do app. */}
            <View style={estilos.lupaAro} />
            <View style={estilos.lupaCabo} />
          </Pressable>
          <Pressable
            onPress={abrirAvisos}
            style={estilos.atalho}
            accessibilityRole="button"
            accessibilityLabel={novos > 0 ? `Notificações: ${novos} nova(s)` : 'Notificações'}
            hitSlop={4}
          >
            <View style={estilos.sinoCorpo} />
            <View style={estilos.sinoBadalo} />
            {novos > 0 ? (
              <View style={estilos.badge}>
                <Text style={estilos.badgeTexto}>{novos > 99 ? '99+' : novos}</Text>
              </View>
            ) : null}
          </Pressable>
          <BuscaGlobal aberta={buscando} onFechar={() => setBuscando(false)} />
          <Avisos avisos={avisos} aberto={vendoAvisos} onFechar={() => setVendoAvisos(false)} />
        </>
      ) : null}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  botaoMenu: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  barra: {
    height: 2,
    borderRadius: 1,
    backgroundColor: cores.texto,
  },
  textos: { flex: 1, gap: 1 },
  atalho: {
    ...vidro.peca,
    width: 40,
    height: 40,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lupaAro: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: cores.texto,
    marginLeft: -3,
    marginTop: -3,
  },
  lupaCabo: {
    position: 'absolute',
    width: 2,
    height: 7,
    borderRadius: 1,
    backgroundColor: cores.texto,
    left: 23,
    top: 21,
    transform: [{ rotate: '-45deg' }],
  },
  sinoCorpo: {
    width: 14,
    height: 13,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 2,
    borderBottomWidth: 2,
    borderColor: cores.texto,
    marginTop: -3,
  },
  sinoBadalo: {
    position: 'absolute',
    width: 5,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: cores.texto,
    top: 25,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.erro,
  },
  badgeTexto: { fontSize: 10, fontWeight: peso.pesado, color: cores.fundo },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  subtitulo: { fontSize: fonte.micro, color: cores.textoFraco },
}))
