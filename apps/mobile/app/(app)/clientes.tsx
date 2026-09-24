import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import { linkDoWhatsApp, listarClientes, type ClienteDaLista } from '@/lib/clientes-api'
import { daysUntil, formatDate, formatMoney } from '@/lib/format'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import Botao from '@/components/ui/Botao'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'

/** Sem comprar ha mais que isto = cliente inativo. */
const INATIVO_APOS_DIAS = 60

/** Espera a pessoa parar de digitar antes de ir ao servidor. */
const ESPERA_DA_BUSCA_MS = 400

/**
 * Consulta rapida de clientes.
 *
 * Somente leitura de proposito: cadastro completo e edicao ficam no web.
 * O que se precisa no balcao e responder "quem e essa pessoa e ela deve
 * alguma coisa?" — e conseguir ligar ou mandar mensagem na hora.
 *
 * Busca e filtro sao do SERVIDOR (`GET /clientes`): filtrar no aparelho so
 * enxergaria a primeira pagina.
 */
export default function Clientes() {
  const [busca, setBusca] = useState('')
  const [soFiado, setSoFiado] = useState(false)
  const [lista, setLista] = useState<ClienteDaLista[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      const r = await listarClientes({ termo: busca.trim(), soFiado })
      if (cancelado) return
      setCarregando(false)
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      setErro(null)
      setLista(r.dados.clientes)
      setTotal(r.dados.total)
    }
    const t = setTimeout(() => void carregar(), ESPERA_DA_BUSCA_MS)

    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [busca, soFiado, tentativa])

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Clientes"
        subtitulo={
          carregando
            ? 'Carregando...'
            : `${total} ${soFiado ? 'com fiado em aberto' : 'cadastrados'}`
        }
      />

      <View style={estilos.barra}>
        <TextInput
          style={estilos.busca}
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nome ou CPF/CNPJ"
          placeholderTextColor={cores.textoFraco}
          accessibilityLabel="Buscar cliente"
        />
      </View>

      <View style={estilos.filtros}>
        <Pressable
          onPress={() => setSoFiado(false)}
          style={[estilos.chip, !soFiado && estilos.chipAtivo]}
        >
          <Text style={[estilos.chipTexto, !soFiado && estilos.chipTextoAtivo]}>Todos</Text>
        </Pressable>
        <Pressable
          onPress={() => setSoFiado(true)}
          style={[estilos.chip, soFiado && estilos.chipAtivo]}
        >
          <Text style={[estilos.chipTexto, soFiado && estilos.chipTextoAtivo]}>Com fiado</Text>
        </Pressable>
      </View>

      {erro ? (
        <Vazio
          titulo="Não deu para carregar"
          descricao={erro}
          acao={
            <Botao variante="secundario" onPress={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </Botao>
          }
        />
      ) : carregando && lista.length === 0 ? (
        <ActivityIndicator style={estilos.carregando} color={cores.acento} />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(c) => c.id}
          contentContainerStyle={estilos.lista}
          renderItem={({ item }) => <LinhaCliente cliente={item} />}
          ListEmptyComponent={
            <Vazio
              titulo="Nenhum cliente encontrado"
              descricao="Tente outro termo ou limpe o filtro."
              acao={
                <Botao
                  variante="secundario"
                  onPress={() => {
                    setBusca('')
                    setSoFiado(false)
                  }}
                >
                  Limpar
                </Botao>
              }
            />
          }
        />
      )}
    </SafeAreaView>
  )
}

function LinhaCliente({ cliente }: { cliente: ClienteDaLista }) {
  const inativo =
    cliente.ultimaCompra !== null && Math.abs(daysUntil(cliente.ultimaCompra)) > INATIVO_APOS_DIAS
  const whatsapp = linkDoWhatsApp(cliente.celular)

  return (
    <View style={estilos.cliente}>
      <View style={estilos.clienteTopo}>
        <View style={estilos.avatar}>
          <Text style={estilos.avatarTexto}>{cliente.nome.slice(0, 2).toUpperCase()}</Text>
        </View>

        <View style={estilos.clienteInfo}>
          <Text style={estilos.clienteNome} numberOfLines={1}>
            {cliente.nome}
          </Text>
          {cliente.documento ? <Text style={estilos.clienteDoc}>{cliente.documento}</Text> : null}
        </View>

        {cliente.saldoFiado > 0 ? (
          <Etiqueta tom="atencao">{`Fiado ${formatMoney(cliente.saldoFiado)}`}</Etiqueta>
        ) : (
          <Etiqueta tom="sucesso">Em dia</Etiqueta>
        )}
      </View>

      <View style={estilos.clienteRodape}>
        <Text style={estilos.clienteUltima}>
          {cliente.ultimaCompra
            ? `Última compra ${formatDate(cliente.ultimaCompra)}`
            : 'Nunca comprou'}
          {inativo ? ' · sumiu' : ''}
        </Text>

        {/* Abrir o WhatsApp direto: no balcao, cobrar ou avisar acontece
            na hora, nao depois. Sem telefone, sem botao. */}
        {whatsapp ? (
          <Pressable
            onPress={() => Linking.openURL(whatsapp)}
            style={estilos.acao}
            accessibilityRole="button"
            accessibilityLabel={`Enviar WhatsApp para ${cliente.nome}`}
          >
            <Text style={estilos.acaoTexto}>WhatsApp</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },

  cabecalho: { paddingHorizontal: espaco.lg, paddingTop: espaco.md, gap: 2 },
  titulo: { fontSize: fonte.display, fontWeight: peso.pesado, color: cores.texto },
  subtitulo: { fontSize: fonte.pequeno, color: cores.textoFraco },

  barra: { padding: espaco.lg, paddingBottom: espaco.sm },
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

  filtros: { flexDirection: 'row', gap: espaco.sm, paddingHorizontal: espaco.lg },
  chip: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  chipTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  chipTextoAtivo: { color: cores.acento, fontWeight: peso.forte },

  carregando: { marginTop: espaco.xl },
  lista: { padding: espaco.lg, gap: espaco.sm },
  cliente: {
    gap: espaco.md,
    padding: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    backgroundColor: cores.superficie,
  },
  clienteTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.primaria,
  },
  avatarTexto: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  clienteInfo: { flex: 1, gap: 2 },
  clienteNome: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  clienteDoc: { fontSize: fonte.micro, color: cores.textoFraco },

  clienteRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingTop: espaco.md,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  clienteUltima: { flex: 1, fontSize: fonte.micro, color: cores.textoFraco },
  acao: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    backgroundColor: cores.sucessoFundo,
  },
  acaoTexto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.acento },
})
