import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

export function Cartao({
  titulo,
  acao,
  children,
}: {
  titulo?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <View style={estilos.cartao}>
      {titulo || acao ? (
        <View style={estilos.cabecalho}>
          {titulo ? <Text style={estilos.titulo}>{titulo}</Text> : <View />}
          {acao}
        </View>
      ) : null}
      {children}
    </View>
  )
}

export function Etiqueta({
  children,
  tom = 'neutro',
}: {
  children: ReactNode
  tom?: 'neutro' | 'sucesso' | 'atencao' | 'erro'
}) {
  return (
    <View style={[estilos.etiqueta, estilos[`etiqueta_${tom}`]]}>
      <Text style={[estilos.etiquetaTexto, estilos[`etiquetaTexto_${tom}`]]}>{children}</Text>
    </View>
  )
}

export function Vazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: string
  acao?: ReactNode
}) {
  return (
    <View style={estilos.vazio}>
      <Text style={estilos.vazioTitulo}>{titulo}</Text>
      {descricao ? <Text style={estilos.vazioTexto}>{descricao}</Text> : null}
      {acao}
    </View>
  )
}

const estilos = StyleSheet.create({
  /* Cartao de vidro — NR-160, o mesmo do web. */
  cartao: {
    ...vidro.cartao,
    padding: espaco.lg,
    borderRadius: raio.lg,
    gap: espaco.md,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
  },
  titulo: {
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
  },

  etiqueta: {
    alignSelf: 'flex-start',
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.xs,
    borderRadius: raio.pill,
    /* Pilula de vidro tingida: a cor do estado bem suave, fio de luz no topo. */
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
  },
  etiqueta_neutro: { backgroundColor: 'rgba(255,255,255,0.07)' },
  etiqueta_sucesso: { backgroundColor: cores.sucessoFundo },
  etiqueta_atencao: { backgroundColor: cores.atencaoFundo },
  etiqueta_erro: { backgroundColor: cores.erroFundo },

  etiquetaTexto: { fontSize: fonte.micro, fontWeight: peso.forte },
  etiquetaTexto_neutro: { color: cores.textoFraco },
  etiquetaTexto_sucesso: { color: cores.acento },
  etiquetaTexto_atencao: { color: cores.atencao },
  etiquetaTexto_erro: { color: cores.erro },

  vazio: {
    alignItems: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.xxl,
    paddingHorizontal: espaco.lg,
  },
  vazioTitulo: {
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
    textAlign: 'center',
  },
  vazioTexto: {
    fontSize: fonte.pequeno,
    color: cores.textoFraco,
    textAlign: 'center',
    lineHeight: 20,
  },
})
