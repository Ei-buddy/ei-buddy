import { useEffect, useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import Botao from '@/components/ui/Botao'
import { Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  carregarCasamentoAutomatico,
  confirmarConciliacoes,
  paresMarcados,
  resumoDaConfirmacao,
  semDuvida,
  type ParAutomatico,
} from '@/lib/conciliacao-api'
import { formatDate, formatMoney } from '@/lib/format'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Conferencia lado a lado — DEC-026, o par do web.
 *
 * Cada cartao e um par: em cima a linha do extrato (na ordem do banco), embaixo
 * a conta que o servidor casou com ela — no celular, "lado a lado" vira um em
 * cima do outro, no mesmo cartao. Nada vem marcado: quem confere e a pessoa.
 * No fim, a baixa de todos os confirmados, na ordem do extrato.
 */
export default function ConferenciaDoExtrato({
  contaDoExtrato,
  onPronto,
  onErro,
}: {
  contaDoExtrato: string | null
  onPronto: (mensagem: string) => void
  onErro: (mensagem: string) => void
}) {
  const [pares, setPares] = useState<ParAutomatico[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await carregarCasamentoAutomatico()
      if (cancelado) return
      if (r.ok) setPares(r.dados.pairs)
      else setErro(r.erro)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const alternar = (id: string) =>
    setMarcados((m) => {
      const novo = new Set(m)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })

  if (erro !== null) return <Vazio titulo="Não deu para casar o extrato" descricao={erro} />
  if (pares === null)
    return <Vazio titulo="Casando o extrato" descricao="Procurando as contas que batem." />

  const casados = pares.filter((p) => p.suggestion !== null)
  const semDuvidas = casados.filter(semDuvida)
  const escolhidos = paresMarcados(pares, marcados)

  async function confirmar() {
    if (contaDoExtrato === null || escolhidos.length === 0) return
    setConfirmando(true)
    const r = await confirmarConciliacoes(contaDoExtrato, escolhidos)
    setConfirmando(false)
    if (!r.ok) return onErro(r.erro)
    onPronto(resumoDaConfirmacao(r.dados))
  }

  return (
    <View style={estilos.bloco}>
      <Text style={estilos.apoio}>
        {casados.length} de {pares.length} linhas do extrato têm uma conta que bate. Confira cada
        par e marque os certos: ao confirmar, cada um recebe a baixa na data do banco, na ordem do
        extrato.
      </Text>
      <View style={estilos.linha}>
        <Botao
          variante="secundario"
          onPress={() => setMarcados(new Set(semDuvidas.map((p) => p.transaction.id)))}
          desabilitado={semDuvidas.length === 0 || confirmando}
        >
          {`Marcar os sem dúvida (${semDuvidas.length})`}
        </Botao>
        {marcados.size > 0 ? (
          <Pressable onPress={() => setMarcados(new Set())} accessibilityRole="button" hitSlop={8}>
            <Text style={estilos.link}>Desmarcar</Text>
          </Pressable>
        ) : null}
      </View>

      {pares.map((p) => {
        const t = p.transaction
        const s = p.suggestion
        const marcado = marcados.has(t.id)
        return (
          <View key={t.id} style={[estilos.par, marcado && estilos.parMarcado]}>
            <View style={estilos.lado}>
              <Text style={estilos.rotulo}>Extrato · {formatDate(t.postedOn)}</Text>
              <Text style={estilos.nome} numberOfLines={2}>
                {t.description}
              </Text>
              <Text style={[estilos.valor, t.direction === 'debit' && estilos.saida]}>
                {t.direction === 'debit' ? '− ' : '+ '}
                {formatMoney(t.amountCents / 100)}
              </Text>
            </View>
            <View style={[estilos.lado, estilos.ladoConta]}>
              {s === null ? (
                <Text style={estilos.apoio}>
                  Nada bate. Abra a linha na lista para escolher ou criar o lançamento.
                </Text>
              ) : (
                <>
                  <Text style={estilos.rotulo}>Conta · vence {formatDate(s.entry.dueDate)}</Text>
                  <Text style={estilos.nome}>{s.entry.counterparty}</Text>
                  <Text style={estilos.apoio} numberOfLines={1}>
                    {s.entry.description}
                  </Text>
                  <View style={estilos.selos}>
                    <Etiqueta
                      tom={s.daysApart === 0 && s.alternatives === 0 ? 'sucesso' : 'atencao'}
                    >
                      {s.daysApart === 0 ? 'mesmo dia' : `${s.daysApart} dia(s) de diferença`}
                    </Etiqueta>
                    {s.alternatives > 0 ? (
                      <Etiqueta tom="atencao">{`${s.alternatives} outra(s) do mesmo valor`}</Etiqueta>
                    ) : null}
                  </View>
                </>
              )}
            </View>
            {s !== null ? (
              <View style={estilos.confere}>
                <Text style={estilos.apoio}>Confere</Text>
                <Switch
                  value={marcado}
                  onValueChange={() => alternar(t.id)}
                  disabled={confirmando}
                  accessibilityLabel={`Confirmar ${t.description} de ${formatDate(t.postedOn)}`}
                />
              </View>
            ) : null}
          </View>
        )
      })}

      <Text style={estilos.apoio}>
        {contaDoExtrato === null
          ? 'Escolha a conta do extrato para dar baixa.'
          : `As baixas vão para ${contaDoExtrato}.`}
      </Text>
      <Botao
        onPress={() => void confirmar()}
        carregando={confirmando}
        desabilitado={escolhidos.length === 0 || contaDoExtrato === null}
        largura
      >
        {escolhidos.length === 1
          ? 'Dar baixa no confirmado'
          : `Dar baixa nos ${escolhidos.length} confirmados`}
      </Botao>
    </View>
  )
}

const estilos = criarEstilos(() => ({
  bloco: { gap: espaco.md },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, flexWrap: 'wrap' },
  par: {
    ...vidro.peca,
    padding: espaco.md,
    borderRadius: raio.md,
    gap: espaco.sm,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  parMarcado: { borderColor: cores.acento },
  lado: { gap: 2 },
  ladoConta: { paddingTop: espaco.sm, borderTopWidth: 1, borderTopColor: cores.borda },
  rotulo: { fontSize: fonte.micro, color: cores.textoFraco, fontWeight: peso.forte },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
  valor: { fontSize: fonte.corpo, fontWeight: peso.pesado, color: cores.sucesso },
  saida: { color: cores.erro },
  selos: { flexDirection: 'row', gap: espaco.sm, flexWrap: 'wrap', marginTop: espaco.xs },
  confere: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: espaco.sm,
  },
  link: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },
}))
