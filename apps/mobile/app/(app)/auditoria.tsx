import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Vazio } from '@/components/ui/Cartao'
import {
  listarPessoasDaTrilha,
  listarTrilha,
  ROTULO_ACAO,
  ROTULO_CANAL,
  ROTULO_ENTIDADE,
  type PessoaDaTrilha,
  type RegistroDaTrilha,
} from '@/lib/auditoria-api'
import { formatDateTime } from '@/lib/format'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/**
 * Auditoria — RNF-031, a mesma tela do web.
 *
 * Abre pelas pessoas que agiram na loja; tocar numa mostra a trilha dela, do
 * mais recente para o mais antigo: o que fez, em que, por qual canal e quando.
 */
export default function Auditoria() {
  const [pessoas, setPessoas] = useState<PessoaDaTrilha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pessoa, setPessoa] = useState<PessoaDaTrilha | null>(null)
  const [trilha, setTrilha] = useState<RegistroDaTrilha[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await listarPessoasDaTrilha()
      if (cancelado) return
      if (r.ok) setPessoas(r.dados)
      else setErro(r.erro)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const abrir = useCallback(async (p: PessoaDaTrilha, pag: number) => {
    setCarregando(true)
    const r = await listarTrilha({ actorId: p.actorId, page: pag })
    setCarregando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setPessoa(p)
    setPagina(pag)
    setTotal(r.dados.total)
    setTrilha((atual) => (pag === 1 ? r.dados.entries : [...atual, ...r.dados.entries]))
  }, [])

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={pessoa ? (pessoa.actorName ?? 'Sem nome') : 'Auditoria'}
        subtitulo={pessoa ? `${total} registro(s)` : 'Quem fez o quê na loja'}
        acao={
          pessoa ? (
            <Botao variante="secundario" onPress={() => setPessoa(null)}>
              Pessoas
            </Botao>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo}>
        {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}

        {pessoa === null ? (
          pessoas === null ? (
            <Vazio titulo="Carregando" descricao="Buscando quem agiu na loja." />
          ) : pessoas.length === 0 ? (
            <Vazio titulo="Nada registrado ainda" />
          ) : (
            pessoas.map((p) => (
              <Pressable
                key={p.actorId}
                style={estilos.cartao}
                onPress={() => void abrir(p, 1)}
                accessibilityRole="button"
              >
                <Text style={estilos.nome}>{p.actorName ?? 'Sem nome'}</Text>
                <Text style={estilos.apoio}>
                  {p.entries} registro(s) · último em {formatDateTime(p.lastActionAt)}
                </Text>
              </Pressable>
            ))
          )
        ) : (
          <>
            {trilha.map((r) => (
              <View key={r.id} style={estilos.cartao}>
                <Text style={estilos.nome}>
                  {ROTULO_ACAO[r.action] ?? r.action} · {ROTULO_ENTIDADE[r.entity] ?? r.entity}
                </Text>
                <Text style={estilos.apoio}>
                  {formatDateTime(r.occurredAt)} · {ROTULO_CANAL[r.channel] ?? r.channel}
                </Text>
              </View>
            ))}
            {trilha.length < total ? (
              <Botao
                variante="secundario"
                carregando={carregando}
                onPress={() => void abrir(pessoa, pagina + 1)}
                largura
              >
                Carregar mais
              </Botao>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.sm, paddingBottom: espaco.xxl },
  cartao: {
    gap: 2,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
})
