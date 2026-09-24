'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  type ClienteDaLista,
  confirmarImportacaoClientes,
  type FiltroDeCliente,
  listarClientes,
} from '@/lib/clientes-api'
import { isValidCNPJ, isValidCPF } from '@/lib/validation'
import { formatDate, formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button, ButtonLink } from '@/components/ui/Button'
import { IconPlus, IconSearch, IconUpload } from '@/components/Icons'
import { COMANDOS_CLIENTES } from '@/lib/comandos'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import ImportarPlanilha from '@/components/app/ImportarPlanilha'
import styles from './clientes.module.css'

/** Campos que a planilha de clientes pode alimentar. */
/*
 * Cidade e UF NAO estao aqui, e a ausencia e de proposito.
 *
 * A tabela `customers` nao tem endereco — nem coluna, nem contrato. Enquanto
 * elas ficavam no mapeamento, o lojista escolhia a coluna da planilha dele e o
 * dado era descartado em silencio: pior que nao oferecer, porque parece que
 * funcionou. Voltam quando houver onde guardar.
 */
const CAMPOS_PLANILHA = [
  {
    key: 'nome',
    label: 'Nome / Razão social',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('nome') || c.includes('razao'),
  },
  {
    key: 'documento',
    label: 'CPF / CNPJ',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('cpf') || c.includes('cnpj') || c.includes('documento'),
  },
  {
    key: 'celular',
    label: 'Celular',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('tel') || c.includes('cel') || c.includes('whats'),
  },
  {
    key: 'email',
    label: 'E-mail',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('mail'),
  },
]

/*
 * A fronteira do "inativo" saiu daqui.
 *
 * Ela mora em `contracts` (`DIAS_PARA_INATIVO`) e e aplicada por `core`, porque
 * e regra de negocio: o CRM usa a MESMA para dizer "faz dois meses que ela nao
 * vem". Duas copias divergem no dia em que uma das duas mudar.
 */

type Filtro = 'todos' | 'pendencia' | 'inativos'

