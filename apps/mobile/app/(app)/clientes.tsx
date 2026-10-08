import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import ComandosWhatsApp from '@/components/ComandosWhatsApp'
import { COMANDOS_CLIENTES } from '@/lib/comandos'
import Cabecalho from '@/components/Cabecalho'
import {
  linkDoWhatsApp,
  listarClientes,
  confirmarImportacaoClientes,
  listarInadimplentes,
  type ClienteDaLista,
  type ClienteInadimplente,
  type FiltroDeCliente,
} from '@/lib/clientes-api'
import { daysUntil, formatDate, formatMoney } from '@/lib/format'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import Botao from '@/components/ui/Botao'
import ImportarCsvModal from '@/components/ImportarCsvModal'
import { CAMPOS_CLIENTES, validarCliente } from '@/lib/campos-de-importacao'
import BotoesExportar from '@/components/BotoesExportar'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/** Sem comprar ha mais que isto = cliente inativo. */
const INATIVO_APOS_DIAS = 60

/** Espera a pessoa parar de digitar antes de ir ao servidor. */
const ESPERA_DA_BUSCA_MS = 400

type Filtro = FiltroDeCliente | 'inadimplentes'

const FILTROS: [Filtro, string][] = [
  ['todos', 'Todos'],
  ['fiado', 'Com fiado'],
  ['inadimplentes', 'Inadimplentes'],
  ['inativos', 'Sem comprar'],
]

/**
 * Clientes — RF-011, US-036, RF-071.
 *
 * Busca e filtro sao do SERVIDOR (`GET /clientes`): filtrar no aparelho so
 * enxergaria a primeira pagina. "Inadimplentes" e outra lista — quem tem
 * titulo vencido, do maior atraso para o menor — porque e a lista de cobranca.
 */
