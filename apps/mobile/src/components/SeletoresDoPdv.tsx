import { useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { listarClientes, type ClienteDaLista } from '@/lib/clientes-api'
import { listarCatalogo, type ProdutoDoCatalogo } from '@/lib/produtos-api'
import type { Desconto, TipoDesconto } from '@/lib/vendas-api'
import { centavosDoTexto } from '@/lib/valor'
import { formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/**
 * As folhas do PDV no celular: escolher cliente, achar produto pelo nome e
 * dar desconto — o que o web ja fazia e o balcao do celular nao tinha.
 */

function Folha({
  titulo,
  onFechar,
  children,
  rolar = true,
}: {
  titulo: string
  onFechar: () => void
  children: ReactNode
  /** Lista com `FlatList` propria nao pode ficar dentro de outro scroll. */
  rolar?: boolean
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable
          style={estilos.foraDaFolha}
          onPress={onFechar}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={estilos.folha}>
          <Text style={estilos.titulo}>{titulo}</Text>
          {rolar ? (
            <ScrollView
              contentContainerStyle={estilos.conteudo}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[estilos.conteudo, estilos.conteudoFixo]}>{children}</View>
          )}
        </View>
      </View>
    </Modal>
  )
}

/**
 * Busca com espera: so consulta quando a digitacao para, para a resposta de
 * "Mar" nao chegar depois da de "Maria" e apagar o resultado certo.
 */
function useBusca<T>(
  buscar: (termo: string) => Promise<{ ok: true; itens: T[] } | { ok: false; erro: string }>,
) {
  const [termo, setTermo] = useState('')
  const [itens, setItens] = useState<T[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(() => {
      void (async () => {
        setCarregando(true)
        const r = await buscar(termo.trim())
        if (cancelado) return
        setCarregando(false)
        if (!r.ok) {
          setErro(r.erro)
          return
        }
        setErro(null)
        setItens(r.itens)
      })()
    }, 300)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [termo, buscar])

  return { termo, setTermo, itens, carregando, erro }
}

function CaixaDeBusca({
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
      autoFocus
      accessibilityLabel={placeholder}
    />
  )
}

function EstadoDaBusca({
  carregando,
  erro,
  vazio,
}: {
  carregando: boolean
  erro: string | null
  vazio: string
}) {
  if (carregando) return <ActivityIndicator color={cores.acento} style={estilos.carregando} />
  return <Text style={erro ? estilos.erro : estilos.apoio}>{erro ?? vazio}</Text>
}

const buscarClientes = async (termo: string) => {
  const r = await listarClientes({ termo })
  return r.ok ? { ok: true as const, itens: r.dados.clientes } : r
}

export function SeletorCliente({
  onEscolher,
  onFechar,
}: {
  onEscolher: (cliente: ClienteDaLista) => void
  onFechar: () => void
}) {
  const { termo, setTermo, itens, carregando, erro } = useBusca(buscarClientes)

  return (
    <Folha titulo="Cliente da venda" onFechar={onFechar} rolar={false}>
      <CaixaDeBusca valor={termo} onChange={setTermo} placeholder="Nome, CPF/CNPJ ou celular" />
      <FlatList
        data={carregando ? [] : itens}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EstadoDaBusca carregando={carregando} erro={erro} vazio="Nenhum cliente encontrado." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={estilos.linha}
            onPress={() => onEscolher(item)}
            accessibilityRole="button"
          >
            <View style={estilos.linhaInfo}>
              <Text style={estilos.linhaNome} numberOfLines={1}>
                {item.nome}
              </Text>
              <Text style={estilos.apoio}>{item.documento ?? item.celular ?? 'sem documento'}</Text>
            </View>
            {item.saldoFiado > 0 ? (
              <Text style={estilos.linhaAlerta}>deve {formatMoney(item.saldoFiado)}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </Folha>
  )
}

const buscarProdutos = async (termo: string) => {
  const r = await listarCatalogo({ termo })
  return r.ok ? { ok: true as const, itens: r.dados.produtos } : r
}

export function SeletorProduto({
  onEscolher,
  onFechar,
}: {
  onEscolher: (produto: ProdutoDoCatalogo) => void
  onFechar: () => void
}) {
  const { termo, setTermo, itens, carregando, erro } = useBusca(buscarProdutos)

  return (
    <Folha titulo="Adicionar produto" onFechar={onFechar} rolar={false}>
      <CaixaDeBusca valor={termo} onChange={setTermo} placeholder="Nome ou código do produto" />
      <FlatList
        data={carregando ? [] : itens}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EstadoDaBusca carregando={carregando} erro={erro} vazio="Nenhum produto encontrado." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={[estilos.linha, item.estoque <= 0 && estilos.linhaApagada]}
            onPress={() => onEscolher(item)}
            accessibilityRole="button"
          >
            <View style={estilos.linhaInfo}>
              <Text style={estilos.linhaNome} numberOfLines={2}>
                {item.descricao}
              </Text>
              <Text style={item.estoque <= 0 ? estilos.linhaAlerta : estilos.apoio}>
                {item.estoque <= 0 ? 'Sem estoque' : `${item.estoque} em estoque`} · {item.codigo}
              </Text>
            </View>
            <Text style={estilos.linhaValor}>{formatMoney(item.precoVenda)}</Text>
          </Pressable>
        )}
      />
    </Folha>
  )
}

export function DescontoModal({
  atual,
  subtotal,
  onAplicar,
  onFechar,
}: {
  atual: Desconto | null
  subtotal: number
  onAplicar: (desconto: Desconto | null) => void
  onFechar: () => void
}) {
  const [tipo, setTipo] = useState<TipoDesconto>(atual?.tipo ?? 'percentual')
  const [texto, setTexto] = useState(atual ? String(atual.quantia).replace('.', ',') : '')

  const centavos = centavosDoTexto(texto)
  const quantia = centavos === null ? null : centavos / 100
  const invalido =
    quantia === null || quantia < 0 || (tipo === 'percentual' ? quantia > 100 : quantia > subtotal)

  return (
    <Folha titulo="Desconto" onFechar={onFechar}>
      <View style={estilos.alternador}>
        {(
          [
            ['percentual', '%'],
            ['valor', 'R$'],
          ] as const
        ).map(([valor, rotulo]) => (
          <Pressable
            key={valor}
            onPress={() => setTipo(valor)}
            style={[estilos.opcao, tipo === valor && estilos.opcaoAtiva]}
            accessibilityRole="button"
            accessibilityState={{ selected: tipo === valor }}
          >
            <Text style={[estilos.opcaoTexto, tipo === valor && estilos.opcaoTextoAtivo]}>
              {rotulo}
            </Text>
          </Pressable>
        ))}
      </View>

      <Campo
        rotulo={tipo === 'percentual' ? 'Percentual de desconto' : 'Valor do desconto'}
        valor={texto}
        onChange={setTexto}
        tipoTeclado="decimal-pad"
        placeholder={tipo === 'percentual' ? 'Ex.: 10' : 'Ex.: 5,00'}
        erro={
          texto !== '' && invalido
            ? tipo === 'percentual'
              ? 'Entre 0 e 100%.'
              : 'Maior que o subtotal.'
            : null
        }
        dica={`Subtotal: ${formatMoney(subtotal)}`}
      />

      <View style={estilos.acoes}>
        {atual !== null ? (
          <Botao variante="secundario" onPress={() => onAplicar(null)} largura>
            Tirar desconto
          </Botao>
        ) : null}
        <Botao
          onPress={() => quantia !== null && onAplicar(quantia > 0 ? { tipo, quantia } : null)}
          desabilitado={invalido}
          largura
        >
          Aplicar
        </Botao>
      </View>
    </Folha>
  )
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  foraDaFolha: { flex: 1 },
  folha: {
    ...vidro.painel,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    maxHeight: '88%',
    paddingTop: espaco.lg,
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  titulo: {
    paddingHorizontal: espaco.lg,
    fontSize: fonte.titulo,
    fontWeight: peso.pesado,
    color: cores.texto,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  conteudoFixo: { height: 480 },
  busca: {
    minHeight: 48,
    paddingHorizontal: espaco.lg,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
    fontSize: fonte.corpo,
    color: cores.texto,
  },
  carregando: { marginTop: espaco.lg },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.md,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  linhaApagada: { opacity: 0.5 },
  linhaInfo: { flex: 1, gap: 2 },
  linhaNome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  linhaValor: { fontSize: fonte.corpo, fontWeight: peso.forte, color: cores.texto },
  linhaAlerta: { fontSize: fonte.micro, fontWeight: peso.forte, color: cores.atencao },
  alternador: { flexDirection: 'row', gap: espaco.sm },
  opcao: {
    flex: 1,
    paddingVertical: espaco.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
  },
  opcaoAtiva: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  opcaoTexto: { fontSize: fonte.pequeno, color: cores.textoFraco },
  opcaoTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
  acoes: { flexDirection: 'row', gap: espaco.md },
})
