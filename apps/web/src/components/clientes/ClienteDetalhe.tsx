'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  buscarCliente,
  comprasDoCliente,
  contatosDoCliente,
  pendenciasDoCliente,
  type ClienteDaFicha,
  type ContatoCliente,
} from '@/lib/clientes-api'
import { describeDueDate, formatDate, formatMoney } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { IconArrowRight, IconCalendar, IconPlus, IconReceipt } from '@/components/Icons'
import AnonimizarCliente from './AnonimizarCliente'
import ExcluirCliente from './ExcluirCliente'
import NovoContato from './NovoContato'
import styles from './detalhe.module.css'

const TIPO_CONTATO: Record<ContatoCliente['tipo'], string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  visita: 'Visita',
  observacao: 'Observação',
}

/** Documento so com digitos nao se le. CPF vira 000.000.000-00, CNPJ o seu. */
function formatarDocumento(documento: string | null): string | null {
  if (documento === null) return null
  const d = documento.replace(/\D/g, '')

  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  }

  /* Comprimento fora do padrao volta como veio: mascarar um documento que nao
     e CPF nem CNPJ desenharia pontos onde nao ha nada. */
  return documento
}

function formatarTelefone(ddd: string | null, celular: string | null): string | null {
  if (celular === null) return null
  return ddd === null ? celular : `(${ddd}) ${celular}`
}

/**
 * O endereco em duas linhas, pulando o que nao foi preenchido.
 *
 * `null` quando NADA foi preenchido — a tela mostra "Nao informado" em vez de
 * uma virgula solta, que e o que sai de juntar campos vazios sem conferir.
 */
function linhasDoEndereco(e: ClienteDaFicha['endereco']): [string, string] | null {
  const rua = [e.logradouro, e.numero, e.complemento].filter((v) => v !== null && v !== '')
  const cidade = [
    e.bairro,
    e.cidade !== null && e.uf !== null ? `${e.cidade}/${e.uf}` : (e.cidade ?? e.uf),
    e.cep !== null ? `CEP ${e.cep}` : null,
  ].filter((v) => v !== null && v !== '')

  if (rua.length === 0 && cidade.length === 0) return null

  return [rua.join(', '), cidade.join(' · ')]
}

