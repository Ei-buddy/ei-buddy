import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  criarCard,
  listarEquipe,
  type CardCrm,
  type MembroDaEquipe,
  type TipoCard,
} from '@/lib/crm-api'
import { dataDoTexto, formatDate, hoje, mascaraData } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { SeletorCliente } from '@/components/SeletoresDoPdv'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/**
 * Novo card do CRM — o mesmo formulario do web: titulo, tipo (pendencia ou
 * contato), cliente, data, responsavel e descricao.
 */
export default function NovoCardModal({
  onCriado,
  onFechar,
}: {
  onCriado: (card: CardCrm) => void
  onFechar: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipo, setTipo] = useState<TipoCard>('pendencia')
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)
  const [escolhendoCliente, setEscolhendoCliente] = useState(false)
  const [data, setData] = useState(formatDate(hoje()))
  const [equipe, setEquipe] = useState<MembroDaEquipe[]>([])
  const [responsavelId, setResponsavelId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const e = await listarEquipe()
      if (!cancelado) setEquipe(e)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function salvar() {
    const dia = dataDoTexto(data)
    if (titulo.trim().length < 2) return setErro('Dê um título ao card.')
    if (dia === null) return setErro('Data inválida.')
    setErro(null)
    setSalvando(true)
    const r = await criarCard({
      titulo,
      descricao,
      tipo,
      clienteId: cliente?.id ?? null,
      data: dia,
      responsavelId,
    })
    setSalvando(false)
    if (!r.ok) return setErro(r.erro)
    onCriado(r.dados)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <Pressable style={estilos.fora} onPress={onFechar} accessibilityLabel="Fechar" />
        <View style={estilos.folha}>
          <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
            <Text style={estilos.titulo}>Novo card</Text>

            <View style={estilos.chips}>
              {(
                [
                  ['pendencia', 'Pendência'],
                  ['contato', 'Contato'],
                ] as const
              ).map(([valor, rotulo]) => (
                <Pressable
                  key={valor}
                  onPress={() => setTipo(valor)}
                  style={[estilos.chip, tipo === valor && estilos.chipAtivo]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tipo === valor }}
                >
                  <Text style={[estilos.chipTexto, tipo === valor && estilos.chipTextoAtivo]}>
                    {rotulo}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Campo
              rotulo="Título"
              valor={titulo}
              onChange={setTitulo}
              placeholder="Ex.: ligar para cobrar"
            />

            <Pressable
              style={estilos.cliente}
              onPress={() => setEscolhendoCliente(true)}
              accessibilityRole="button"
            >
              <Text style={estilos.rotulo}>Cliente (opcional)</Text>
              <Text style={estilos.clienteNome}>{cliente?.nome ?? 'Escolher cliente'}</Text>
            </Pressable>

            <Campo
              rotulo="Para quando"
              valor={data}
              onChange={(v) => setData(mascaraData(v))}
              tipoTeclado="numeric"
              placeholder="DD/MM/AAAA"
            />

            {equipe.length > 0 ? (
              <>
                <Text style={estilos.rotulo}>Responsável</Text>
                <View style={estilos.chips}>
                  {[{ id: null, nome: 'Ninguém' }, ...equipe].map((m) => (
                    <Pressable
                      key={m.id ?? 'ninguem'}
                      onPress={() => setResponsavelId(m.id)}
                      style={[estilos.chip, responsavelId === m.id && estilos.chipAtivo]}
                    >
                      <Text
                        style={[
                          estilos.chipTexto,
                          responsavelId === m.id && estilos.chipTextoAtivo,
                        ]}
                      >
                        {m.nome}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <Campo rotulo="Descrição (opcional)" valor={descricao} onChange={setDescricao} />

            {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}

            <View style={estilos.acoes}>
              <View style={estilos.flex}>
                <Botao variante="secundario" onPress={onFechar} largura>
                  Voltar
                </Botao>
              </View>
              <View style={estilos.flex}>
                <Botao onPress={() => void salvar()} carregando={salvando} largura>
                  Criar
                </Botao>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>

      {escolhendoCliente ? (
        <SeletorCliente
          onEscolher={(c) => {
            setCliente({ id: c.id, nome: c.nome })
            setEscolhendoCliente(false)
          }}
          onFechar={() => setEscolhendoCliente(false)}
        />
      ) : null}
    </Modal>
  )
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  fora: { flex: 1 },
  folha: {
    ...vidro.painel,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    maxHeight: '92%',
    borderTopLeftRadius: raio.lg,
    borderTopRightRadius: raio.lg,
  },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
  titulo: { fontSize: fonte.titulo, fontWeight: peso.pesado, color: cores.texto },
  rotulo: { fontSize: fonte.pequeno, fontWeight: peso.medio, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  flex: { flex: 1 },
  acoes: { flexDirection: 'row', gap: espaco.md },
  cliente: {
    gap: espaco.xs,
    padding: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.sm,
    backgroundColor: cores.campo,
  },
  clienteNome: { fontSize: fonte.corpo, color: cores.texto },
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
})
