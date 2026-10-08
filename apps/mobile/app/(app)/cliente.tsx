import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Cabecalho from '@/components/Cabecalho'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { Cartao, Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  anonimizarCliente,
  buscarCliente,
  comprasDoCliente,
  consentimentoDoCliente,
  contatosDoCliente,
  excluirCliente,
  lancarContato,
  lancarPendencia,
  linkDoWhatsApp,
  pendenciasDoCliente,
  reativarCliente,
  registrarConsentimento,
  TIPOS_DE_CONTATO,
  type ClienteDaFicha,
  type CompraCliente,
  type ConsentimentoWhatsapp,
  type ContatoCliente,
  type PendenciaCliente,
  type TipoDeContato,
} from '@/lib/clientes-api'
import { describeDueDate, formatDate, formatDateTime, formatMoney, hoje } from '@/lib/format'
import { maskPhone } from '@/lib/validation'
import { centavosDoTexto } from '@/lib/valor'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** O contrato da anonimizacao pede 10 caracteres de motivo. */
const MOTIVO_MINIMO = 10

/**
 * A ficha do cliente — RF-011, a mesma do web.
 *
 * Dados, pendencias (com lancamento), compras, contatos, consentimento do
 * WhatsApp e os direitos do titular. Cada secao carrega por conta propria:
 * uma falha em contatos nao esconde o que o cliente deve.
 */
