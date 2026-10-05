import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import { Cartao, Vazio } from '@/components/ui/Cartao'
import {
  aceitarConexao,
  encerrarConexao,
  listarConexoes,
  recusarConexao,
  type Conexao,
} from '@/lib/conexoes-api'
import { linkDoWhatsApp } from '@/lib/clientes-api'
import { maskPhone } from '@/lib/validation'
import { cores, espaco, fonte, peso } from '@/theme/tokens'

/**
 * Minhas conexoes — a mesma tela do web.
 *
 * Pedidos recebidos (aceitar ou recusar), enviados (cancelar) e as conexoes
 * aceitas, com o contato que so aparece quando os dois lados aceitam.
 */
export default function Conexoes() {
  const router = useRouter()
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [emAcao, setEmAcao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await listarConexoes()
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setConexoes(r.dados.connections)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function agir(id: string, acao: (id: string) => Promise<{ ok: boolean; erro?: string }>) {
    setEmAcao(id)
    const r = await acao(id)
    setEmAcao(null)
    if (!r.ok) {
      setErro(r.erro ?? 'Não deu certo.')
      return
    }
    await carregar()
  }

  const recebidos = (conexoes ?? []).filter(
    (c) => c.direction === 'received' && c.status === 'pending',
  )
  const enviados = (conexoes ?? []).filter((c) => c.direction === 'sent' && c.status === 'pending')
  const aceitas = (conexoes ?? []).filter((c) => c.status === 'accepted')

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Conexões"
        acao={
          <Botao variante="secundario" onPress={() => router.push('/fornecedores')}>
            Buscar
          </Botao>
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo}>
        {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}

        {conexoes === null ? (
          <Vazio titulo="Carregando" descricao="Buscando suas conexões." />
        ) : (
          <>
            <Cartao titulo="Pedidos recebidos">
              {recebidos.length === 0 ? (
                <Text style={estilos.apoio}>Ninguém pediu conexão com você ainda.</Text>
              ) : (
                recebidos.map((c) => (
                  <View key={c.id} style={estilos.linha}>
                    <Text style={[estilos.nome, estilos.flex]}>{c.otherCompanyName}</Text>
                    <Botao
                      variante="secundario"
                      onPress={() => void agir(c.id, recusarConexao)}
                      desabilitado={emAcao === c.id}
                    >
                      Recusar
                    </Botao>
                    <Botao
                      onPress={() => void agir(c.id, aceitarConexao)}
                      desabilitado={emAcao === c.id}
                    >
                      Aceitar
                    </Botao>
                  </View>
                ))
              )}
            </Cartao>

            <Cartao titulo="Pedidos enviados">
              {enviados.length === 0 ? (
                <Text style={estilos.apoio}>Você ainda não pediu conexão com ninguém.</Text>
              ) : (
                enviados.map((c) => (
                  <View key={c.id} style={estilos.linha}>
                    <View style={estilos.flex}>
                      <Text style={estilos.nome}>{c.otherCompanyName}</Text>
                      <Text style={estilos.apoio}>aguardando resposta</Text>
                    </View>
                    <Botao
                      variante="secundario"
                      onPress={() => void agir(c.id, encerrarConexao)}
                      desabilitado={emAcao === c.id}
                    >
                      Cancelar
                    </Botao>
                  </View>
                ))
              )}
            </Cartao>

            <Cartao titulo="Conectadas">
              {aceitas.length === 0 ? (
                <Text style={estilos.apoio}>
                  Quando um pedido for aceito dos dois lados, o contato aparece aqui.
                </Text>
              ) : (
                aceitas.map((c) => {
                  const whatsapp = c.contact ? linkDoWhatsApp(c.contact.phone) : null
                  return (
                    <View key={c.id} style={estilos.linha}>
                      <View style={estilos.flex}>
                        <Text style={estilos.nome}>{c.otherCompanyName}</Text>
                        {c.contact !== null ? (
                          <>
                            <Text style={estilos.apoio}>{maskPhone(c.contact.phone)}</Text>
                            <Text style={estilos.apoio}>
                              {[
                                c.contact.street &&
                                  `${c.contact.street}${c.contact.streetNumber ? `, ${c.contact.streetNumber}` : ''}`,
                                c.contact.neighborhood,
                                c.contact.city && `${c.contact.city}/${c.contact.state ?? ''}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </>
                        ) : null}
                      </View>
                      {whatsapp !== null ? (
                        <Botao onPress={() => void Linking.openURL(whatsapp)}>WhatsApp</Botao>
                      ) : null}
                    </View>
                  )
                })
              )}
            </Cartao>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1, gap: 2 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingVertical: espaco.sm,
  },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
})
