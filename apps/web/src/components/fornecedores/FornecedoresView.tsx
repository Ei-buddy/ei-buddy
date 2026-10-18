'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, EmptyState, Field, Input } from '@/components/ui/UI'
import { Spinner } from '@/components/auth/Fields'
import { IconCheck, IconSearch, IconStore } from '@/components/Icons'
import {
  buscarFornecedores,
  buscarSugestoes,
  pedirConexao,
  type Fornecedor,
  type SugestaoDeFornecedor,
} from '@/lib/connections-api'
import styles from './fornecedores.module.css'

/*
 * A coordenada vem do CEP, e o provedor muitas vezes devolve o centro da
 * cidade: duas lojas a 1 km apareciam a "0 m" (achado do QA). Abaixo de 1 km
 * a tela nao finge precisao que o dado nao tem.
 */
const formatarDistancia = (km: number | null): string | null => {
  if (km === null) return null
  return km < 1 ? 'menos de 1 km' : `${km.toFixed(1).replace('.', ',')} km`
}

const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos)

/**
 * Buscar fornecedor por proximidade — ADR-0008, DEC-021, RF-01 a RF-04.
 *
 * O caso de uso guia: quem vende bolo de pote precisa de farinha, busca
 * "farinha" e ve quem mais vende isso perto, do mais proximo ao mais
 * distante. Antes do pedido ser aceito, so nome da empresa, bairro/cidade e
 * distancia aparecem — telefone e endereco completo vem depois.
 */
export default function FornecedoresView() {
  const [termo, setTermo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Fornecedor[]>([])
  const [sugestoes, setSugestoes] = useState<SugestaoDeFornecedor[] | null>(null)
  /* Uma so tabela de estado para os dois tipos de resultado: pedir a partir
     de uma sugestao ou de um resultado de busca e a MESMA acao, e se a
     mesma empresa aparecer nos dois lugares o segundo botao reflete o
     primeiro clique em vez de fingir que nada aconteceu. */
  const [pedidos, setPedidos] = useState<Record<string, 'enviando' | 'enviado' | string>>({})

  useEffect(() => {
    void (async () => {
      const r = await buscarSugestoes()
      if (r.ok) setSugestoes(r.dados.suggestions)
    })()
  }, [])

  async function buscar(event: FormEvent) {
    event.preventDefault()
    if (termo.trim().length < 2) return

    setBuscando(true)
    setErro(null)

    const r = await buscarFornecedores(termo.trim())
    setBuscando(false)
    setBuscou(true)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setResultados(r.dados.results)
  }

  async function pedir(companyId: string) {
    setPedidos((atual) => ({ ...atual, [companyId]: 'enviando' }))

    const r = await pedirConexao(companyId)

    setPedidos((atual) => ({
      ...atual,
      [companyId]: r.ok ? 'enviado' : r.erro,
    }))
  }

  return (
    <>
      <div className={styles.intro}>
        <div className={styles.introTopo}>
          <div>
            <h1 className={styles.introTitle}>Buscar fornecedores</h1>
            <p className={styles.introSubtitle}>
              Precisa de um insumo? Veja quem mais vende perto de você e peça conexão.
            </p>
          </div>
          <ButtonLink href="/app/conexoes" variant="secondary" size="sm">
            Minhas conexões
          </ButtonLink>
        </div>
      </div>

      {sugestoes !== null && sugestoes.length > 0 ? (
        <Card title="Sugestões para você">
          <ul className={styles.lista}>
            {sugestoes.map((s) => (
              <LinhaDeResultado
                key={s.companyId}
                companyId={s.companyId}
                companyName={s.companyName}
                neighborhood={s.neighborhood}
                city={s.city}
                distanceKm={s.distanceKm}
                detalhe={`${s.peerCount} ${plural(s.peerCount, 'empresa do seu ramo já se conectou', 'empresas do seu ramo já se conectaram')}`}
                estado={pedidos[s.companyId]}
                onPedir={pedir}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <form className={styles.busca} onSubmit={(e) => void buscar(e)}>
          <div className={styles.buscaCampo}>
            <Field label="O que você precisa?">
              <Input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Ex.: farinha, embalagem, tempero..."
                disabled={buscando}
              />
            </Field>
          </div>
          <Button type="submit" disabled={buscando || termo.trim().length < 2}>
            {buscando ? (
              <>
                <Spinner size={15} />
                Buscando...
              </>
            ) : (
              <>
                <IconSearch size={16} />
                Buscar
              </>
            )}
          </Button>
        </form>

        {erro !== null ? <EmptyState title="Não deu para buscar" description={erro} /> : null}

        {buscou && erro === null ? (
          resultados.length === 0 ? (
            <EmptyState
              title="Nenhum fornecedor encontrado"
              description="Ninguém cadastrado por aqui vende isso ainda. Tente outro termo."
            />
          ) : (
            <ul className={styles.lista}>
              {resultados.map((f) => (
                <LinhaDeResultado
                  key={f.companyId}
                  companyId={f.companyId}
                  companyName={f.companyName}
                  neighborhood={f.neighborhood}
                  city={f.city}
                  distanceKm={f.distanceKm}
                  detalhe={f.products.join(', ')}
                  estado={pedidos[f.companyId]}
                  onPedir={pedir}
                />
              ))}
            </ul>
          )
        ) : null}
      </Card>
    </>
  )
}

/**
 * Uma linha de resultado — busca e sugestao usam a MESMA aparencia e a MESMA
 * maquina de estado do botao (enviando/enviado/erro). O que muda entre as
 * duas e so o `detalhe` (produtos vendidos, ou quantos pares do ramo ja
 * conectaram) — extrair evitava duas copias da logica de botao divergindo
 * silenciosamente com o tempo.
 */
function LinhaDeResultado({
  companyId,
  companyName,
  neighborhood,
  city,
  distanceKm,
  detalhe,
  estado,
  onPedir,
}: {
  companyId: string
  companyName: string
  neighborhood: string | null
  city: string | null
  distanceKm: number | null
  detalhe: string
  estado: string | undefined
  onPedir: (companyId: string) => void
}) {
  const distancia = formatarDistancia(distanceKm)

  return (
    <li className={styles.linha}>
      <IconStore size={20} />
      <div className={styles.linhaTexto}>
        <span className={styles.linhaTitulo}>
          {companyName}
          {distancia !== null ? <span className={styles.linhaDetalhe}>· {distancia}</span> : null}
        </span>
        <span className={styles.linhaDetalhe}>
          {[neighborhood, city].filter(Boolean).join(', ') || 'Localização não informada'}
        </span>
        <span className={styles.linhaProdutos}>{detalhe}</span>
      </div>

      {estado === 'enviado' ? (
        <Button size="sm" variant="secondary" disabled>
          <IconCheck size={16} />
          Pedido enviado
        </Button>
      ) : estado === 'enviando' ? (
        <Button size="sm" variant="secondary" disabled>
          <Spinner size={14} />
        </Button>
      ) : (
        <div className={styles.linhaAcao}>
          {estado !== undefined ? <span className={styles.linhaErro}>{estado}</span> : null}
          <Button size="sm" variant="secondary" onClick={() => onPedir(companyId)}>
            Pedir conexão
          </Button>
        </div>
      )}
    </li>
  )
}