export default function ClientesLista() {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [importando, setImportando] = useState(false)

  const [listaFiltrada, setListaFiltrada] = useState<ClienteDaLista[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  /*
   * A busca e o filtro sao do SERVIDOR, e nao de um filtro sobre a lista.
   *
   * Antes a tela carregava todo mundo de `mock-data` e filtrava no navegador.
   * Numa base de tres mil clientes isso seriam tres mil linhas trafegadas para
   * mostrar vinte e quatro — e piora conforme a loja cresce, que e o contrario
   * do que deveria acontecer.
   *
   * "Inativo" tambem passa a ter uma definicao so, em `core`, em vez de uma
   * conta repetida aqui e no CRM.
   */
  const buscar = useCallback(async (termo: string, qual: Filtro) => {
    const r = await listarClientes({
      termo,
      filtro: (qual === 'pendencia' ? 'fiado' : qual) as FiltroDeCliente,
    })
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    setListaFiltrada(r.dados.clientes)
    setTotal(r.dados.total)
  }, [])

  useEffect(() => {
    /*
     * Espera a digitacao parar antes de consultar.
     *
     * Sem isso, "Maria" dispara cinco buscas — e a resposta da terceira pode
     * chegar depois da quinta, deixando a tela com o resultado de "Mar" e
     * "Maria" escrito no campo.
     */
    const t = setTimeout(() => {
      void buscar(busca, filtro)
    }, 300)

    return () => clearTimeout(t)
  }, [busca, filtro, buscar])

  const comPendencia = listaFiltrada.filter((c) => c.saldoFiado > 0)
  const totalPendente = comPendencia.reduce((acc, c) => acc + c.saldoFiado, 0)

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Base de clientes, pendências e histórico"
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportando(true)}>
              <IconUpload size={17} />
              Importar planilha
            </Button>
            <ButtonLink href="/app/clientes/novo">
              <IconPlus size={17} />
              Novo cliente
            </ButtonLink>
          </>
        }
      />

      <div className="statRow">
        <Stat label="Clientes cadastrados" value={carregando ? '—' : String(total)} />
        <Stat
          label="Com pendência"
          value={String(comPendencia.length)}
          hint={formatMoney(totalPendente)}
          tone={comPendencia.length ? 'warning' : 'neutral'}
        />
        {/*
          O numero de inativos sai do SERVIDOR, pelo filtro — nao de uma conta
          sobre a pagina atual. Contar aqui daria "3 sem comprar" olhando para
          os 24 clientes carregados, numa base de tres mil.
        */}
        <Stat
          label="Sem comprar há 60 dias"
          value={filtro === 'inativos' && !carregando ? String(total) : '—'}
          hint={filtro === 'inativos' ? 'vale mandar um Whats' : 'abra o filtro para ver'}
        />
      </div>

      <Card>
        {/* --- Busca e filtros --- */}
        <div className={styles.toolbar}>
          <label className={styles.busca}>
            <IconSearch size={17} />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou CPF/CNPJ"
              aria-label="Buscar cliente"
            />
          </label>

          <div className={styles.filtros} role="group" aria-label="Filtros">
            {(
              [
                ['todos', 'Todos'],
                ['pendencia', 'Com pendência'],
                ['inativos', 'Sem compras recentes'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                className={`${styles.filtro} ${filtro === valor ? styles.filtroAtivo : ''}`}
                onClick={() => setFiltro(valor)}
                aria-pressed={filtro === valor}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        {/* --- Lista --- */}
        {carregando ? (
          <SkeletonLinhas />
        ) : erroCarga !== null ? (
          <EmptyState
            title="Não deu para carregar os clientes"
            description={erroCarga}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setCarregando(true)
                  setErroCarga(null)
                  void buscar(busca, filtro)
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : listaFiltrada.length === 0 ? (
          /* Sem a base inteira em memoria, quem distingue "nenhum cadastro" de
             "nenhum resultado" e a busca estar vazia — e a diferenca importa: a
             primeira pede um cadastro, a segunda pede outra busca. */
          busca === '' && filtro === 'todos' ? (
            <EmptyState
              title="Nenhum cliente cadastrado"
              description="Cadastre o primeiro cliente ou traga sua base de uma planilha. Leva menos de um minuto."
              mascote
              action={
                <div className={styles.emptyAcoes}>
                  <ButtonLink href="/app/clientes/novo">
                    <IconPlus size={17} />
                    Cadastrar o primeiro
                  </ButtonLink>
                  <Button variant="secondary" onClick={() => setImportando(true)}>
                    <IconUpload size={17} />
                    Importar planilha
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              title="Nenhum cliente encontrado"
              description="Nenhum resultado para esta busca ou filtro. Tente outro termo."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setBusca('')
                    setFiltro('todos')
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          )
        ) : (
          <ul className={styles.lista}>
            {listaFiltrada.map((cliente) => {
              /* O saldo devedor vem do CLIENTE, que a api ja trouxe. Antes
                 saia de `pendenciaTotal(id)`, que varria uma lista de mentira. */
              const pendente = cliente.saldoFiado
              /* Sem "Vencido" na lista: saber se ha titulo vencido pede uma
                 consulta por cliente, e antes vinha de uma lista de mentira que
                 nunca acendia. A ficha do cliente mostra as pendencias. */

              return (
                <li key={cliente.id}>
                  <Link href={`/app/clientes/${cliente.id}`} className={styles.item}>
                    <span className={styles.avatar} aria-hidden="true">
                      {cliente.nome.slice(0, 2).toUpperCase()}
                    </span>

                    <span className={styles.itemPrincipal}>
                      <strong>{cliente.nome}</strong>
                      <span>{cliente.documento ?? 'sem documento'}</span>
                    </span>

                    {/* A api guarda o telefone inteiro num campo so — nao ha
                        DDD separado em `customers`. */}
                    <span className={styles.itemContato}>{cliente.celular ?? 'sem telefone'}</span>

                    <span className={styles.itemUltima}>
                      {cliente.ultimaCompra
                        ? `Última: ${formatDate(cliente.ultimaCompra)}`
                        : 'Nunca comprou'}
                    </span>

                    <span className={styles.itemStatus}>
                      {pendente > 0 ? (
                        <Badge tone="info">Em aberto · {formatMoney(pendente)}</Badge>
                      ) : (
                        <Badge tone="success">Em dia</Badge>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={COMANDOS_CLIENTES} />
      </div>

      {importando ? (
        <ImportarPlanilha
          titulo="Importar clientes"
          campos={CAMPOS_PLANILHA}
          /*
           * Vazio: a lista desta tela ainda vem de `mock-data`, e conferir
           * duplicidade contra dados de exemplo diria "ja cadastrado" para
           * quem nunca foi cadastrado. Repetido DENTRO da planilha continua
           * sendo detectado, e o servidor recusa o que precisar recusar.
           */
          chavesExistentes={[]}
          chaveDuplicidade={(v) => (v.documento ?? '').replace(/\D/g, '')}
          validar={(v) => {
            if (!v.nome?.trim()) return 'Nome vazio'
            const doc = (v.documento ?? '').replace(/\D/g, '')
            if (!doc) return 'CPF/CNPJ vazio'
            const ok =
              doc.length === 11 ? isValidCPF(doc) : doc.length === 14 ? isValidCNPJ(doc) : false
            return ok ? null : 'CPF/CNPJ inválido'
          }}
          onConfirmar={confirmarImportacaoClientes}
          onClose={() => setImportando(false)}
        />
      ) : null}
    </>
  )
}