export default function Clientes() {
  const router = useRouter()
  const [busca, setBusca] = useState('')
  /* `?filtro=`: o sino (NR-162) abre a lista ja no recorte do aviso. */
  const { filtro: filtroDaRota } = useLocalSearchParams<{ filtro?: Filtro }>()
  const [filtro, setFiltro] = useState<Filtro>(filtroDaRota ?? 'todos')
  useEffect(() => {
    if (filtroDaRota !== undefined) setFiltro(filtroDaRota)
  }, [filtroDaRota])
  const [lista, setLista] = useState<ClienteDaLista[]>([])
  const [inadimplentes, setInadimplentes] = useState<ClienteInadimplente[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [importando, setImportando] = useState(false)

  /* Voltar da ficha ou do cadastro recarrega: o saldo ou o nome podem ter mudado. */
  useFocusEffect(
    useCallback(() => {
      setTentativa((n) => n + 1)
    }, []),
  )

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      if (filtro === 'inadimplentes') {
        const r = await listarInadimplentes()
        if (cancelado) return
        setCarregando(false)
        if (!r.ok) {
          setErro(r.erro)
          return
        }
        setErro(null)
        const termo = busca.trim().toLowerCase()
        setInadimplentes(
          termo === '' ? r.dados : r.dados.filter((c) => c.nome.toLowerCase().includes(termo)),
        )
        return
      }

      const r = await listarClientes({ termo: busca.trim(), filtro })
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
  }, [busca, filtro, tentativa])

  const abrir = (id: string) => router.push({ pathname: '/cliente', params: { id } })
  const devendo = inadimplentes.reduce((soma, c) => soma + c.vencido, 0)

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo="Clientes"
        subtitulo={
          carregando
            ? 'Carregando...'
            : filtro === 'inadimplentes'
              ? `${inadimplentes.length} com ${formatMoney(devendo)} vencido`
              : `${total} ${filtro === 'fiado' ? 'com fiado em aberto' : filtro === 'inativos' ? 'sem comprar há 60 dias' : 'cadastrados'}`
        }
        acao={
          <View style={estilos.acoesTopo}>
            <Botao variante="secundario" onPress={() => setImportando(true)}>
              Importar
            </Botao>
            <Botao onPress={() => router.push('/cliente-form')}>Novo</Botao>
          </View>
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
        {/* Exportar — NR-155: a busca e o filtro aplicados viajam junto. */}
        {filtro === 'inadimplentes' ? null : (
          <BotoesExportar lista="clientes" filtros={{ q: busca.trim(), filter: filtro }} />
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={estilos.filtrosRolagem}
        contentContainerStyle={estilos.filtros}
      >
        {FILTROS.map(([valor, rotulo]) => (
          <Pressable
            key={valor}
            onPress={() => setFiltro(valor)}
            style={[estilos.chip, filtro === valor && estilos.chipAtivo]}
            accessibilityRole="button"
            accessibilityState={{ selected: filtro === valor }}
          >
            <Text style={[estilos.chipTexto, filtro === valor && estilos.chipTextoAtivo]}>
              {rotulo}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
      ) : carregando && lista.length === 0 && inadimplentes.length === 0 ? (
        <ActivityIndicator style={estilos.carregando} color={cores.acento} />
      ) : filtro === 'inadimplentes' ? (
        <FlatList
          data={inadimplentes}
          keyExtractor={(c) => c.id}
          contentContainerStyle={estilos.lista}
          /* Via WhatsApp, como no web — NR-165. */
          ListFooterComponent={<ComandosWhatsApp comandos={COMANDOS_CLIENTES} />}
          renderItem={({ item }) => (
            <LinhaInadimplente cliente={item} onAbrir={() => abrir(item.id)} />
          )}
          ListEmptyComponent={
            <Vazio titulo="Ninguém em atraso" descricao="Nenhum cliente com título vencido." />
          }
        />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(c) => c.id}
          contentContainerStyle={estilos.lista}
          /* Via WhatsApp, como no web — NR-165. */
          ListFooterComponent={<ComandosWhatsApp comandos={COMANDOS_CLIENTES} />}
          renderItem={({ item }) => <LinhaCliente cliente={item} onAbrir={() => abrir(item.id)} />}
          ListEmptyComponent={
            busca === '' && filtro === 'todos' ? (
              <Vazio
                titulo="Nenhum cliente cadastrado"
                descricao="Cadastre o primeiro cliente. Leva menos de um minuto."
                acao={<Botao onPress={() => router.push('/cliente-form')}>Cadastrar</Botao>}
              />
            ) : (
              <Vazio
                titulo="Nenhum cliente encontrado"
                descricao="Tente outro termo ou limpe o filtro."
                acao={
                  <Botao
                    variante="secundario"
                    onPress={() => {
                      setBusca('')
                      setFiltro('todos')
                    }}
                  >
                    Limpar
                  </Botao>
                }
              />
            )
          }
        />
      )}

      {importando ? (
        <ImportarCsvModal
          titulo="Importar clientes"
          campos={CAMPOS_CLIENTES}
          validar={validarCliente}
          onConfirmar={confirmarImportacaoClientes}
          onFechar={() => {
            setImportando(false)
            setTentativa((n) => n + 1)
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

function LinhaInadimplente({
  cliente,
  onAbrir,
}: {
  cliente: ClienteInadimplente
  onAbrir: () => void
}) {
  const whatsapp = linkDoWhatsApp(cliente.celular)
  return (
    <Pressable style={estilos.cliente} onPress={onAbrir} accessibilityRole="button">
      <View style={estilos.clienteTopo}>
        <View style={estilos.clienteInfo}>
          <Text style={estilos.clienteNome} numberOfLines={1}>
            {cliente.nome}
          </Text>
          <Text style={estilos.clienteDoc}>
            {cliente.titulos} título(s) · venceu em {formatDate(cliente.venceuEm)}
          </Text>
        </View>
        <Etiqueta tom="erro">{formatMoney(cliente.vencido)}</Etiqueta>
      </View>
      <View style={estilos.clienteRodape}>
        <Text style={estilos.clienteUltima}>{cliente.diasDeAtraso} dia(s) de atraso</Text>
        {whatsapp ? (
          <Pressable
            onPress={() => void Linking.openURL(whatsapp)}
            style={estilos.acao}
            accessibilityRole="button"
            accessibilityLabel={`Enviar WhatsApp para ${cliente.nome}`}
          >
            <Text style={estilos.acaoTexto}>Cobrar no WhatsApp</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

function LinhaCliente({ cliente, onAbrir }: { cliente: ClienteDaLista; onAbrir: () => void }) {
  const inativo =
    cliente.ultimaCompra !== null && Math.abs(daysUntil(cliente.ultimaCompra)) > INATIVO_APOS_DIAS
  const whatsapp = linkDoWhatsApp(cliente.celular)

  return (
    <Pressable style={estilos.cliente} onPress={onAbrir} accessibilityRole="button">
      <View style={estilos.clienteTopo}>
        <View style={estilos.avatar}>
          <Text style={estilos.avatarTexto}>{cliente.nome.slice(0, 2).toUpperCase()}</Text>
        </View>

        <View style={estilos.clienteInfo}>
          <Text style={estilos.clienteNome} numberOfLines={1}>
            {cliente.nome}
          </Text>
          {cliente.documento ? <Text style={estilos.clienteDoc}>{cliente.documento}</Text> : null}
          {/* Cliente de antes da DEC-025 pode estar sem celular ou endereco. */}
          {cliente.faltando.length > 0 ? (
            <Text style={estilos.incompleto}>Cadastro incompleto</Text>
          ) : null}
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
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  acoesTopo: { flexDirection: 'row', gap: espaco.sm },

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

  filtrosRolagem: { flexGrow: 0 },
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
    ...vidro.peca,
    gap: espaco.md,
    padding: espaco.lg,
    borderRadius: raio.md,
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
  incompleto: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.atencao },

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
