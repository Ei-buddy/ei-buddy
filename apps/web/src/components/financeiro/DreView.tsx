'use client'

import { useCallback, useEffect, useState } from 'react'
import { linhasDoDreGerencial } from '@/lib/dre-gerencial'
import { carregarDre, type Dre } from '@/lib/contabilidade-api'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, Field, Input, PageHeader } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './dre.module.css'

/**
 * DRE — NR-077, RF-085, RF-086. US-041. No formato da margem de contribuicao
 * pedido pelo QA (NR-204): vendas brutas, descontos, venda liquida, custos
 * variaveis, margem de contribuicao, cada conta de despesa e o resultado
 * operacional. As linhas vem de `linhasDoDreGerencial` (contracts), as mesmas
 * do app e da exportacao.
 *
 * A tela nao calcula nada. A ordem das subtracoes vem de `domain` e chega
 * pronta: e exatamente a parte que nao pode variar entre esta tela, o resumo do
 * assistente (RF-108) e a exportacao do contador (RF-087). Somar aqui daria uma
 * segunda resposta para "o mes fechou no azul".
 */

const emReais = (centavos: number) => centavos / 100

/** Primeiro e ultimo dia do mes de uma data, em AAAA-MM-DD. */
function mesDe(hoje: Date): { from: string; to: string } {
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()
  const dois = (n: number) => String(n).padStart(2, '0')

  /* `new Date(ano, mes + 1, 0)` e o ultimo dia do mes — inclusive em fevereiro
     bissexto, sem tabela de dias. Tudo em campos LOCAIS: `toISOString` aqui
     recuaria um dia em fuso negativo e o mes comecaria no dia 31 anterior. */
  const ultimo = new Date(ano, mes + 1, 0).getDate()

  return {
    from: `${ano}-${dois(mes + 1)}-01`,
    to: `${ano}-${dois(mes + 1)}-${dois(ultimo)}`,
  }
}

export default function DreView() {
  const inicial = mesDe(new Date())

  const [de, setDe] = useState(inicial.from)
  const [ate, setAte] = useState(inicial.to)
  const [dre, setDre] = useState<Dre | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(async (from: string, to: string) => {
    const r = await carregarDre(from, to)
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setDre(r.dados)
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` de `buscar` vem todos depois do await,
       nunca sincronos no corpo do efeito. */
    void (async () => {
      await buscar(inicial.from, inicial.to)
    })()
    /* So na montagem. Trocar o periodo e um clique em "Ver", e nao um efeito
       sobre `de`/`ate` — senao cada tecla digitada na data dispararia uma
       consulta, e datas pela metade ("2026-1") viram pedido invalido. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aplicarPeriodo = () => {
    setCarregando(true)
    setErro(null)
    void buscar(de, ate)
  }

  const periodoInvalido = de === '' || ate === '' || de > ate

  return (
    <>
      <PageHeader
        title="DRE"
        subtitle="Vendas, custos variáveis, margem de contribuição e resultado do período"
        actions={<BotoesExportar lista="dre" filtros={{ from: de, to: ate }} />}
      />

      <Card>
        <div className={styles.periodo}>
          <Field label="De">
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Field>
          <Button onClick={aplicarPeriodo} disabled={periodoInvalido || carregando}>
            Ver
          </Button>
        </div>

        {periodoInvalido && de !== '' && ate !== '' ? (
          <p className={styles.aviso}>O início do período não pode ser depois do fim.</p>
        ) : null}

        {carregando ? (
          <SkeletonLinhas />
        ) : erro !== null ? (
          <EmptyState
            title="Não deu para montar o DRE"
            description={erro}
            action={
              <Button variant="secondary" onClick={aplicarPeriodo}>
                Tentar de novo
              </Button>
            }
          />
        ) : dre === null ? null : (
          <>
            {/*
             * Zeros EXPLICITOS quando nao houve movimento (US-041), e nao um
             * estado vazio. "Receita bruta R$ 0,00" responde a pergunta; "sem
             * dados" deixa o lojista sem saber se o mes foi ruim ou se a tela
             * quebrou.
             */}
            <table className={styles.resumo}>
              <tbody>
                {linhasDoDreGerencial(dre).map((l) => (
                  <tr
                    key={l.chave}
                    className={[
                      l.nivel === 'total' ? styles.linhaTotal : '',
                      l.nivel === 'detalhe' ? styles.linhaDetalhe : '',
                      l.separaAntes && l.nivel !== 'total' ? styles.linhaSepara : '',
                    ].join(' ')}
                  >
                    <th scope="row">
                      {l.rotulo}
                      {l.nota ? <span className={styles.nota}> {l.nota}</span> : null}
                      {l.nivel === 'detalhe' || (l.lancamentos ?? 0) > 0 ? (
                        <span className={styles.contagem}>
                          {' '}
                          {l.lancamentos ?? 0}{' '}
                          {(l.lancamentos ?? 0) === 1 ? 'lançamento' : 'lançamentos'}
                        </span>
                      ) : null}
                    </th>
                    <td
                      className={
                        l.nivel === 'total' && l.valorCents < 0 ? styles.negativo : undefined
                      }
                    >
                      {formatMoney(emReais(l.valorCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </>
  )
}
