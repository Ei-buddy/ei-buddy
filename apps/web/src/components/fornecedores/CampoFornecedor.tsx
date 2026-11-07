'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  cadastrarFornecedor,
  type DadosDoFornecedor,
  documentoFormatado,
  type FornecedorCadastrado,
  listarFornecedores,
  nomeDoFornecedor,
  pareceDocumento,
} from '@/lib/fornecedores-cadastro-api'
import { buscarCnpj } from '@/lib/empresa-api'
import { Field, FormGrid, Input } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { IconClose, IconPlus, IconSearch } from '@/components/Icons'
import { useDialogo } from '@/components/app/useDialogo'
import campo from '@/components/app/campoTag.module.css'
import dialogo from '@/components/app/dialog.module.css'
import styles from './campoFornecedor.module.css'

const digitos = (t: string) => t.replace(/\D/g, '')

/**
 * Campo de fornecedor ligado ao CADASTRO de fornecedores (NR-191) — achado do
 * QA: "assumir a busca no novo cadastro do fornecedor".
 *
 * Antes, o produto e a conta a pagar sugeriam nomes soltos: o que ja tinha
 * sido digitado em outros produtos, ou qualquer contraparte que aparecesse na
 * lista (plano de conta inclusive). Agora a busca e no cadastro, por nome,
 * fantasia, CNPJ ou telefone; quem nao esta la e cadastrado sem sair da tela,
 * num formulario curto que JA VEM com o que foi digitado.
 *
 * O texto livre continua valendo, como na entrada de mercadoria: o campo
 * guarda nome, e travar o lancamento por falta de cadastro seria pior.
 *
 * Enter nunca envia o formulario de fora: escolhe da lista.
 */