export default function ClienteScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [cliente, setCliente] = useState<ClienteDaFicha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendencias, setPendencias] = useState<PendenciaCliente[] | null>(null)
  const [compras, setCompras] = useState<CompraCliente[] | null>(null)
  const [contatos, setContatos] = useState<ContatoCliente[] | null>(null)
  const [consentimento, setConsentimento] = useState<ConsentimentoWhatsapp | null>(null)

  const carregar = useCallback(async () => {
    const [c, p, v, k, w] = await Promise.all([
      buscarCliente(id),
      pendenciasDoCliente(id),
      comprasDoCliente(id),
      contatosDoCliente(id),
      consentimentoDoCliente(id),
    ])
    if (!c.ok) {
      setErro(c.erro)
      return
    }
    setErro(null)
    setCliente(c.dados)
    setPendencias(p.ok ? p.dados : [])
    setCompras(v.ok ? v.dados : [])
    setContatos(k.ok ? k.dados : [])
    if (w.ok) setConsentimento(w.dados)
  }, [id])

  /* Voltar da edicao recarrega: o nome ou o telefone podem ter mudado. */
  useFocusEffect(
    useCallback(() => {
      void carregar()
    }, [carregar]),
  )

  if (erro !== null || cliente === null) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Cliente" />
        {erro !== null ? (
          <Vazio
            titulo="Não deu para abrir a ficha"
            descricao={erro}
            acao={<Botao onPress={() => void carregar()}>Tentar de novo</Botao>}
          />
        ) : (
          <Vazio titulo="Carregando" descricao="Abrindo a ficha do cliente." />
        )}
      </SafeAreaView>
    )
  }

  const whatsapp = linkDoWhatsApp(cliente.telefone)
  const vencido = (pendencias ?? [])
    .filter((p) => p.status === 'vencido')
    .reduce((soma, p) => soma + p.valor, 0)
  const anonimizado = cliente.anonimizadoEm !== null
  const excluido = cliente.excluidoEm !== null

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho
        titulo={cliente.nomeFantasia ?? cliente.nome}
        subtitulo={cliente.documento ?? 'sem documento'}
        acao={
          anonimizado ? undefined : (
            <Botao
              variante="secundario"
              onPress={() => router.push({ pathname: '/cliente-form', params: { id: cliente.id } })}
            >
              Editar
            </Botao>
          )
        }
      />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        {excluido ? (
          <Text style={estilos.aviso}>
            Cliente excluído em {formatDateTime(cliente.excluidoEm ?? '')}. Ele não aparece na lista
            nem nas buscas; o histórico continua aqui.
          </Text>
        ) : null}

        {/* Cliente de antes da DEC-025: continua valendo, e o aviso diz o que
            falta e leva direto para completar. */}
        {cliente.faltando.length > 0 && !anonimizado ? (
          <Pressable
            onPress={() => router.push({ pathname: '/cliente-form', params: { id: cliente.id } })}
            accessibilityRole="button"
          >
            <Text style={estilos.aviso}>
              Cadastro incompleto: falta {cliente.faltando.join(', ')}.{' '}
              <Text style={estilos.link}>Completar cadastro</Text>
            </Text>
          </Pressable>
        ) : null}

        <View style={estilos.numeros}>
          <Numero rotulo="Fiado em aberto" valor={formatMoney(cliente.saldoFiado)} />
          <Numero
            rotulo="Vencido"
            valor={formatMoney(vencido)}
            tom={vencido > 0 ? 'erro' : undefined}
          />
          <Numero
            rotulo="Limite do fiado"
            valor={cliente.limiteFiado > 0 ? formatMoney(cliente.limiteFiado) : 'sem limite'}
          />
        </View>

        <Cartao titulo="Contato">
          <Linha rotulo="Celular" valor={cliente.telefone ? maskPhone(cliente.telefone) : '—'} />
          <Linha rotulo="E-mail" valor={cliente.email ?? '—'} />
          <Linha
            rotulo="Endereço"
            valor={
              [
                cliente.endereco.logradouro,
                cliente.endereco.numero,
                cliente.endereco.bairro,
                cliente.endereco.cidade && `${cliente.endereco.cidade}/${cliente.endereco.uf}`,
              ]
                .filter(Boolean)
                .join(', ') || '—'
            }
          />
          {cliente.telefone ? (
            <View style={estilos.acoes}>
              <View style={estilos.flex}>
                <Botao
                  variante="secundario"
                  onPress={() => void Linking.openURL(`tel:${cliente.telefone}`)}
                  largura
                >
                  Ligar
                </Botao>
              </View>
              {whatsapp ? (
                <View style={estilos.flex}>
                  <Botao onPress={() => void Linking.openURL(whatsapp)} largura>
                    WhatsApp
                  </Botao>
                </View>
              ) : null}
            </View>
          ) : null}
        </Cartao>

        <SecaoPendencias
          clienteId={cliente.id}
          pendencias={pendencias}
          podeLancar={!anonimizado && !excluido}
          onLancada={() => void carregar()}
        />

        <Cartao titulo="Últimas compras">
          {compras === null || compras.length === 0 ? (
            <Text style={estilos.apoio}>Nenhuma compra registrada.</Text>
          ) : (
            compras.map((v) => (
              <Linha
                key={v.id}
                rotulo={`#${v.numero} · ${formatDate(v.data)} · ${v.itens} item(ns)`}
                valor={formatMoney(v.valor)}
              />
            ))
          )}
        </Cartao>

        <SecaoContatos
          clienteId={cliente.id}
          contatos={contatos}
          podeLancar={!anonimizado}
          onLancado={(c) => setContatos((atual) => [c, ...(atual ?? [])])}
        />

        {!anonimizado ? (
          <SecaoConsentimento
            clienteId={cliente.id}
            consentimento={consentimento}
            onMudou={setConsentimento}
          />
        ) : null}

        <SecaoPrivacidade
          cliente={cliente}
          onMudou={() => void carregar()}
          onExcluido={() => router.back()}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

