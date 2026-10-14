import { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import {
  aceitarDocumentosLegais,
  buscarPendenciasLegais,
  buscarVersoesLegais,
  CAMINHO_DO_DOCUMENTO,
  DOCUMENTOS,
  type PendenciaLegal,
  ROTULO_DO_DOCUMENTO,
  type TipoDeDocumento,
} from '@/lib/legal-api'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Privacidade e Termos — RF-01, RF-03, RF-05.
 *
 * ## Por que abre no navegador em vez de mostrar o texto aqui
 *
 * O texto e o mesmo do site, e ter uma copia dentro do aplicativo criaria um
 * jeito de a pessoa ler uma versao que nao esta mais em vigor — um aparelho
 * que nao atualizou o app mostraria a clausula antiga e registraria aceite
 * dela. Com uma fonte so, o que se le e sempre o que esta publicado, e o
 * aceite aponta para a versao certa.
 */

/** Base do site. O mesmo motivo de `EXPO_PUBLIC_` em `api.ts`. */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3100'

export default function PrivacidadeETermos() {
  const [versoes, setVersoes] = useState<Record<string, string>>({})
  const [pendentes, setPendentes] = useState<PendenciaLegal[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [v, p] = await Promise.all([buscarVersoesLegais(), buscarPendenciasLegais()])
    if (v.ok) setVersoes(v.dados.versoes)
    if (p.ok) setPendentes(p.dados.pendentes)
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function aceitar() {
    setEnviando(true)
    setErro(null)

    const r = await aceitarDocumentosLegais()

    setEnviando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    setPendentes(r.dados.pendentes)
  }

  const abrir = (tipo: TipoDeDocumento) =>
    void Linking.openURL(`${WEB_URL}${CAMINHO_DO_DOCUMENTO[tipo]}`)

  const estaPendente = (tipo: TipoDeDocumento) => pendentes.some((p) => p.type === tipo)

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Privacidade e Termos" subtitulo="Documentos em vigor e seus direitos" />

      <ScrollView contentContainerStyle={estilos.conteudo}>
        {pendentes.length === 0 ? null : (
          <View style={estilos.aviso}>
            <Text style={estilos.avisoTitulo}>
              {pendentes.some((p) => p.versaoAceitaAntes !== undefined)
                ? 'Atualizamos nossos documentos'
                : 'Falta aceitar nossos documentos'}
            </Text>
            <Text style={estilos.avisoTexto}>
              Leia {pendentes.map((p) => ROTULO_DO_DOCUMENTO[p.type]).join(' e ')} e confirme
              abaixo.
            </Text>
            {erro === null ? null : <Text style={estilos.erro}>{erro}</Text>}
            <Botao onPress={() => void aceitar()} carregando={enviando} largura>
              Li e aceito
            </Botao>
          </View>
        )}

        <View style={estilos.cartao}>
          <Text style={estilos.secao}>Documentos em vigor</Text>

          {DOCUMENTOS.map((tipo) => (
            <Pressable key={tipo} style={estilos.item} onPress={() => abrir(tipo)}>
              <Text style={estilos.documento}>{ROTULO_DO_DOCUMENTO[tipo]}</Text>
              <Text style={estilos.meta}>
                {carregando
                  ? ' '
                  : `${versoes[tipo] === undefined ? '' : `Versão ${versoes[tipo]} · `}${
                      estaPendente(tipo) ? 'Aceite pendente' : 'Aceito'
                    }`}
              </Text>
            </Pressable>
          ))}

          <Pressable
            style={estilos.item}
            onPress={() => void Linking.openURL(`${WEB_URL}/politica-de-cookies`)}
          >
            <Text style={estilos.documento}>Política de Cookies</Text>
            <Text style={estilos.meta}>Inventário gerado do código</Text>
          </Pressable>
        </View>

        <View style={estilos.cartao}>
          <Text style={estilos.secao}>Seus direitos (LGPD art. 18)</Text>
          <Text style={estilos.texto}>
            Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados, além de
            revogar consentimentos. A exportação completa está no painel web, em Empresa; pedidos de
            exclusão e revogação passam pelo Suporte.
          </Text>
          {/* O contato do encarregado ainda nao existe (DEC-016/QST-004). Dizer
              isso em voz alta e melhor que inventar um e-mail que nao responde. */}
          <Text style={estilos.pendenteNota}>
            Pendente: o contato do encarregado (DPO) será publicado aqui e na Política de
            Privacidade assim que a revisão jurídica for concluída.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },

  aviso: {
    ...vidro.peca,
    gap: espaco.sm,
    padding: espaco.lg,
    borderRadius: raio.lg,
    borderColor: cores.atencao,
  },
  avisoTitulo: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.texto },
  avisoTexto: { fontSize: fonte.corpo, color: cores.textoFraco, lineHeight: 20 },
  erro: { fontSize: fonte.corpo, color: cores.erro },

  cartao: {
    ...vidro.peca,
    gap: espaco.sm,
    padding: espaco.lg,
    borderRadius: raio.lg,
  },
  secao: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.texto },

  item: {
    paddingVertical: espaco.sm,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
    gap: 2,
  },
  documento: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.acento },
  meta: { fontSize: fonte.corpo, color: cores.textoFraco },

  texto: { fontSize: fonte.corpo, color: cores.textoFraco, lineHeight: 20 },
  pendenteNota: {
    marginTop: espaco.xs,
    padding: espaco.sm,
    borderRadius: raio.md,
    borderLeftWidth: 3,
    borderLeftColor: cores.atencao,
    backgroundColor: cores.fundo,
    fontSize: fonte.corpo,
    color: cores.textoFraco,
    lineHeight: 20,
  },
}))