export default function CampoFornecedor({
  valor,
  onChange,
  ariaLabel = 'Fornecedor',
  placeholder = 'Buscar por nome ou CNPJ',
  invalido = false,
  id,
}: {
  valor: string
  /** `fornecedor` e `null` quando o nome foi digitado e nao escolhido. */
  onChange: (nome: string, fornecedor: FornecedorCadastrado | null) => void
  ariaLabel?: string
  placeholder?: string
  invalido?: boolean
  id?: string
}) {
  const idDaLista = useId()
  const [texto, setTexto] = useState(valor)
  const [valorVisto, setValorVisto] = useState(valor)
  const [aberto, setAberto] = useState(false)
  const [achados, setAchados] = useState<FornecedorCadastrado[] | null>(null)
  const [destacado, setDestacado] = useState(0)
  /* `true` escolhido da lista; `false` digitado; `null` veio pronto do pai. */
  const [doCadastro, setDoCadastro] = useState<boolean | null>(null)
  const [cadastrando, setCadastrando] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /* Devolver o foco ao campo (depois do cadastro) nao reabre a lista. */
  const focoSemListaRef = useRef(false)

  function focarSemLista() {
    focoSemListaRef.current = true
    inputRef.current?.focus()
  }

  /* O pai trocou o valor (produto carregado, formulario limpo): o campo segue. */
  if (valor !== valorVisto) {
    setValorVisto(valor)
    setTexto(valor)
    setDoCadastro(null)
  }

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    const t = setTimeout(() => {
      void listarFornecedores({ termo: texto }).then((r) => {
        if (cancelado) return
        setAchados(r.ok ? r.dados.slice(0, 8) : [])
        setDestacado(0)
      })
    }, 200)
    return () => {
      cancelado = true
      clearTimeout(t)
    }
  }, [aberto, texto])

  const lista = aberto ? (achados ?? []) : []
  const limpo = texto.trim()
  /* Oferece cadastrar, a menos que o texto ja seja um fornecedor da lista. */
  const jaExiste = lista.some(
    (f) =>
      f.name.toLowerCase() === limpo.toLowerCase() ||
      (f.tradeName ?? '').toLowerCase() === limpo.toLowerCase(),
  )
  const podeCadastrar = !jaExiste
  const total = lista.length + (podeCadastrar ? 1 : 0)

  function escolher(f: FornecedorCadastrado) {
    const nome = nomeDoFornecedor(f)
    setTexto(nome)
    setValorVisto(nome)
    setDoCadastro(true)
    setAberto(false)
    onChange(nome, f)
  }

  function abrirCadastro() {
    setAberto(false)
    setCadastrando(limpo)
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!aberto) return setAberto(true)
      setDestacado((d) => (d + 1) % Math.max(total, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestacado((d) => (d - 1 + total) % Math.max(total, 1))
      return
    }
    if (e.key === 'Enter') {
      /* Nunca deixa o Enter chegar ao formulario de fora. */
      e.preventDefault()
      if (!aberto) return setAberto(true)
      if (achados === null) return
      if (destacado < lista.length) escolher(lista[destacado]!)
      else if (podeCadastrar) abrirCadastro()
      return
    }
    if (e.key === 'Escape' && aberto) {
      e.preventDefault()
      setAberto(false)
    }
  }

  function aoSairDoFoco(e: React.FocusEvent) {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return
    setAberto(false)
  }

  return (
    <>
      <div className={campo.wrap} ref={wrapRef} onBlur={aoSairDoFoco}>
        <div className={`${campo.campo} ${invalido ? campo.campoInvalido : ''}`}>
          <IconSearch size={16} />
          <input
            id={id}
            ref={inputRef}
            className={campo.input}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setValorVisto(e.target.value)
              setDoCadastro(false)
              setAberto(true)
              onChange(e.target.value, null)
            }}
            onFocus={() => {
              if (focoSemListaRef.current) {
                focoSemListaRef.current = false
                return
              }
              setAberto(true)
            }}
            onClick={() => setAberto(true)}
            onKeyDown={aoTeclar}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-expanded={aberto}
            aria-autocomplete="list"
            role="combobox"
            aria-controls={idDaLista}
            autoComplete="off"
          />
          {texto !== '' ? (
            <button
              type="button"
              className={campo.limpar}
              onClick={() => {
                setTexto('')
                setValorVisto('')
                setDoCadastro(null)
                onChange('', null)
                inputRef.current?.focus()
              }}
              aria-label={`Limpar ${ariaLabel}`}
            >
              ×
            </button>
          ) : null}
        </div>

        {aberto ? (
          <ul
            className={campo.lista}
            id={idDaLista}
            role="listbox"
            aria-label="Fornecedores cadastrados"
          >
            {achados === null ? <li className={campo.vazio}>Buscando…</li> : null}
            {achados !== null && lista.length === 0 ? (
              <li className={campo.vazio}>
                {limpo === ''
                  ? 'Nenhum fornecedor cadastrado ainda.'
                  : 'Nenhum fornecedor cadastrado com esse nome.'}
              </li>
            ) : null}
            {lista.map((f, i) => (
              <li key={f.id} role="option" aria-selected={i === destacado}>
                <button
                  type="button"
                  className={`${campo.opcao} ${styles.opcao} ${i === destacado ? campo.opcaoAtiva : ''}`}
                  onMouseEnter={() => setDestacado(i)}
                  onClick={() => escolher(f)}
                >
                  <span className={styles.nome}>{nomeDoFornecedor(f)}</span>
                  <span className={styles.apoio}>
                    {[f.tradeName ? f.name : null, documentoFormatado(f.document) || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
            {achados !== null && podeCadastrar ? (
              <li role="option" aria-selected={destacado === lista.length}>
                <button
                  type="button"
                  className={`${campo.criar} ${destacado === lista.length ? campo.opcaoAtiva : ''}`}
                  onMouseEnter={() => setDestacado(lista.length)}
                  onClick={abrirCadastro}
                >
                  <IconPlus size={14} />
                  {limpo === ''
                    ? 'Cadastrar novo fornecedor'
                    : `Cadastrar “${limpo}” como fornecedor`}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        {doCadastro === false && limpo !== '' && !aberto ? (
          <small className={styles.aviso}>
            Fora do cadastro de fornecedores.{' '}
            <button type="button" className={styles.link} onClick={abrirCadastro}>
              Cadastrar agora
            </button>
          </small>
        ) : null}
      </div>

      {cadastrando !== null
        ? createPortal(
            <NovoFornecedorDialog
              buscado={cadastrando}
              onCadastrado={(f) => {
                setCadastrando(null)
                escolher(f)
                focarSemLista()
              }}
              onCancelar={() => {
                setCadastrando(null)
                focarSemLista()
              }}
            />,
            /* Dentro do `.appTheme`: e la que moram as cores do app. No
               `body`, o dialogo saia transparente. Fora do Card: o vidro dele
               (`backdrop-filter`) prenderia o `position: fixed`. */
            document.querySelector('.appTheme') ?? document.body,
          )
        : null}
    </>
  )
}

type Endereco = NonNullable<DadosDoFornecedor['address']>

/** O que a Receita devolve, no formato do cadastro. Campo vazio nao vai. */
function dadosDoCnpj(r: {
  razaoSocial: string
  nomeFantasia: string
  cep: string
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  uf: string
}): { nome: string; fantasia: string; endereco: Endereco | null } {
  const endereco = Object.fromEntries(
    Object.entries({
      zipCode: digitos(r.cep),
      street: r.logradouro,
      number: r.numero,
      district: r.bairro,
      city: r.cidade,
      state: r.uf,
    }).filter(([, v]) => v.trim() !== ''),
  )
  return {
    nome: r.razaoSocial,
    fantasia: r.nomeFantasia,
    endereco: Object.keys(endereco).length > 0 ? endereco : null,
  }
}

/**
 * Cadastro rapido de fornecedor, aberto de dentro de outro formulario.
 *
 * Comeca com o que foi buscado: digitos de CNPJ vao para o documento (e o
 * CNPJ completo ja busca razao social, fantasia e endereco na Receita);
 * qualquer outra coisa vai para o nome. O resto do cadastro — IE, contato,
 * observacao — continua na tela de Fornecedores.
 */
export function NovoFornecedorDialog({
  buscado,
  onCadastrado,
  onCancelar,
}: {
  buscado: string
  onCadastrado: (f: FornecedorCadastrado) => void
  onCancelar: () => void
}) {
  const documentoInicial = pareceDocumento(buscado) ? buscado.trim() : ''
  const [documento, setDocumento] = useState(documentoInicial)
  const [nome, setNome] = useState(documentoInicial === '' ? buscado.trim() : '')
  const [fantasia, setFantasia] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [endereco, setEndereco] = useState<Endereco | null>(null)
  const [buscandoDoc, setBuscandoDoc] = useState(digitos(documentoInicial).length === 14)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  /* Esc, rolagem e foco pelo gancho comum: na pilha de dialogos, o Esc daqui
     fecha so este cadastro, e nao a nova conta a pagar que esta embaixo. */
  const painelRef = useRef<HTMLDivElement>(null)
  useDialogo(painelRef, onCancelar, salvando)
  const consultadoRef = useRef<string | null>(null)

  async function preencherPeloCnpj(silencioso: boolean) {
    if (digitos(documento).length !== 14) {
      if (!silencioso) setErro('Informe o CNPJ completo para buscar.')
      return
    }
    /* Sair do campo nao consulta de novo o CNPJ que acabou de ser consultado. */
    if (silencioso && consultadoRef.current === digitos(documento)) return
    consultadoRef.current = digitos(documento)
    setBuscandoDoc(true)
    const r = await buscarCnpj(documento)
    setBuscandoDoc(false)
    if (!r.ok) {
      if (!silencioso) setErro(r.error)
      return
    }
    setErro(null)
    const d = dadosDoCnpj(r.dados)
    setNome(d.nome)
    setFantasia(d.fantasia)
    setEndereco(d.endereco)
  }

  /* CNPJ completo vindo da busca: ja traz os dados, sem pedir clique. */
  useEffect(() => {
    if (digitos(documentoInicial).length !== 14) return
    consultadoRef.current = digitos(documentoInicial)
    let cancelado = false
    void buscarCnpj(documentoInicial).then((r) => {
      if (cancelado) return
      setBuscandoDoc(false)
      if (!r.ok) return
      const d = dadosDoCnpj(r.dados)
      setNome(d.nome)
      setFantasia(d.fantasia)
      setEndereco(d.endereco)
    })
    return () => {
      cancelado = true
    }
  }, [documentoInicial])

  async function salvar(e: FormEvent) {
    /* O dialogo vive num portal, mas o evento ainda sobe pela arvore do React
       ate o formulario de fora — sem isto, salvar o fornecedor salvava o
       produto junto. */
    e.preventDefault()
    e.stopPropagation()
    if (nome.trim().length < 2) {
      setErro('Informe o nome do fornecedor.')
      return
    }
    setSalvando(true)
    setErro(null)
    const dados: DadosDoFornecedor = {
      name: nome.trim(),
      ...(fantasia.trim() !== '' ? { tradeName: fantasia.trim() } : {}),
      ...(digitos(documento) !== '' ? { document: digitos(documento) } : {}),
      ...(digitos(telefone) !== '' ? { phone: digitos(telefone) } : {}),
      ...(email.trim() !== '' ? { email: email.trim() } : {}),
      ...(endereco !== null ? { address: endereco } : {}),
    }
    const r = await cadastrarFornecedor(dados)
    setSalvando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    onCadastrado(r.dados)
  }

  const linhaDoEndereco =
    endereco === null
      ? null
      : [
          [endereco.street, endereco.number].filter(Boolean).join(', '),
          [endereco.city, endereco.state].filter(Boolean).join('/'),
        ]
          .filter(Boolean)
          .join(' — ')

  return (
    <div className={dialogo.root}>
      <button
        type="button"
        className={dialogo.backdrop}
        onClick={() => !salvando && onCancelar()}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div
        ref={painelRef}
        tabIndex={-1}
        className={`${dialogo.painel} ${styles.painel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-fornecedor-titulo"
      >
        <header className={dialogo.cabecalho}>
          <h2 id="novo-fornecedor-titulo" className={dialogo.titulo}>
            Novo fornecedor
          </h2>
          <button
            type="button"
            className={dialogo.fechar}
            onClick={onCancelar}
            disabled={salvando}
            aria-label="Fechar"
          >
            <IconClose size={18} />
          </button>
        </header>
        <form onSubmit={(e) => void salvar(e)} noValidate>
          <FormGrid>
            <Field label="CNPJ ou CPF" span={12} hint="o CNPJ busca os dados na Receita">
              <div className={styles.inline}>
                <Input
                  autoFocus={documentoInicial !== '' || buscado.trim() === ''}
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  onBlur={() => {
                    if (nome.trim() === '') void preencherPeloCnpj(true)
                  }}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  aria-label="CNPJ ou CPF"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void preencherPeloCnpj(false)}
                  disabled={buscandoDoc}
                >
                  {buscandoDoc ? 'Buscando…' : 'Buscar'}
                </Button>
              </div>
            </Field>
            <Field label="Razão social ou nome" span={12} obrigatorio>
              <Input
                autoFocus={documentoInicial === '' && buscado.trim() !== ''}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={160}
                aria-label="Razão social ou nome"
              />
            </Field>
            <Field label="Nome fantasia" span={12}>
              <Input
                value={fantasia}
                onChange={(e) => setFantasia(e.target.value)}
                maxLength={160}
                aria-label="Nome fantasia"
              />
            </Field>
            <Field label="Telefone" span={6}>
              <Input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                placeholder="(41) 3333-4444"
                aria-label="Telefone"
              />
            </Field>
            <Field label="E-mail" span={6}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="E-mail"
              />
            </Field>
          </FormGrid>
          {linhaDoEndereco !== null ? (
            <p className={styles.endereco}>Endereço da Receita: {linhaDoEndereco}</p>
          ) : null}
          {erro !== null ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
          <div className={`${dialogo.acoes} ${styles.acoes}`}>
            <Button type="button" variant="ghost" onClick={onCancelar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Cadastrando…' : 'Cadastrar e usar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
