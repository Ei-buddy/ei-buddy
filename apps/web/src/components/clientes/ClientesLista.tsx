'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  type ClienteDaLista,
  confirmarImportacaoClientes,
  type FiltroDeCliente,
  listarClientes,
  listarInadimplentes,
  type ClienteInadimplente,
  resumoDeClientes,
  type ResumoDeClientes,
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
import BotoesExportar from '@/components/app/BotoesExportar'
import styles from './clientes.module.css'

/**
 * Campos que a planilha de clientes pode alimentar — os mesmos do app.
 * Celular e endereco completo sao obrigatorios no cadastro (NR-142).
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
    obrigatorio: true,
    reconhece: (c: string) => c.includes('tel') || c.includes('cel') || c.includes('whats'),
  },
  {
    key: 'email',
    label: 'E-mail',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('mail'),
  },
  {
    key: 'cep',
    label: 'CEP',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('cep'),
  },
  {
    key: 'rua',
    label: 'Rua',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('rua') || c.includes('logradouro') || c === 'endereço' || c === 'endereco',
  },
  {
    key: 'numero',
    label: 'Número',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('número') || c.includes('numero') || c === 'nº' || c === 'n',
  },
  {
    key: 'complemento',
    label: 'Complemento',
    obrigatorio: false,
    reconhece: (c: string) => c.includes('complemento'),
  },
  {
    key: 'bairro',
    label: 'Bairro',
    obrigatorio: true,
    reconhece: (c: string) => c.includes('bairro'),
  },
  {
    key: 'cidade',
    label: 'Cidade',
    obrigatorio: true,
    reconhece: (c: string) =>
      c.includes('cidade') || c.includes('municipio') || c.includes('município'),
  },
  {
    key: 'uf',
    label: 'UF',
    obrigatorio: true,
    reconhece: (c: string) => c === 'uf' || c.includes('estado'),
  },
]

/** Celular e endereco de uma linha da planilha — obrigatorios (NR-142). */
function validarContatoEEndereco(v: Record<string, string>): string | null {
  /* Celular e endereco sao obrigatorios no cadastro (NR-142). */
  const celular = (v.celular ?? '').replace(/\D/g, '')
  if (celular.length !== 10 && celular.length !== 11) return 'Celular com DDD vazio ou inválido'
  if ((v.cep ?? '').replace(/\D/g, '').length !== 8) return 'CEP vazio ou inválido'
  for (const [campo, rotulo] of [
    ['rua', 'Rua'],
    ['numero', 'Número'],
    ['bairro', 'Bairro'],
    ['cidade', 'Cidade'],
  ] as const) {
    if (!v[campo]?.trim()) return `${rotulo} vazio`
  }
  if ((v.uf ?? '').trim().length !== 2) return 'UF vazia ou inválida'
  return null
}

/*
 * A fronteira do "inativo" saiu daqui.
 *
 * Ela mora em `contracts` (`DIAS_PARA_INATIVO`) e e aplicada por `core`, porque
 * e regra de negocio: o CRM usa a MESMA para dizer "faz dois meses que ela nao
 * vem". Duas copias divergem no dia em que uma das duas mudar.
 */

type Filtro = 'todos' | 'pendencia' | 'inativos' | 'inadimplentes'

