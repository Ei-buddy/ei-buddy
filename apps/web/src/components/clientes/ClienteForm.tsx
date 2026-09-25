'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { buscarCep, UFS } from '@/lib/empresa-api'
import { buscarCnpj } from '@/lib/empresa-api'
import {
  atualizarCliente,
  buscarCpf,
  type CandidatoCliente,
  type ClienteDaFicha,
  salvarCliente,
} from '@/lib/clientes-api'
import {
  maskCelular,
  maskCEP,
  maskDocumento,
  validateCelular,
  validateCEP,
  validateDDD,
  validateDocumento,
  validateRequired,
  type FieldError,
} from '@/lib/validation'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, Field, FormGrid, Input, PageHeader, Select } from '@/components/ui/UI'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconSearch } from '@/components/Icons'
import styles from './clienteForm.module.css'

type TipoPessoa = 'fisica' | 'juridica'

type Campos = {
  documento: string
  nome: string
  nomeFantasia: string
  email: string
  ddd: string
  celular: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

const VAZIO: Campos = {
  documento: '',
  nome: '',
  nomeFantasia: '',
  email: '',
  ddd: '',
  celular: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
}

/**
 * A ficha gravada vira os campos da tela — RF-009.
 *
 * Sem cliente (cadastro novo) devolve `VAZIO`, e por isso o formulario tem um
 * caminho so: quem cadastra e quem edita passam pelas mesmas mascaras e pelas
 * mesmas validacoes.
 *
 * `?? ''` em tudo porque a ficha e anulavel e o campo de texto nao: um `null`
 * num `<input value>` faz o React trocar para nao-controlado no meio da
 * digitacao, e o campo para de responder.
 */
function paraCampos(cliente?: ClienteDaFicha): Campos {
  if (cliente === undefined) return VAZIO

  return {
    documento: cliente.documento ?? '',
    nome: cliente.nome,
    nomeFantasia: cliente.nomeFantasia ?? '',
    email: cliente.email ?? '',
    ddd: cliente.ddd ?? '',
    celular: cliente.celular ?? '',
    cep: cliente.endereco.cep ?? '',
    logradouro: cliente.endereco.logradouro ?? '',
    numero: cliente.endereco.numero ?? '',
    complemento: cliente.endereco.complemento ?? '',
    bairro: cliente.endereco.bairro ?? '',
    cidade: cliente.endereco.cidade ?? '',
    uf: cliente.endereco.uf ?? '',
  }
}

type Erros = Partial<Record<keyof Campos, FieldError>>

/**
 * Cadastro e edicao do cliente — RF-009, RF-010.
 *
 * Um componente para os dois, e nao dois parecidos: os campos, as mascaras, a
 * validacao condicional de PJ e a busca de CEP sao os mesmos, e duas copias
 * divergiriam no primeiro campo novo. O que muda e o verbo e a busca por
 * parecido — ver `salvar` abaixo.
 */
export default function ClienteForm({ cliente }: { cliente?: ClienteDaFicha } = {}) {
  const router = useRouter()

  const [tipo, setTipo] = useState<TipoPessoa>(
    cliente?.tipoPessoa === 'juridica' ? 'juridica' : 'fisica',
  )
  const [campos, setCampos] = useState<Campos>(() => paraCampos(cliente))
  const [erros, setErros] = useState<Erros>({})

  const [buscandoCep, setBuscandoCep] = useState(false)
  const [buscandoDoc, setBuscandoDoc] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const [avisoCep, setAvisoCep] = useState<string | null>(null)
  const [avisoDoc, setAvisoDoc] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)
  /** Clientes parecidos que a api encontrou — RF-010. */
  const [duplicados, setDuplicados] = useState<CandidatoCliente[] | null>(null)

  /*
   * Em edicao, o formulario abre com o que esta gravado.
   *
   * `useState` com inicializador, e nao `useEffect` que preenche depois: o
   * segundo desenharia os campos vazios por um quadro e so entao os preencheria
   * — e quem digitasse rapido perderia o que escreveu.
   */
  const editando = cliente !== undefined

  const rotuloDocumento = tipo === 'fisica' ? 'CPF' : 'CNPJ'
  const rotuloNome = tipo === 'fisica' ? 'Nome completo' : 'Razão social'

  function set<K extends keyof Campos>(campo: K, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }))
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: null }))
  }

  /** Trocar o tipo limpa o documento — a mascara e a validacao mudam. */
  function trocarTipo(novo: TipoPessoa) {
    setTipo(novo)
    setCampos((c) => ({ ...c, documento: '' }))
    setErros((e) => ({ ...e, documento: null }))
    setAvisoDoc(null)
  }

  /* ---------------------------------------------------------------- *
   * Busca por CEP
   * ---------------------------------------------------------------- */

  async function preencherPorCep(cepFormatado: string) {
    if (cepFormatado.replace(/\D/g, '').length !== 8) return

    setBuscandoCep(true)
    setAvisoCep(null)

    const resultado = await buscarCep(cepFormatado)
    setBuscandoCep(false)

    if (!resultado.ok) {
      setAvisoCep(resultado.error)
      return
    }

    setCampos((c) => ({
      ...c,
      logradouro: resultado.endereco.logradouro,
      bairro: resultado.endereco.bairro,
      cidade: resultado.endereco.cidade,
      uf: resultado.endereco.uf,
    }))
    setErros((e) => ({ ...e, logradouro: null, bairro: null, cidade: null, uf: null }))
  }

  /* ---------------------------------------------------------------- *
   * Busca por documento (CPF ou CNPJ)
   * ---------------------------------------------------------------- */

  async function preencherPorDocumento() {
    setAvisoDoc(null)

    const erro = validateDocumento(campos.documento, tipo)
    if (erro) {
      setErros((e) => ({ ...e, documento: erro }))
      return
    }

    setBuscandoDoc(true)

    if (tipo === 'juridica') {
      const r = await buscarCnpj(campos.documento)
      setBuscandoDoc(false)

      if (!r.ok) {
        setAvisoDoc(r.error)
        return
      }

      setCampos((c) => ({
        ...c,
        nome: r.dados.razaoSocial,
        /* A consulta ja devolvia o fantasia, e o formulario descartava por nao
           ter onde por. */
        nomeFantasia: r.dados.nomeFantasia,
        cep: r.dados.cep,
        logradouro: r.dados.logradouro,
        numero: r.dados.numero,
        bairro: r.dados.bairro,
        cidade: r.dados.cidade,
        uf: r.dados.uf,
      }))
      setErros({})
      setToast({ msg: 'Dados preenchidos a partir do CNPJ.', tone: 'success' })
      return
    }

    const r = await buscarCpf(campos.documento)
    setBuscandoDoc(false)

    if (!r.ok) {
      setAvisoDoc(r.error)
      return
    }

    setCampos((c) => ({ ...c, nome: r.nome }))
    setErros((e) => ({ ...e, nome: null }))
    setToast({ msg: 'Nome preenchido a partir do CPF.', tone: 'success' })
  }

  /* ---------------------------------------------------------------- *
   * Gravacao
   * ---------------------------------------------------------------- */

  function validarTudo(): boolean {
    const novos: Erros = {
      documento: validateDocumento(campos.documento, tipo),
      nome: validateRequired(campos.nome, tipo === 'fisica' ? 'o nome' : 'a razão social'),
      /* Fantasia so e exigido de PJ: pessoa fisica nao tem. A mesma regra
         existe no contrato, e a daqui serve para a pessoa ver o erro NO
         CAMPO em vez de receber um 400 depois de preencher a tela inteira. */
      nomeFantasia:
        tipo === 'juridica' ? validateRequired(campos.nomeFantasia, 'o nome fantasia') : null,
      ddd: validateDDD(campos.ddd),
      celular: validateCelular(campos.celular),
      cep: validateCEP(campos.cep),
      logradouro: validateRequired(campos.logradouro, 'o logradouro'),
      numero: validateRequired(campos.numero, 'o numero'),
      bairro: validateRequired(campos.bairro, 'o bairro'),
      cidade: validateRequired(campos.cidade, 'a cidade'),
      uf: validateRequired(campos.uf, 'a UF'),
    }

    setErros(novos)
    return !Object.values(novos).some(Boolean)
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault()

    if (!validarTudo()) {
      setToast({ msg: 'Confira os campos destacados antes de salvar.', tone: 'error' })
      return
    }

    setSalvando(true)

    /*
     * Editar NAO procura parecido. A RF-010 avisa sobre duplicata no cadastro,
     * quando o balcao pode estar criando de novo alguem que ja existe; na
     * edicao a pessoa esta olhando para a ficha que escolheu abrir, e a
     * interrupcao atrapalharia o conserto em vez de evitar o erro.
     */
    const resultado = editando
      ? await atualizarCliente(cliente.id, { ...campos, tipoPessoa: tipo })
      : await salvarCliente({ ...campos, tipoPessoa: tipo })
    setSalvando(false)

    if (!resultado.ok) {
      /*
       * Duplicado NAO e erro — RF-010. A api devolve os candidatos em vez de
       * recusar, e a decisao de reusar o existente e de quem esta no balcao,
       * com o cliente na frente. Mostrar "erro ao salvar" aqui esconderia a
       * escolha e faria a pessoa tentar de novo, com o mesmo resultado.
       */
      if ('duplicados' in resultado) {
        setDuplicados(resultado.duplicados)
        return
      }
      setToast({ msg: resultado.error, tone: 'error' })
      return
    }

    setToast({ msg: 'Cliente cadastrado.', tone: 'success' })
    /* Depois de editar, volta para a FICHA: quem corrigiu um telefone quer
       conferir o resultado, e a lista nao mostra telefone. */
    router.push(editando ? `/app/clientes/${cliente.id}` : '/app/clientes')
  }

  /**
   * Cadastra apesar do parecido — RF-010.
   *
   * A segunda passada, depois de a pessoa ter visto a lista e decidido. Sem
   * `permitirDuplicado`, a api responderia 409 de novo e o dialogo reabriria
   * em laco.
   */
  async function cadastrarMesmoAssim() {
    setDuplicados(null)
    setSalvando(true)
    const r = await salvarCliente({ ...campos, tipoPessoa: tipo }, { permitirDuplicado: true })
    setSalvando(false)

    if (!r.ok) {
      setToast({ msg: 'duplicados' in r ? 'Não foi possível cadastrar.' : r.error, tone: 'error' })
      return
    }

    setToast({ msg: 'Cliente cadastrado.', tone: 'success' })
    router.push('/app/clientes')
  }

  /** Campo com mensagem de erro embaixo. */
  function erroDe(campo: keyof Campos) {
    return erros[campo] ? (
      <span className={styles.erro} role="alert">
        {erros[campo]}
      </span>
    ) : null
  }

  return (
    <>
      <PageHeader
        title="Novo cliente"
        subtitle="Cadastro de pessoa física ou jurídica"
        actions={
          <ButtonLink href="/app/clientes" variant="secondary">
            Cancelar
          </ButtonLink>
        }
      />

      <form onSubmit={salvar} noValidate className={styles.form}>
        <Card title="Identificação">
          {/* Toggle de tipo de documento */}
          <div className={styles.tipoToggle} role="group" aria-label="Tipo de pessoa">
            <button
              type="button"
              className={`${styles.tipoBotao} ${tipo === 'fisica' ? styles.tipoAtivo : ''}`}
              onClick={() => trocarTipo('fisica')}
              aria-pressed={tipo === 'fisica'}
            >
              Pessoa física
            </button>
            <button
              type="button"
              className={`${styles.tipoBotao} ${tipo === 'juridica' ? styles.tipoAtivo : ''}`}
              onClick={() => trocarTipo('juridica')}
              aria-pressed={tipo === 'juridica'}
            >
              Pessoa jurídica
            </button>
          </div>

          <FormGrid>
            <Field label={rotuloDocumento} span={5}>
              <div className={styles.inline}>
                <Input
                  value={campos.documento}
                  onChange={(e) => set('documento', maskDocumento(e.target.value, tipo))}
                  onBlur={() =>
                    setErros((er) => ({
                      ...er,
                      documento: validateDocumento(campos.documento, tipo),
                    }))
                  }
                  placeholder={tipo === 'fisica' ? '000.000.000-00' : '00.000.000/0000-00'}
                  inputMode="numeric"
                  aria-invalid={Boolean(erros.documento)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={preencherPorDocumento}
                  disabled={buscandoDoc}
                >
                  {buscandoDoc ? <Spinner size={14} /> : <IconSearch size={15} />}
                  Buscar
                </Button>
              </div>
              {erroDe('documento')}
              {avisoDoc ? (
                <span className={styles.aviso} role="status">
                  {avisoDoc}
                </span>
              ) : null}
            </Field>

            <Field label={rotuloNome} span={7}>
              <Input
                value={campos.nome}
                onChange={(e) => set('nome', e.target.value)}
                aria-invalid={Boolean(erros.nome)}
              />
              {erroDe('nome')}
            </Field>

            {/*
              So para PJ, e nao um campo sempre visivel e desabilitado: pessoa
              fisica nao tem nome fantasia, e mostrar o campo apagado convida a
              pergunta "por que nao posso preencher?".
            */}
            {tipo === 'juridica' ? (
              <Field label="Nome fantasia" span={12}>
                <Input
                  value={campos.nomeFantasia}
                  onChange={(e) => set('nomeFantasia', e.target.value)}
                  placeholder="Como a loja conhece este cliente"
                  aria-invalid={Boolean(erros.nomeFantasia)}
                />
                {erroDe('nomeFantasia')}
              </Field>
            ) : null}

            <Field label="DDD" span={2}>
              <Input
                value={campos.ddd}
                onChange={(e) => set('ddd', e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric"
                placeholder="41"
                aria-invalid={Boolean(erros.ddd)}
              />
              {erroDe('ddd')}
            </Field>

            <Field label="Celular / WhatsApp" span={5}>
              <Input
                value={campos.celular}
                onChange={(e) => set('celular', maskCelular(e.target.value))}
                inputMode="tel"
                placeholder="99876-5432"
                aria-invalid={Boolean(erros.celular)}
              />
              {erroDe('celular')}
            </Field>

            <Field label="E-mail" span={5} hint="Opcional">
              <Input
                type="email"
                value={campos.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="cliente@email.com"
              />
            </Field>
          </FormGrid>
        </Card>

        <Card title="Endereço">
          <FormGrid>
            <Field label="CEP" span={4}>
              <div className={styles.inline}>
                <Input
                  value={campos.cep}
                  onChange={(e) => {
                    const m = maskCEP(e.target.value)
                    set('cep', m)
                    setAvisoCep(null)
                    void preencherPorCep(m)
                  }}
                  placeholder="00000-000"
                  inputMode="numeric"
                  aria-invalid={Boolean(erros.cep)}
                />
                {buscandoCep ? (
                  <span className={styles.inlineSpinner}>
                    <Spinner size={16} />
                  </span>
                ) : null}
              </div>
              {erroDe('cep')}
              {avisoCep ? (
                <span className={styles.aviso} role="status">
                  {avisoCep}
                </span>
              ) : null}
            </Field>

            <Field label="Logradouro" span={8}>
              <Input
                value={campos.logradouro}
                onChange={(e) => set('logradouro', e.target.value)}
                aria-invalid={Boolean(erros.logradouro)}
              />
              {erroDe('logradouro')}
            </Field>

            <Field label="Número" span={3}>
              <Input
                value={campos.numero}
                onChange={(e) => set('numero', e.target.value)}
                aria-invalid={Boolean(erros.numero)}
              />
              {erroDe('numero')}
            </Field>

            <Field label="Complemento" span={4}>
              <Input
                value={campos.complemento}
                onChange={(e) => set('complemento', e.target.value)}
                placeholder="Apto, bloco, sala"
              />
            </Field>

            <Field label="Bairro" span={5}>
              <Input
                value={campos.bairro}
                onChange={(e) => set('bairro', e.target.value)}
                aria-invalid={Boolean(erros.bairro)}
              />
              {erroDe('bairro')}
            </Field>

            <Field label="Cidade" span={8}>
              <Input
                value={campos.cidade}
                onChange={(e) => set('cidade', e.target.value)}
                aria-invalid={Boolean(erros.cidade)}
              />
              {erroDe('cidade')}
            </Field>

            <Field label="UF" span={4}>
              <Select
                value={campos.uf}
                onChange={(e) => set('uf', e.target.value)}
                aria-invalid={Boolean(erros.uf)}
              >
                <option value="">--</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
              {erroDe('uf')}
            </Field>
          </FormGrid>
        </Card>

        <div className={styles.rodape}>
          <ButtonLink href="/app/clientes" variant="secondary">
            Cancelar
          </ButtonLink>
          <Button type="submit" disabled={salvando}>
            {salvando ? (
              <>
                <Spinner size={15} />
                Salvando...
              </>
            ) : (
              'Cadastrar cliente'
            )}
          </Button>
        </div>
      </form>

      {duplicados !== null ? (
        <div className={styles.duplicados} role="dialog" aria-label="Clientes parecidos">
          <p className={styles.duplicadosTitulo}>
            Já existe cliente com este telefone ou documento.
          </p>
          <ul className={styles.duplicadosLista}>
            {duplicados.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.phone ? <span> · {c.phone}</span> : null}
                {c.document ? <span> · {c.document}</span> : null}
              </li>
            ))}
          </ul>
          <div className={styles.duplicadosAcoes}>
            <button type="button" onClick={() => setDuplicados(null)}>
              Voltar e conferir
            </button>
            <button type="button" onClick={() => void cadastrarMesmoAssim()} disabled={salvando}>
              Cadastrar mesmo assim
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
