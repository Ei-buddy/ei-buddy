'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  criarVenda,
  totalCarrinho,
  type Desconto,
  type ItemCarrinho,
  type Pagamento,
} from '@/lib/vendas-api'
import {
  listarClientes,
  pendenciasDoCliente,
  salvarCliente,
  type CandidatoCliente,
  type ClienteDaLista,
} from '@/lib/clientes-api'
import { buscarCep, UFS } from '@/lib/empresa-api'
import { formatDate, formatMoney } from '@/lib/format'
import { maskCEP, maskCPF, maskPhone, validateCPF } from '@/lib/validation'
import { Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { SkeletonLinhas } from '@/components/ui/Skeleton'
import { Button, ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconCheck, IconPlus, IconSearch, IconUsers } from '@/components/Icons'
import EtapaCatalogo from './EtapaCatalogo'
import EtapaPagamento from './EtapaPagamento'
import EtapaFiscal from './EtapaFiscal'
import styles from './vendas.module.css'

type Etapa = 1 | 2 | 3 | 4

const ETAPAS = [
  { id: 1, rotulo: 'Cliente' },
  { id: 2, rotulo: 'Carrinho' },
  { id: 3, rotulo: 'Pagamento' },
  { id: 4, rotulo: 'Nota fiscal' },
] as const

export type ClienteVenda = {
  id: string | null
  nome: string
}

/**
 * Fluxo de venda do balcao.
 *
 * O carrinho vive aqui, no topo do fluxo, e nao em cada etapa — voltar
 * para trocar o cliente ou acrescentar um item nao pode custar o que ja
 * foi montado.
 */
export default function PdvWizard() {
  const router = useRouter()

  const [etapa, setEtapa] = useState<Etapa>(1)
  const [cliente, setCliente] = useState<ClienteVenda | null>(null)
  /* Aviso de inadimplencia ao iniciar a venda — RF-072. Avisa, nao trava: a
     decisao de vender e do operador, mas ele precisa saber antes do fiado. */
  const [dividaVencida, setDividaVencida] = useState<{ valor: number; desde: string } | null>(null)
  const [itens, setItens] = useState<ItemCarrinho[]>([])
  const [desconto, setDesconto] = useState<Desconto | null>(null)
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([])

  /*
   * A chave de idempotencia do fechamento — RNF-043.
   *
   * Num `ref` e nao em estado: ela nao pinta nada na tela, e mudar estado aqui
   * so causaria um render a mais. O que importa e a VIDA dela — nasce na
   * primeira tentativa de fechar e sobrevive a todas as seguintes, ate a venda
   * entrar ou o carrinho ser esvaziado.
   *
   * E o coracao da protecao: o PDV de balcao tem internet ruim, o operador
   * clica de novo, e sem a chave reaproveitada o reenvio vira uma SEGUNDA
   * venda, com segundo estoque baixado e segundo recebivel. Gerar a chave
   * dentro da funcao de envio seria o mesmo que nao ter chave.
   */
  const chaveDeFechamento = useRef<string | null>(null)

  const [vendaId, setVendaId] = useState<string | null>(null)
  const [vendaNumero, setVendaNumero] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const total = useMemo(() => totalCarrinho(itens, desconto), [itens, desconto])

  /** Fecha a venda no servidor antes de entrar na etapa fiscal. */
  const fecharVenda = useCallback(async () => {
    setFechando(true)

    /* `??=`: so gera na primeira vez. Uma retentativa reusa a mesma. */
    chaveDeFechamento.current ??= crypto.randomUUID()

    /* O servidor recalcula preco, imposto e taxa — o total daqui e so
       referencia para o operador conferir na tela. */
    const r = await criarVenda(
      {
        clienteId: cliente?.id ?? null,
        clienteNome: cliente?.nome ?? 'Venda sem cliente',
        itens,
        desconto,
        pagamentos,
      },
      chaveDeFechamento.current,
    )
    setFechando(false)

    if (!r.ok) {
      /* A chave FICA: o erro pode ter sido a resposta se perdendo depois de a
         venda entrar, e uma chave nova na proxima tentativa criaria a segunda. */
      setToast({ msg: r.error, tone: 'error' })
      return
    }

    if (r.avisosDeEstoque.length > 0) {
      /* RF-028: vender sem saldo nao e recusado, mas o operador precisa saber. */
      setToast({ msg: r.avisosDeEstoque.join(' '), tone: 'error' })
    } else if (r.reenvio) {
      setToast({ msg: `Esta venda já tinha sido fechada (nº ${r.numero}).`, tone: 'success' })
    }

    setVendaId(r.id)
    setVendaNumero(r.numero)
    setEtapa(4)
  }, [cliente, itens, desconto, pagamentos])

  function cancelarVenda() {
    /* Carrinho novo, chave nova: a proxima venda nao pode ser confundida com
       esta pelo servidor. */
    chaveDeFechamento.current = null
    setItens([])
    setDesconto(null)
    setPagamentos([])
    setCliente(null)
    setEtapa(1)
    setToast({ msg: 'Venda cancelada. O carrinho foi esvaziado.', tone: 'success' })
  }

  return (
    <>
      <PageHeader
        title="Nova venda"
        subtitle={
          cliente
            ? `${cliente.nome}${itens.length ? ` · ${itens.length} item(ns) · ${formatMoney(total)}` : ''}`
            : 'Balcao'
        }
        actions={
          <ButtonLink href="/app/vendas" variant="secondary">
            Sair do PDV
          </ButtonLink>
        }
      />

      {/* --- Stepper --- */}
      <ol className={styles.stepper} aria-label="Etapas da venda">
        {ETAPAS.map((e) => {
          const feita = e.id < etapa
          const atual = e.id === etapa
          return (
            <li
              key={e.id}
              className={`${styles.step} ${feita ? styles.stepFeito : ''} ${atual ? styles.stepAtual : ''}`}
              aria-current={atual ? 'step' : undefined}
            >
              <span className={styles.stepMarca}>{feita ? <IconCheck size={13} /> : e.id}</span>
              <span className={styles.stepRotulo}>{e.rotulo}</span>
            </li>
          )
        })}
      </ol>

      {/* ============ Etapa 1: cliente ============ */}
      {etapa === 1 ? (
        <EtapaCliente
          selecionado={cliente}
          onSelecionar={(c) => {
            setCliente(c)
            setEtapa(2)
            setDividaVencida(null)
            /* Venda de balcao sem cliente (`id` nulo) nao tem divida a conferir. */
            const id = c?.id ?? null
            if (id !== null) {
              void pendenciasDoCliente(id).then((r) => {
                if (!r.ok) return
                const vencidas = r.dados.filter((p) => p.status === 'vencido')
                if (vencidas.length === 0) return
                setDividaVencida({
                  valor: vencidas.reduce((acc, p) => acc + p.valor, 0),
                  desde: vencidas.map((p) => p.vencimento).sort()[0]!,
                })
              })
            }
          }}
        />
      ) : null}

      {etapa === 2 && dividaVencida !== null && cliente !== null ? (
        <p className={styles.aviso} role="alert">
          {cliente.nome} tem {formatMoney(dividaVencida.valor)} em contas vencidas desde{' '}
          {formatDate(dividaVencida.desde)}. Confira antes de vender no fiado.
        </p>
      ) : null}

      {/* ============ Etapa 2: catalogo e carrinho ============ */}
      {etapa === 2 ? (
        <EtapaCatalogo
          itens={itens}
          desconto={desconto}
          onItens={setItens}
          onDesconto={setDesconto}
          clienteNome={cliente?.nome ?? 'Venda sem cliente'}
          onVoltar={() => setEtapa(1)}
          onAvancar={() => setEtapa(3)}
          onCancelar={cancelarVenda}
        />
      ) : null}

      {/* ============ Etapa 3: pagamento ============ */}
      {etapa === 3 ? (
        <EtapaPagamento
          total={total}
          pagamentos={pagamentos}
          onPagamentos={setPagamentos}
          onVoltar={() => setEtapa(2)}
          onConcluir={fecharVenda}
          fechando={fechando}
        />
      ) : null}

      {/* ============ Etapa 4: nota fiscal ============ */}
      {etapa === 4 && vendaId ? (
        <EtapaFiscal
          vendaId={vendaId}
          vendaNumero={vendaNumero ?? ''}
          total={total}
          onConcluir={() => router.push('/app/vendas')}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Etapa 1 — selecionar cliente
 * ================================================================== */

function EtapaCliente({
  selecionado,
  onSelecionar,
}: {
  selecionado: ClienteVenda | null
  onSelecionar: (cliente: ClienteVenda) => void
}) {
  const [busca, setBusca] = useState('')
  const [cadastrando, setCadastrando] = useState(false)

  const [encontrados, setEncontrados] = useState<ClienteDaLista[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  /*
   * A busca e do SERVIDOR, e nao um filtro sobre uma lista carregada.
   *
   * Antes esta etapa lia `lib/mock-data`: o balcao procurava a Dona Marta que
   * acabou de cadastrar e ela nao existia — apareciam sempre os mesmos cinco
   * nomes de exemplo, de outra loja.
   *
   * Filtrar no navegador tambem nao serve: uma mercearia com tres mil clientes
   * traria tres mil linhas para mostrar seis.
   */
  const buscar = useCallback(async (termo: string) => {
    const r = await listarClientes({ termo })
    setCarregando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setErro(null)
    /* Seis cabem na tela sem rolagem, e no balcao rolar com fila atras custa
       mais que refinar a busca. */
    setEncontrados(r.dados.clientes.slice(0, 6))
  }, [])

  useEffect(() => {
    /*
     * Espera a digitacao parar. Sem isso "Maria" dispara cinco buscas, e a
     * resposta de "Mar" pode chegar depois da de "Maria" — a lista mostraria o
     * resultado anterior sobre o campo com o termo atual.
     */
    const t = setTimeout(() => {
      void buscar(busca)
    }, 300)

    return () => clearTimeout(t)
  }, [busca, buscar])

  return (
    <>
      <Card title="Para quem e a venda">
        <label className={styles.busca}>
          <IconSearch size={17} />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CPF/CNPJ"
            aria-label="Buscar cliente"
            autoFocus
          />
        </label>

        {carregando ? (
          <SkeletonLinhas />
        ) : erro !== null ? (
          <EmptyState
            title="Não foi possível buscar"
            /* O caminho de seguir sem identificar continua aberto: a venda nao
               pode parar porque a busca de cliente falhou. */
            description={`${erro} Você ainda pode seguir sem identificar o cliente.`}
          />
        ) : encontrados.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado"
            description="Cadastre na hora ou siga sem identificar o cliente."
            action={
              <Button onClick={() => setCadastrando(true)}>
                <IconPlus size={16} />
                Cadastrar cliente
              </Button>
            }
          />
        ) : (
          <ul className={styles.clientes}>
            {encontrados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`${styles.cliente} ${selecionado?.id === c.id ? styles.clienteAtivo : ''}`}
                  onClick={() => onSelecionar({ id: c.id, nome: c.nome })}
                >
                  <span className={styles.clienteAvatar} aria-hidden="true">
                    {c.nome.slice(0, 2).toUpperCase()}
                  </span>
                  <span className={styles.clientePrincipal}>
                    <strong>{c.nome}</strong>
                    {/* Cliente so com nome e legitimo (RF-009): o traco e
                        honesto, e "000.000.000-00" nao seria. */}
                    <span>{c.documento ?? 'sem documento'}</span>
                  </span>
                  <span className={styles.clienteContato}>{c.celular ?? '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.clienteAcoes}>
          <Button variant="secondary" onClick={() => setCadastrando(true)}>
            <IconPlus size={16} />
            Cadastrar novo
          </Button>

          {/* Balcao costuma vender sem identificar — o caminho precisa ser
              tao rapido quanto escolher um cliente. */}
          <Button
            variant="ghost"
            onClick={() => onSelecionar({ id: null, nome: 'Venda sem cliente' })}
          >
            <IconUsers size={16} />
            Seguir sem identificar
          </Button>
        </div>
      </Card>

      {cadastrando ? (
        <CadastroRapido
          onCriado={(criado) => {
            setCadastrando(false)
            /* Com o ID de verdade: antes vinha `id: null` e a venda era
               gravada como "sem cliente" logo depois de o operador cadastrar
               a pessoa. O fiado e o historico dela ficavam sem dono. */
            onSelecionar(criado)
            void buscar(busca)
          }}
          onCancelar={() => setCadastrando(false)}
        />
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Cadastro rapido de cliente, sem sair do fluxo
 * ================================================================== */

function CadastroRapido({
  onCriado,
  onCancelar,
}: {
  onCriado: (cliente: ClienteVenda) => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [celular, setCelular] = useState('')
  const [cep, setCep] = useState('')
  const [rua, setRua] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  /**
   * Clientes parecidos, quando a api acha telefone ou documento repetido.
   *
   * Nao e erro, e pergunta — e no balcao ela tem resposta imediata, com a
   * pessoa na frente. Recusar automaticamente travaria o cadastro de dois
   * irmaos com o telefone de casa, que acontece.
   */
  const [duplicados, setDuplicados] = useState<CandidatoCliente[] | null>(null)

  const digitos = (v: string) => v.replace(/\D/g, '')

  /*
   * O telefone vai INTEIRO no campo `celular`, e o `ddd` fica vazio.
   *
   * `salvarCliente` junta os dois (`${ddd}${celular}`) e limpa a pontuacao, e
   * o resultado e o mesmo — separar aqui so para juntar la seria trabalho para
   * criar o estado invalido "DDD de um lugar, numero de outro".
   */
  const dadosDoFormulario = () => {
    return {
      tipoPessoa: 'fisica' as const,
      documento: digitos(documento),
      nome: nome.trim(),
      /* O cadastro rapido do PDV e sempre pessoa fisica (logo acima), e pessoa
         fisica nao tem nome fantasia. */
      nomeFantasia: '',
      ddd: '',
      celular: digitos(celular),
      email: '',
      limiteFiado: '',
      cep: digitos(cep),
      logradouro: rua.trim(),
      numero: numero.trim(),
      complemento: '',
      bairro: bairro.trim(),
      cidade: cidade.trim(),
      uf,
    }
  }

  /* CEP completo preenche o resto. So o que veio: CEP de cidade inteira nao
     tem rua, e apagar a rua que a pessoa ja digitou seria pior que nao ajudar. */
  async function mudarCep(valor: string) {
    const mascarado = maskCEP(valor)
    setCep(mascarado)
    if (digitos(mascarado).length !== 8) return
    const r = await buscarCep(mascarado)
    if (!r.ok) return
    if (r.endereco.logradouro) setRua(r.endereco.logradouro)
    if (r.endereco.bairro) setBairro(r.endereco.bairro)
    if (r.endereco.cidade) setCidade(r.endereco.cidade)
    if (r.endereco.uf) setUf(r.endereco.uf)
  }

  async function enviar(confirmandoDuplicado: boolean) {
    setErro(null)
    setSalvando(true)

    const dados = dadosDoFormulario()
    const r = await salvarCliente(dados, { permitirDuplicado: confirmandoDuplicado })
    setSalvando(false)

    if (r.ok) {
      onCriado({ id: r.id, nome: dados.nome })
      return
    }

    if ('duplicados' in r) {
      setDuplicados(r.duplicados)
      return
    }

    setErro(r.error)
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault()

    if (!nome.trim()) {
      setErro('Informe o nome.')
      return
    }

    /* Documento e opcional no cadastro rapido: exigir CPF no balcao com
       fila atras trava a venda. Quando vier preenchido, e validado. */
    if (documento.trim()) {
      const erroDoc = validateCPF(documento)
      if (erroDoc) {
        setErro(erroDoc)
        return
      }
    }

    /* Celular e endereco sao obrigatorios (NR-142). Mesma regra do
       contrato, conferida aqui para nao ir a rede so para ouvir "invalido". */
    const so = digitos(celular)
    if (so.length !== 10 && so.length !== 11) {
      setErro('Informe o celular com DDD.')
      return
    }
    if (digitos(cep).length !== 8) {
      setErro('Informe o CEP.')
      return
    }
    const faltando = [
      [rua, 'a rua'],
      [numero, 'o número (ou s/n)'],
      [bairro, 'o bairro'],
      [cidade, 'a cidade'],
      [uf, 'a UF'],
    ].find(([valor]) => !valor?.trim())
    if (faltando) {
      setErro(`Informe ${faltando[1]}.`)
      return
    }

    await enviar(false)
  }

  return (
    <div className={styles.dialogRoot}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        onClick={onCancelar}
        aria-label="Fechar"
      />

      <div
        className={styles.dialogPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cadastro-rapido"
      >
        <h2 id="cadastro-rapido" className={styles.dialogTitulo}>
          Cadastro rapido
        </h2>
        <p className={styles.dialogTexto}>
          Nome, celular e endereço. O CEP preenche o resto do endereço, e e-mail e limite do fiado
          podem ser completados depois em Clientes.
        </p>

        {duplicados !== null ? (
          <div className={styles.duplicados} role="alert">
            <p>
              Já existe cliente com este telefone ou documento. Escolha um deles ou cadastre mesmo
              assim.
            </p>
            <ul>
              {duplicados.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={styles.duplicado}
                    onClick={() => onCriado({ id: d.id, nome: d.name })}
                  >
                    <strong>{d.name}</strong>
                    <span>{d.phone ?? d.document ?? 'sem contato'}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.dialogAcoes}>
              <Button variant="secondary" onClick={() => setDuplicados(null)} disabled={salvando}>
                Voltar
              </Button>
              <Button onClick={() => void enviar(true)} disabled={salvando}>
                {salvando ? (
                  <>
                    <Spinner size={15} />
                    Salvando...
                  </>
                ) : (
                  'É outra pessoa, cadastrar'
                )}
              </Button>
            </div>
          </div>
        ) : null}

        <form
          onSubmit={salvar}
          noValidate
          className={styles.formCampos}
          hidden={duplicados !== null}
        >
          <label className={styles.campo}>
            <span>Nome</span>
            <input
              className={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoFocus
            />
          </label>

          <label className={styles.campo}>
            <span>CPF (opcional)</span>
            <input
              className={styles.input}
              value={documento}
              onChange={(e) => setDocumento(maskCPF(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
          </label>

          <label className={styles.campo}>
            {/*
              Com DDD. A mascara antiga cortava em nove digitos e o contrato
              exige dez ou onze: com o mock isso nunca aparecia, e com a
              chamada de verdade todo cadastro com celular seria recusado.
            */}
            <span>Celular com DDD</span>
            <input
              className={styles.input}
              value={celular}
              onChange={(e) => setCelular(maskPhone(e.target.value))}
              placeholder="(41) 99876-5432"
              inputMode="tel"
            />
          </label>

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>CEP</span>
              <input
                className={styles.input}
                value={cep}
                onChange={(e) => void mudarCep(e.target.value)}
                placeholder="00000-000"
                inputMode="numeric"
              />
            </label>
            <label className={styles.campo}>
              <span>Número</span>
              <input
                className={styles.input}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </label>
          </div>

          <label className={styles.campo}>
            <span>Rua</span>
            <input className={styles.input} value={rua} onChange={(e) => setRua(e.target.value)} />
          </label>

          <label className={styles.campo}>
            <span>Bairro</span>
            <input
              className={styles.input}
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
            />
          </label>

          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span>Cidade</span>
              <input
                className={styles.input}
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
              />
            </label>
            <label className={styles.campo}>
              <span>UF</span>
              <select className={styles.input} value={uf} onChange={(e) => setUf(e.target.value)}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}

          <div className={styles.dialogAcoes}>
            <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? (
                <>
                  <Spinner size={15} />
                  Salvando...
                </>
              ) : (
                'Cadastrar e continuar'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