export default function ClientesLista() {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  /* A lista vinha so com a primeira pagina (24) e sem jeito de ver o resto —
     NR-211. Agora pagina como o historico de vendas. */
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(24)
  const [importando, setImportando] = useState(false)

  const [listaFiltrada, setListaFiltrada] = useState<ClienteDaLista[]>([])
  const [inadimplentes, setInadimplentes] = useState<ClienteInadimplente[] | null>(null)
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  /* Os numeros do topo — NR-211: da loja inteira, prontos ao abrir a tela. */
  const [resumo, setResumo] = useState<ResumoDeClientes | null>(null)

  const carregarResumo = useCallback(async () => {
    const r = await resumoDeClientes()
    if (r.ok) setResumo(r.dados)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregarResumo()
    })()
  }, [carregarResumo])

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
  const buscar = useCallback(async (termo: string, qual: Filtro, qualPagina = 1) => {
    /* Inadimplentes tem consulta propria (RF-071): o que importa e o valor
       VENCIDO e os dias de atraso, que a lista geral nao traz. A busca filtra
       por nome aqui mesmo — a lista ja vem curta, so de quem deve. */
    if (qual === 'inadimplentes') {
      const d = await listarInadimplentes()
      setCarregando(false)
      if (!d.ok) {
        setErroCarga(d.erro)
        return
      }
      const t = termo.trim().toLowerCase()
      const filtrados = d.dados.filter((c) => t === '' || c.nome.toLowerCase().includes(t))
      setErroCarga(null)
      setInadimplentes(filtrados)
      setTotal(filtrados.length)
      return
    }
    setInadimplentes(null)
    const r = await listarClientes({
      termo,
      filtro: (qual === 'pendencia' ? 'fiado' : qual) as FiltroDeCliente,
      pagina: qualPagina,
    })
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    setListaFiltrada(r.dados.clientes)
    setTotal(r.dados.total)
    setPorPagina(r.dados.porPagina)
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
      void buscar(busca, filtro, pagina)
    }, 300)

    return () => clearTimeout(t)
  }, [busca, filtro, pagina, buscar])

  /* Mudar busca ou filtro volta para a primeira pagina: ficar na 4 de um
     resultado que agora tem uma mostraria a lista vazia. */
  const mudarBusca = (v: string) => {
    setBusca(v)
    setPagina(1)
  }
  const mudarFiltro = (v: Filtro) => {
    setFiltro(v)
    setPagina(1)
  }
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina))

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Base de clientes, pendências e histórico"
        actions={
          <>
            {/* O arquivo leva a busca e o filtro aplicados — NR-155. */}
            <BotoesExportar
              lista="clientes"
              filtros={{
                q: busca.trim(),
                filter:
                  filtro === 'pendencia' ? 'fiado' : filtro === 'inativos' ? 'inativos' : 'todos',
              }}
            />
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

      {/*
        O topo e da loja inteira — NR-211. Antes "Cadastrados" mostrava o total
        do filtro aberto, "Com pendencia" contava so a pagina carregada (24 de
        uma base de tres mil) e "Sem comprar ha 60 dias" so aparecia depois de
        clicar no filtro. Agora os tres vem de `/clientes/resumo`, com a mesma
        regra de inativo do filtro.
      */}
      <div className="statRow">
        <Stat label="Clientes cadastrados" value={resumo ? String(resumo.total) : '—'} />
        <Stat
          label="Com pendência"
          value={resumo ? String(resumo.comPendencia) : '—'}
          hint={resumo ? formatMoney(resumo.totalPendente) : undefined}
          tone={resumo && resumo.comPendencia > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Sem comprar há 60 dias"
          value={resumo ? String(resumo.semComprar) : '—'}
          hint={resumo && resumo.semComprar > 0 ? 'vale mandar um Whats' : undefined}
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
              onChange={(e) => mudarBusca(e.target.value)}
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
                ['inadimplentes', 'Inadimplentes'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                className={`${styles.filtro} ${filtro === valor ? styles.filtroAtivo : ''}`}
                onClick={() => mudarFiltro(valor)}
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
                  void buscar(busca, filtro, pagina)
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : inadimplentes !== null ? (
          inadimplentes.length === 0 ? (
            <EmptyState
              title="Ninguém em atraso"
              description="Nenhum cliente com conta vencida e não paga."
            />
          ) : (
            <ul className={styles.lista}>
              {inadimplentes.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/clientes/${c.id}`} className={styles.item}>
                    <span className={styles.avatar} aria-hidden="true">
                      {c.nome.slice(0, 2).toUpperCase()}
                    </span>
                    <span className={styles.itemPrincipal}>
                      <strong>{c.nome}</strong>
                      <span>
                        {c.titulos} {c.titulos === 1 ? 'conta vencida' : 'contas vencidas'}
                      </span>
                    </span>
                    <span className={styles.itemContato}>{c.celular ?? 'sem telefone'}</span>
                    <span className={styles.itemUltima}>
                      Vencido desde {formatDate(c.venceuEm)}
                    </span>
                    <span className={styles.itemStatus}>
                      <Badge tone="danger">
                        {formatMoney(c.vencido)} · {c.diasDeAtraso}{' '}
                        {c.diasDeAtraso === 1 ? 'dia' : 'dias'}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
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
                    mudarBusca('')
                    mudarFiltro('todos')
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
                      {/* Cliente de antes da DEC-025 pode estar sem celular ou
                          endereco: o aviso aparece aqui para ser completado. */}
                      {cliente.faltando.length > 0 ? (
                        <Badge tone="warning">Cadastro incompleto</Badge>
                      ) : null}
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

        {/* "25–48 de 300" e os botoes — NR-211. Fora dos inadimplentes, que
            vem inteiros. */}
        {inadimplentes === null && erroCarga === null && !carregando && total > 0 ? (
          <div className={styles.paginacao}>
            <p className={styles.paginacaoResumo}>
              {ultimaPagina <= 1
                ? `${total} ${total === 1 ? 'cliente' : 'clientes'}`
                : `${(pagina - 1) * porPagina + 1}–${(pagina - 1) * porPagina + listaFiltrada.length} de ${total}`}
            </p>
            {ultimaPagina > 1 ? (
              <div className={styles.paginacaoBotoes}>
                <Button
                  variant="secondary"
                  onClick={() => setPagina((p) => p - 1)}
                  disabled={pagina <= 1}
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={pagina >= ultimaPagina}
                >
                  Próxima
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className={styles.comandosWrap}>
        <ComandosWhatsApp comandos={COMANDOS_CLIENTES} />
      </div>

      {importando ? (
        <ImportarPlanilha
          titulo="Importar clientes"
          campos={CAMPOS_PLANILHA}
          /*
           * Vazio: a lista desta tela e paginada no servidor, entao o
           * navegador so conhece uma pagina — conferir contra ela deixaria
           * passar quem esta na pagina seguinte. Repetido DENTRO da planilha
           * continua sendo detectado; parecido com quem ja existe ENTRA, de
           * proposito (`importCustomers`, NR-072), para juntar depois.
           */
          chavesExistentes={[]}
          chaveDuplicidade={(v) => (v.documento ?? '').replace(/\D/g, '')}
          validar={(v) => {
            if (!v.nome?.trim()) return 'Nome vazio'
            const doc = (v.documento ?? '').replace(/\D/g, '')
            if (!doc) return 'CPF/CNPJ vazio'
            const ok =
              doc.length === 11 ? isValidCPF(doc) : doc.length === 14 ? isValidCNPJ(doc) : false
            if (!ok) return 'CPF/CNPJ inválido'
            return validarContatoEEndereco(v)
          }}
          onConfirmar={confirmarImportacaoClientes}
          onClose={() => {
            setImportando(false)
            /* Quem entrou pela planilha muda a lista e o topo. */
            void carregarResumo()
            void buscar(busca, filtro, pagina)
          }}
        />
      ) : null}
    </>
  )
}
