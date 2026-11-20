import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Text, View } from 'react-native'
import {
  cancelarNfse,
  estadoDaNfse,
  JUSTIFICATIVA_MINIMA,
  pedirNfse,
  type NfseDaVenda as Nfse,
} from '@/lib/vendas-api'
import { formatMoney } from '@/lib/format'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { cores, espaco, fonte, peso } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * A NFS-e dos servicos da venda — DEC-031, NR-242. A mesma do web.
 *
 * A NFS-e nacional e ASSINCRONA: pedida, fica "processando" ate o Ambiente
 * Nacional responder. A tela acompanha por um minuto e depois deixa o botao de
 * atualizar — a venda ja esta registrada, e "falhou" mandaria pedir de novo.
 */

const INTERVALO_MS = 4_000
const CONSULTAS_NA_TELA = 15

function abrir(url: string) {
  void Linking.openURL(url).catch(() => Alert.alert('NFS-e', 'Não deu para abrir o link.'))
}

export default function NfseDaVenda({
  vendaId,
  podeCancelar = true,
}: {
  vendaId: string
  podeCancelar?: boolean
}) {
  const [nfse, setNfse] = useState<Nfse | null | undefined>(undefined)
  const [carregou, setCarregou] = useState(false)
  const [pedindo, setPedindo] = useState(false)
  const [acompanhando, setAcompanhando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [processandoCancelamento, setProcessandoCancelamento] = useState(false)
  const ativo = useRef(true)

  useEffect(() => {
    ativo.current = true
    return () => {
      ativo.current = false
    }
  }, [])

  const acompanhar = useCallback(async () => {
    setAcompanhando(true)
    for (let i = 0; i < CONSULTAS_NA_TELA && ativo.current; i += 1) {
      await new Promise((r) => setTimeout(r, INTERVALO_MS))
      const atual = await estadoDaNfse(vendaId)
      if (!ativo.current) return
      if (atual !== undefined) setNfse(atual)
      if (atual !== undefined && atual !== null && atual.status !== 'processing') break
    }
    if (ativo.current) setAcompanhando(false)
  }, [vendaId])

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const atual = await estadoDaNfse(vendaId)
      if (cancelado) return
      setNfse(atual)
      setCarregou(true)
      if (atual?.status === 'processing') void acompanhar()
    })()
    return () => {
      cancelado = true
    }
  }, [vendaId, acompanhar])

  async function emitir() {
    setPedindo(true)
    setErro(null)
    const r = await pedirNfse(vendaId)
    setPedindo(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setNfse(r.nfse)
    if (r.nfse.status === 'processing') void acompanhar()
  }

  async function atualizar() {
    const atual = await estadoDaNfse(vendaId)
    if (atual !== undefined) setNfse(atual)
    if (atual?.status === 'processing') void acompanhar()
  }

  async function confirmarCancelamento() {
    setProcessandoCancelamento(true)
    const r = await cancelarNfse(vendaId, justificativa)
    setProcessandoCancelamento(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setNfse(r.nfse)
    setErro(null)
    setCancelando(false)
    setJustificativa('')
  }

  if (!carregou) {
    return (
      <View style={estilos.linha}>
        <ActivityIndicator color={cores.acento} />
        <Text style={estilos.apoio}>Consultando a NFS-e...</Text>
      </View>
    )
  }

  return (
    <View style={estilos.bloco}>
      <Text style={estilos.titulo}>NFS-e — serviços</Text>

      {nfse === null || nfse === undefined ? (
        <>
          <Text style={estilos.apoio}>
            {nfse === undefined
              ? 'Não deu para consultar a NFS-e agora.'
              : 'Para os serviços da venda (produtos com NBS no cadastro).'}
          </Text>
          <Botao onPress={() => void emitir()} carregando={pedindo} largura>
            {pedindo ? 'Pedindo...' : 'Emitir NFS-e'}
          </Botao>
        </>
      ) : nfse.status === 'processing' ? (
        <>
          <View style={estilos.linha}>
            {acompanhando ? <ActivityIndicator color={cores.acento} /> : null}
            <Text style={estilos.apoio}>
              Processando no Ambiente Nacional · {formatMoney(nfse.amountCents / 100)}
            </Text>
          </View>
          {acompanhando ? null : (
            <Botao variante="secundario" onPress={() => void atualizar()} largura>
              Atualizar
            </Botao>
          )}
        </>
      ) : nfse.status === 'authorized' ? (
        <>
          <Text style={estilos.ok}>NFS-e {nfse.number} emitida</Text>
          {nfse.accessKey !== null ? <Text style={estilos.apoio}>{nfse.accessKey}</Text> : null}
          {nfse.danfseUrl !== null ? (
            <Botao variante="secundario" onPress={() => abrir(nfse.danfseUrl!)} largura>
              Abrir PDF da NFS-e
            </Botao>
          ) : null}
          {nfse.publicUrl !== null ? (
            <Botao variante="fantasma" onPress={() => abrir(nfse.publicUrl!)} largura>
              Ver no portal
            </Botao>
          ) : null}
          {podeCancelar && !cancelando ? (
            <Botao variante="secundario" onPress={() => setCancelando(true)} largura>
              Cancelar NFS-e
            </Botao>
          ) : null}
          {cancelando ? (
            <>
              <Campo
                rotulo={`Justificativa (mínimo ${JUSTIFICATIVA_MINIMA} caracteres)`}
                valor={justificativa}
                onChange={setJustificativa}
              />
              <Botao
                variante="perigo"
                onPress={() => void confirmarCancelamento()}
                carregando={processandoCancelamento}
                desabilitado={justificativa.trim().length < JUSTIFICATIVA_MINIMA}
                largura
              >
                Confirmar cancelamento
              </Botao>
              <Botao variante="fantasma" onPress={() => setCancelando(false)} largura>
                Voltar
              </Botao>
            </>
          ) : null}
        </>
      ) : nfse.status === 'rejected' ? (
        <>
          <Text style={estilos.erro}>{nfse.rejection?.message ?? 'NFS-e recusada.'}</Text>
          <Botao onPress={() => void emitir()} carregando={pedindo} largura>
            {pedindo ? 'Pedindo...' : 'Tentar de novo'}
          </Botao>
        </>
      ) : (
        <Text style={estilos.apoio}>NFS-e {nfse.number ?? ''} cancelada.</Text>
      )}

      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  bloco: { gap: espaco.sm, marginTop: espaco.md },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  titulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco, flexShrink: 1 },
  ok: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
  erro: { fontSize: fonte.micro, color: cores.erro },
}))