export default function ClienteDetalhe({ clienteId }: { clienteId: string }) {
  const [toast, setToast] = useState<string | null>(null)
  const [cliente, setCliente] = useState<ClienteDaFicha | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  /*
   * Os contatos vem da api e nao de um `useMemo` sobre dados de exemplo, e por
   * isso tem estado proprio: a ficha e o historico sao duas leituras, e o
   * lancamento de um contato recarrega so o segundo.
   */
  const [contatos, setContatos] = useState<ContatoCliente[]>([])
  const [lancandoContato, setLancandoContato] = useState(false)

  const carregarContatos = useCallback(async () => {
    const r = await contatosDoCliente(clienteId)
    /* Falha aqui NAO derruba a ficha: o historico e uma secao, e o cadastro, o
       endereco e o fiado continuam legiveis sem ele. */
    if (r.ok) setContatos(r.dados)
  }, [clienteId])

  const carregar = useCallback(async () => {
    const r = await buscarCliente(clienteId)
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    setCliente(r.dados)
  }, [clienteId])

  useEffect(() => {
    /* `async` explicito: os `setState` de `carregar` vem todos depois do
       await, nunca sincronos no corpo do efeito. */
    void (async () => {
      await carregar()
      await carregarContatos()
    })()
  }, [carregar, carregarContatos])

  if (carregando) {
    return <PageHeader title="Carregando…" subtitle="Buscando a ficha do cliente" />
  }

  if (cliente === null) {
    return (
      <>
        <PageHeader title="Cliente" />
        <Card>
          <EmptyState
            title="Não foi possível abrir a ficha"
            description={erro ?? 'Este cliente não existe ou não é da sua loja.'}
            action={
              <Link href="/app/clientes" className={styles.verMais}>
                Voltar para a lista
                <IconArrowRight size={14} />
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const compras = comprasDoCliente(cliente.id)
  const pendencias = pendenciasDoCliente(cliente.id)

  const totalComprado = compras.reduce((acc, c) => acc + c.valor, 0)
  const documento = formatarDocumento(cliente.documento)
  const telefone = formatarTelefone(cliente.ddd, cliente.celular)
  const endereco = linhasDoEndereco(cliente.endereco)

  /* O subtitulo so mostra o que existe. Cliente cadastrado so com nome —
     que a RF-009 permite — teria " · " sozinho embaixo do titulo. */
  const subtitulo = [documento, telefone].filter((v) => v !== null).join(' · ')

  return (
    <>
      <PageHeader
        title={cliente.nome}
        {...(subtitulo === '' ? {} : { subtitle: subtitulo })}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                setToast('Lançamento de pendência entra com o módulo de Contas a Receber.')
              }
            >
              <IconReceipt size={16} />
              Lançar pendência
            </Button>
            {/* Leva ao formulario da secao de historico, mais abaixo: um
                segundo formulario aqui em cima significaria dois lugares para
                escrever a mesma coisa. */}
            <Button variant="secondary" onClick={() => setLancandoContato(true)}>
              <IconCalendar size={16} />
              Lançar contato
            </Button>
            {/*
              O botao de WhatsApp so aparece com telefone. Antes ele era sempre
              desenhado, e para quem nao tem numero abria `wa.me/55` — uma aba
              em branco que parecia falha do aplicativo.
            */}
            {cliente.telefone === null ? null : (
              <a
                href={`https://wa.me/55${cliente.telefone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.whatsBotao}
              >
                Enviar WhatsApp
                <IconArrowRight size={15} />
              </a>
            )}
          </>
        }
      />

      {/*
        O aviso vem ANTES dos numeros. Quem abre a ficha de um cliente que saiu
        da lista precisa saber disso antes de ler o saldo de fiado — senao le a
        ficha inteira achando que e um cliente ativo qualquer.
      */}
      {cliente.excluidoEm === null ? null : (
        <p className={styles.privacidadeAviso}>
          Cliente excluído da lista. Ele não aparece mais no cadastro nem nas buscas; o histórico de
          vendas continua intacto. A opção de trazer de volta está no fim desta ficha.
        </p>
      )}

      <div className="statRow">
        <Stat
          label="Fiado em aberto"
          value={formatMoney(cliente.saldoFiado)}
          hint={
            cliente.limiteFiado > 0
              ? `limite ${formatMoney(cliente.limiteFiado)}`
              : 'sem limite liberado'
          }
          tone={cliente.saldoFiado > 0 ? 'warning' : 'positive'}
        />
        <Stat label="Compras" value={String(compras.length)} hint={formatMoney(totalComprado)} />
        <Stat
          label="Última compra"
          value={compras[0] ? formatDate(compras[0].data) : '—'}
          hint={compras.length === 0 ? 'nunca comprou' : undefined}
        />
      </div>

      <div className={styles.grid}>
        {/* --- Dados cadastrais --- */}
        <Card title="Dados cadastrais">
          <dl className={styles.dados}>
            <div>
              <dt>Documento</dt>
              <dd>{documento ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              {/*
                Derivado do documento, e nao um campo proprio: guardar os dois
                deixaria a ficha dizer "pessoa fisica" com um CNPJ ao lado no
                dia em que alguem corrigisse so um deles.
              */}
              <dd>
                {cliente.tipoPessoa === 'fisica'
                  ? 'Pessoa física'
                  : cliente.tipoPessoa === 'juridica'
                    ? 'Pessoa jurídica'
                    : '—'}
              </dd>
            </div>
            <div>
              <dt>Celular</dt>
              <dd>{telefone ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{cliente.email ?? '—'}</dd>
            </div>
            <div className={styles.dadosLargo}>
              <dt>Endereço</dt>
              <dd>
                {endereco === null ? (
                  'Não informado'
                ) : (
                  <>
                    {endereco[0]}
                    {endereco[0] !== '' && endereco[1] !== '' ? <br /> : null}
                    {endereco[1]}
                  </>
                )}
              </dd>
            </div>
            {cliente.observacao === null ? null : (
              <div className={styles.dadosLargo}>
                <dt>Observação</dt>
                <dd>{cliente.observacao}</dd>
              </div>
            )}
          </dl>
        </Card>

        {/* --- Pendencias financeiras --- */}
        <Card
          title="Pendências financeiras"
          action={
            <Link href="/app/financeiro/contas-a-receber" className={styles.verMais}>
              Contas a receber
              <IconArrowRight size={14} />
            </Link>
          }
        >
          {pendencias.length === 0 ? (
            <EmptyState
              title="Nada em aberto"
              description="Este cliente não tem títulos pendentes."
              mascote
            />
          ) : (
            <ul className={styles.linhas}>
              {pendencias.map((p) => (
                <li key={p.id} className={styles.linha}>
                  <span className={styles.linhaPrincipal}>
                    <strong>{p.referente}</strong>
                    <span>{describeDueDate(p.vencimento)}</span>
                  </span>
                  {p.status === 'vencido' ? (
                    <Badge tone="warning">Vencido</Badge>
                  ) : p.status === 'parcial' ? (
                    <Badge tone="info">Parcial</Badge>
                  ) : (
                    <Badge>Em aberto</Badge>
                  )}
                  <span className={styles.linhaValor}>{formatMoney(p.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- Historico de compras --- */}
        <Card
          title="Histórico de compras"
          className={styles.largo}
          action={
            <Link href="/app/vendas" className={styles.verMais}>
              Todas as vendas
              <IconArrowRight size={14} />
            </Link>
          }
        >
          {compras.length === 0 ? (
            <EmptyState
              title="Nenhuma compra registrada"
              description="Quando este cliente comprar, o histórico aparece aqui."
              mascote
            />
          ) : (
            <ul className={styles.linhas}>
              {compras.map((c) => (
                <li key={c.id} className={styles.linha}>
                  <span className={styles.linhaId}>#{c.numero}</span>
                  <span className={styles.linhaPrincipal}>
                    <strong>{formatDate(c.data)}</strong>
                    <span>
                      {c.itens} {c.itens === 1 ? 'item' : 'itens'} · {c.formaPagamento}
                    </span>
                  </span>
                  <span className={styles.linhaValor}>{formatMoney(c.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- Contatos e pendencias lancadas (CRM) --- */}
        <Card
          title="Histórico de contatos"
          className={styles.largo}
          action={
            lancandoContato ? null : (
              <Button variant="ghost" size="sm" onClick={() => setLancandoContato(true)}>
                <IconPlus size={14} />
                Novo contato
              </Button>
            )
          }
        >
          {lancandoContato ? (
            <NovoContato
              clienteId={cliente.id}
              onLancado={() => {
                setLancandoContato(false)
                setToast('Contato registrado.')
                void carregarContatos()
              }}
              onCancelar={() => setLancandoContato(false)}
            />
          ) : null}

          {contatos.length === 0 && !lancandoContato ? (
            <EmptyState
              title="Nenhum contato registrado"
              description="Registre ligações, visitas e combinados para não depender da memória."
              mascote
            />
          ) : (
            <ul className={styles.linhas}>
              {contatos.map((c) => (
                <li key={c.id} className={styles.linha}>
                  <span className={styles.linhaData}>{formatDate(c.data)}</span>
                  <span className={styles.linhaPrincipal}>
                    <strong>{c.descricao}</strong>
                    <span>{TIPO_CONTATO[c.tipo]}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/*
        Tirar da lista — RF-009. Reversivel, decisao do lojista.

        Fica ACIMA da anonimizacao de proposito: as duas se parecem pelo nome e
        nao sao a mesma coisa, e quem procura "excluir" encontra primeiro a que
        da para desfazer.
      */}
      <div className={styles.privacidade}>
        <ExcluirCliente
          clienteId={cliente.id}
          nome={cliente.nome}
          excluidoEm={cliente.excluidoEm}
          onMudou={() => void carregar()}
        />
      </div>

      {/*
        Atender pedido de exclusao (LGPD art. 18, VI) — NR-086.
        No fim da ficha, e nao no topo: e a operacao mais destrutiva da tela e
        nao deve competir por atencao com o que se faz todo dia.
      */}
      <div className={styles.privacidade}>
        <AnonimizarCliente
          clienteId={cliente.id}
          nome={cliente.nome}
          jaAnonimizado={cliente.anonimizadoEm !== null}
          onAnonimizado={() => void carregar()}
        />
      </div>

      {toast ? <Toast message={toast} tone="success" onClose={() => setToast(null)} /> : null}
    </>
  )
}
