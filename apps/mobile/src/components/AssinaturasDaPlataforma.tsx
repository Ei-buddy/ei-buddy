import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Cartao, Etiqueta, Vazio } from '@/components/ui/Cartao'
import {
  contarPorGrupo,
  dataQueImporta,
  estaNoGrupo,
  GRUPOS_DE_ASSINATURA,
  ROTULO_DO_ESTADO,
  TOM_DO_ESTADO,
  type GrupoDeAssinatura,
  type Tom,
} from '@/lib/assinatura-api'
import { listarEmpresas, type EmpresaListada } from '@/lib/plataforma-api'
import { maskCNPJ } from '@/lib/validation'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Assinaturas de todas as lojas — NR-216, o par da tela do web.
 *
 * Achado do QA (item 18): a plataforma nao enxergava inadimplencia. Abre em
 * "Inadimplentes" quando ha alguem nessa situacao; sem nenhum, em "Todas".
 * Para entrar numa loja, a aba Empresas (com a justificativa).
 */

const ETIQUETA: Record<Tom, 'neutro' | 'sucesso' | 'atencao' | 'erro'> = {
  positive: 'sucesso',
  warning: 'atencao',
  negative: 'erro',
  neutral: 'neutro',
}

export default function AssinaturasDaPlataforma() {
  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<GrupoDeAssinatura | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await listarEmpresas()
      if (cancelado) return
      if (r.ok) setEmpresas(r.dados.companies)
      else setErro(r.erro)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  if (erro !== null) return <Vazio titulo="Não deu para carregar" descricao={erro} />
  if (empresas === null) return <Vazio titulo="Carregando" />

  const contagem = contarPorGrupo(empresas.map((e) => e.subscriptionStatus))
  const ativo: GrupoDeAssinatura = grupo ?? (contagem.inadimplentes > 0 ? 'inadimplentes' : 'todas')
  const visiveis = empresas.filter((e) => estaNoGrupo(e.subscriptionStatus, ativo))
  const semCobranca = empresas.length > 0 && contagem.sem === empresas.length

  return (
    <View style={estilos.tela}>
      {semCobranca ? (
        <Text style={estilos.apoio}>
          Nenhuma loja tem assinatura ainda: a cobrança da mensalidade não foi ligada (falta definir
          preço e prazos).
        </Text>
      ) : null}

      <View style={estilos.filtros} accessibilityRole="tablist">
        {GRUPOS_DE_ASSINATURA.map((g) => (
          <Pressable
            key={g.valor}
            onPress={() => setGrupo(g.valor)}
            style={[estilos.filtro, ativo === g.valor && estilos.filtroAtivo]}
            accessibilityRole="tab"
            accessibilityState={{ selected: ativo === g.valor }}
          >
            <Text style={[estilos.filtroTexto, ativo === g.valor && estilos.filtroTextoAtivo]}>
              {g.rotulo} · {contagem[g.valor]}
            </Text>
          </Pressable>
        ))}
      </View>

      {visiveis.length === 0 ? (
        <Vazio titulo="Nenhuma loja aqui" descricao="Nenhuma loja nesta situação." />
      ) : (
        visiveis.map((e) => {
          const estado = e.subscriptionStatus ?? 'sem'
          const data = dataQueImporta(e)
          return (
            <Cartao key={e.id}>
              <View style={estilos.linha}>
                <View style={estilos.flex}>
                  <Text style={estilos.nome}>{e.tradeName ?? e.legalName}</Text>
                  <Text style={estilos.apoio}>
                    {maskCNPJ(e.cnpj)}
                    {data !== null ? ` · ${data}` : ''}
                  </Text>
                </View>
                <Etiqueta tom={ETIQUETA[TOM_DO_ESTADO[estado]]}>
                  {ROTULO_DO_ESTADO[estado]}
                </Etiqueta>
              </View>
            </Cartao>
          )
        })
      )}
    </View>
  )
}

const estilos = criarEstilos(() => ({
  tela: { gap: espaco.md },
  filtros: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm },
  filtro: {
    paddingVertical: espaco.xs,
    paddingHorizontal: espaco.md,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.pill,
  },
  filtroAtivo: { backgroundColor: cores.sucessoFundo, borderColor: cores.acento },
  filtroTexto: { fontSize: fonte.micro, color: cores.textoFraco },
  filtroTextoAtivo: { color: cores.acento, fontWeight: peso.forte },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  flex: { flex: 1 },
  nome: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  apoio: { fontSize: fonte.micro, color: cores.textoFraco },
}))