function SecaoPendencias({
  clienteId,
  pendencias,
  podeLancar,
  onLancada,
}: {
  clienteId: string
  pendencias: PendenciaCliente[] | null
  podeLancar: boolean
  onLancada: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(hoje())
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const centavos = centavosDoTexto(valor)
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(vencimento)
  const pode =
    descricao.trim().length >= 2 && centavos !== null && centavos > 0 && dataValida && !enviando

  async function enviar() {
    if (centavos === null) return
    setEnviando(true)
    setErro(null)
    const r = await lancarPendencia(clienteId, {
      descricao,
      valorCentavos: centavos,
      vencimento,
    })
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setAberto(false)
    setDescricao('')
    setValor('')
    onLancada()
  }

  return (
    <Cartao
      titulo="Pendências"
      acao={
        podeLancar && !aberto ? (
          <Pressable onPress={() => setAberto(true)} accessibilityRole="button">
            <Text style={estilos.link}>+ Lançar</Text>
          </Pressable>
        ) : undefined
      }
    >
      {aberto ? (
        <View style={estilos.formulario}>
          <Campo rotulo="Do que se trata" valor={descricao} onChange={setDescricao} />
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Campo
                rotulo="Valor (R$)"
                valor={valor}
                onChange={setValor}
                tipoTeclado="decimal-pad"
              />
            </View>
            <View style={estilos.flex}>
              <Campo
                rotulo="Vence em"
                valor={vencimento}
                onChange={setVencimento}
                placeholder="AAAA-MM-DD"
                tipoTeclado="numeric"
                erro={vencimento !== '' && !dataValida ? 'Use AAAA-MM-DD.' : null}
              />
            </View>
          </View>
          {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={() => setAberto(false)} largura>
                Cancelar
              </Botao>
            </View>
            <View style={estilos.flex}>
              <Botao
                onPress={() => void enviar()}
                carregando={enviando}
                desabilitado={!pode}
                largura
              >
                Lançar
              </Botao>
            </View>
          </View>
        </View>
      ) : null}

      {pendencias === null || pendencias.length === 0 ? (
        <Text style={estilos.apoio}>Nada em aberto.</Text>
      ) : (
        pendencias.map((p) => (
          <View key={p.id} style={estilos.linha}>
            <View style={estilos.flex}>
              <Text style={estilos.linhaTexto} numberOfLines={1}>
                {p.referente}
              </Text>
              <Text style={estilos.apoio}>{describeDueDate(p.vencimento)}</Text>
            </View>
            <Etiqueta
              tom={p.status === 'vencido' ? 'erro' : p.status === 'parcial' ? 'atencao' : 'neutro'}
            >
              {formatMoney(p.valor)}
            </Etiqueta>
          </View>
        ))
      )}
    </Cartao>
  )
}

function SecaoContatos({
  clienteId,
  contatos,
  podeLancar,
  onLancado,
}: {
  clienteId: string
  contatos: ContatoCliente[] | null
  podeLancar: boolean
  onLancado: (c: ContatoCliente) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<TipoDeContato>('ligacao')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setEnviando(true)
    setErro(null)
    const r = await lancarContato(clienteId, { tipo, descricao })
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setAberto(false)
    setDescricao('')
    onLancado(r.dados)
  }

  const rotulo = (t: TipoDeContato) => TIPOS_DE_CONTATO.find((x) => x.valor === t)?.rotulo ?? t

  return (
    <Cartao
      titulo="Contatos"
      acao={
        podeLancar && !aberto ? (
          <Pressable onPress={() => setAberto(true)} accessibilityRole="button">
            <Text style={estilos.link}>+ Registrar</Text>
          </Pressable>
        ) : undefined
      }
    >
      {aberto ? (
        <View style={estilos.formulario}>
          <View style={estilos.chips}>
            {TIPOS_DE_CONTATO.map((t) => (
              <Pressable
                key={t.valor}
                onPress={() => setTipo(t.valor)}
                style={[estilos.chip, tipo === t.valor && estilos.chipAtivo]}
                accessibilityRole="button"
                accessibilityState={{ selected: tipo === t.valor }}
              >
                <Text style={[estilos.chipTexto, tipo === t.valor && estilos.chipTextoAtivo]}>
                  {t.rotulo}
                </Text>
              </Pressable>
            ))}
          </View>
          <Campo rotulo="O que foi conversado" valor={descricao} onChange={setDescricao} />
          {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={() => setAberto(false)} largura>
                Cancelar
              </Botao>
            </View>
            <View style={estilos.flex}>
              <Botao
                onPress={() => void enviar()}
                carregando={enviando}
                desabilitado={descricao.trim().length < 2}
                largura
              >
                Registrar
              </Botao>
            </View>
          </View>
        </View>
      ) : null}

      {contatos === null || contatos.length === 0 ? (
        <Text style={estilos.apoio}>Nenhum contato registrado.</Text>
      ) : (
        contatos.map((c) => (
          <View key={c.id} style={estilos.contato}>
            <Text style={estilos.apoio}>
              {formatDate(c.data)} · {rotulo(c.tipo)}
            </Text>
            <Text style={estilos.linhaTexto}>{c.descricao}</Text>
          </View>
        ))
      )}
    </Cartao>
  )
}

/**
 * Consentimento para mensagens no WhatsApp — RF-126.
 *
 * Tres estados: nunca se manifestou, autorizou, pediu para nao receber. Um
 * exige PEDIR o aceite; o outro PROIBE pedir de novo.
 */
function SecaoConsentimento({
  clienteId,
  consentimento,
  onMudou,
}: {
  clienteId: string
  consentimento: ConsentimentoWhatsapp | null
  onMudou: (c: ConsentimentoWhatsapp) => void
}) {
  const [enviando, setEnviando] = useState(false)

  async function registrar(decisao: 'autorizou' | 'recusou') {
    setEnviando(true)
    const r = await registrarConsentimento(clienteId, decisao)
    setEnviando(false)
    if (!r.ok) {
      Alert.alert('Não deu para registrar', r.erro)
      return
    }
    onMudou(r.dados)
  }

  const autorizou =
    consentimento?.autorizouEm !== null &&
    consentimento?.autorizouEm !== undefined &&
    (consentimento.recusouEm === null || consentimento.autorizouEm > consentimento.recusouEm)
  const recusou = !autorizou && consentimento?.recusouEm != null

  return (
    <Cartao titulo="Mensagens no WhatsApp">
      <Text style={estilos.apoio}>
        {autorizou
          ? `Autorizou em ${formatDateTime(consentimento?.autorizouEm ?? '')}.`
          : recusou
            ? `Pediu para não receber em ${formatDateTime(consentimento?.recusouEm ?? '')}. Não peça de novo.`
            : 'Ainda não se manifestou. Pergunte antes de enviar lembretes e cobranças.'}
      </Text>
      <View style={estilos.acoes}>
        {!autorizou ? (
          <View style={estilos.flex}>
            <Botao
              variante="secundario"
              onPress={() => void registrar('autorizou')}
              carregando={enviando}
              largura
            >
              Autorizou
            </Botao>
          </View>
        ) : null}
        {!recusou ? (
          <View style={estilos.flex}>
            <Botao
              variante="secundario"
              onPress={() => void registrar('recusou')}
              carregando={enviando}
              largura
            >
              Não quer receber
            </Botao>
          </View>
        ) : null}
      </View>
    </Cartao>
  )
}

/**
 * Excluir, reativar e anonimizar — RF-127, RF-128.
 *
 * Excluir tira da lista e volta; anonimizar e o pedido do titular (LGPD) e NAO
 * volta: nome, documento e contatos somem, vendas e titulos ficam sem dono
 * identificavel, porque a lei fiscal exige guardar.
 */
function SecaoPrivacidade({
  cliente,
  onMudou,
  onExcluido,
}: {
  cliente: ClienteDaFicha
  onMudou: () => void
  onExcluido: () => void
}) {
  const [anonimizando, setAnonimizando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const anonimizado = cliente.anonimizadoEm !== null
  const excluido = cliente.excluidoEm !== null

  function excluir() {
    Alert.alert(
      'Excluir cliente',
      'Ele sai da lista e das buscas. Vendas e pendências continuam no histórico, e dá para reativar depois.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              const r = await excluirCliente(cliente.id)
              if (!r.ok) Alert.alert('Não deu para excluir', r.erro)
              else onExcluido()
            })(),
        },
      ],
    )
  }

  async function reativar() {
    const r = await reativarCliente(cliente.id)
    if (!r.ok) Alert.alert('Não deu para reativar', r.erro)
    else onMudou()
  }

  async function anonimizar() {
    setEnviando(true)
    setErro(null)
    const r = await anonimizarCliente(cliente.id, motivo)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setAnonimizando(false)
    Alert.alert(
      'Dados anonimizados',
      `Feito em ${formatDateTime(r.dados.anonymizedAt)}. Use este registro para responder ao titular.`,
    )
    onMudou()
  }

  return (
    <Cartao titulo="Privacidade">
      {anonimizado ? (
        <Text style={estilos.apoio}>
          Dados pessoais anonimizados em {formatDateTime(cliente.anonimizadoEm ?? '')}, a pedido do
          titular. Vendas e títulos continuam, sem dono identificável.
        </Text>
      ) : anonimizando ? (
        <View style={estilos.formulario}>
          <Text style={estilos.aviso}>
            Irreversível: nome, documento, telefone, e-mail e endereço de {cliente.nome} somem. As
            vendas ficam, porque a lei fiscal exige guardar.
          </Text>
          <Campo
            rotulo="Motivo (vai para a trilha de auditoria)"
            valor={motivo}
            onChange={setMotivo}
            placeholder="Ex.: pedido do titular por WhatsApp em 05/10"
            dica={`Mínimo de ${MOTIVO_MINIMO} caracteres.`}
          />
          {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
          <View style={estilos.acoes}>
            <View style={estilos.flex}>
              <Botao variante="secundario" onPress={() => setAnonimizando(false)} largura>
                Voltar
              </Botao>
            </View>
            <View style={estilos.flex}>
              <Botao
                variante="perigo"
                onPress={() => void anonimizar()}
                carregando={enviando}
                desabilitado={motivo.trim().length < MOTIVO_MINIMO}
                largura
              >
                Anonimizar
              </Botao>
            </View>
          </View>
        </View>
      ) : (
        <View style={estilos.formulario}>
          {excluido ? (
            <Botao variante="secundario" onPress={() => void reativar()} largura>
              Reativar cliente
            </Botao>
          ) : (
            <Botao variante="secundario" onPress={excluir} largura>
              Excluir cliente
            </Botao>
          )}
          <Botao variante="perigo" onPress={() => setAnonimizando(true)} largura>
            Atender pedido de exclusão (LGPD)
          </Botao>
        </View>
      )}
    </Cartao>
  )
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: 'erro' }) {
  return (
    <View style={estilos.numero}>
      <Text style={estilos.numeroRotulo}>{rotulo}</Text>
      <Text style={[estilos.numeroValor, tom === 'erro' && estilos.numeroErro]}>{valor}</Text>
    </View>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={estilos.linha}>
      <Text style={[estilos.apoio, estilos.flex]}>{rotulo}</Text>
      <Text style={estilos.linhaValor}>{valor}</Text>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  flex: { flex: 1 },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  aviso: {
    padding: espaco.md,
    borderRadius: raio.sm,
    backgroundColor: cores.atencaoFundo,
    fontSize: fonte.micro,
    color: cores.atencao,
  },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  numeros: { flexDirection: 'row', gap: espaco.sm },
  numero: {
    ...vidro.peca,
    flex: 1,
    gap: 2,
    padding: espaco.md,
    borderRadius: raio.md,
  },
  numeroRotulo: { fontSize: 11, color: cores.textoFraco },
  numeroValor: { fontSize: fonte.pequeno, fontWeight: peso.pesado, color: cores.texto },
  numeroErro: { color: cores.erro },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: 4 },
  linhaTexto: { fontSize: fonte.pequeno, color: cores.texto },
  linhaValor: {
    fontSize: fonte.pequeno,
    fontWeight: peso.forte,
    color: cores.texto,
    flexShrink: 1,
  },
  acoes: { flexDirection: 'row', gap: espaco.sm },
  formulario: { gap: espaco.sm },
  contato: { gap: 2, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  chipAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  chipTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  chipTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
}))
