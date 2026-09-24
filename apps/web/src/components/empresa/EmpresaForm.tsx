'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  buscarCep,
  buscarCnpj,
  carregarEmpresa,
  RAMOS_ATIVIDADE,
  salvarEmpresa,
  UFS,
  type Certificado,
} from '@/lib/empresa-api'
import {
  maskCelular,
  maskCEP,
  maskCNPJ,
  validateCelular,
  validateCEP,
  validateCNPJ,
  validateDDD,
  validateRequired,
  type FieldError,
} from '@/lib/validation'
import { Button } from '@/components/ui/Button'
import { Card, Checkbox, Field, FormGrid, Input, PageHeader, Select } from '@/components/ui/UI'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconSearch } from '@/components/Icons'
import CertificadoDigital from './CertificadoDigital'
import ComandosWhatsApp from '@/components/app/ComandosWhatsApp'
import styles from './empresa.module.css'

type Campos = {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  ramoAtividade: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  ddd: string
  celular: string
}

type Erros = Partial<Record<keyof Campos, FieldError>>

/** O formulario em branco — o estado antes de a api responder. */
const VAZIO: Campos = {
  cnpj: '',
  razaoSocial: '',
  nomeFantasia: '',
  inscricaoEstadual: '',
  inscricaoMunicipal: '',
  ramoAtividade: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  ddd: '',
  celular: '',
}

export default function EmpresaForm() {
  /*
   * Comeca VAZIO, e nao com dados de exemplo.
   *
   * A tela abria com o CNPJ, o endereco e as inscricoes de uma mercearia de
   * exemplo, iguais para toda loja. Quem salvasse sem reparar gravaria os
   * dados de outra empresa por cima dos seus — e antes da 0021 nem gravava,
   * porque `salvarEmpresa` era `await delay(900)`.
   *
   * Campo em branco enquanto carrega e honesto: diz que ainda nao se sabe.
   */
  const [campos, setCampos] = useState<Campos>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarEmpresa()
    setCarregando(false)

    if (!r.ok) {
      setErroCarga(r.erro)
      return
    }

    setErroCarga(null)
    /* O CNPJ vem do servidor e nao se edita: trocar CNPJ e outra empresa, e o
       contrato de atualizacao nem o aceita. */
    setCampos({ ...r.dados })
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem todos depois do await, nunca
       sincronos no corpo do efeito. */
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  const [erros, setErros] = useState<Erros>({})
  const [conexoes, setConexoes] = useState(false)
  const [certificado, setCertificado] = useState<Certificado | null>(null)

  const [buscandoCep, setBuscandoCep] = useState(false)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const [avisoCep, setAvisoCep] = useState<string | null>(null)
  const [avisoCnpj, setAvisoCnpj] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  function set<K extends keyof Campos>(campo: K, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }))
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: null }))
  }

  /* ---------------------------------------------------------------- *
   * Busca de CEP — dispara sozinha quando o CEP fica completo
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

    /* Numero e complemento continuam com quem preencheu — o CEP nao os
       conhece, e sobrescrever apagaria o que a pessoa ja digitou. */
    setCampos((c) => ({
      ...c,
      logradouro: resultado.endereco.logradouro,
      bairro: resultado.endereco.bairro,
      cidade: resultado.endereco.cidade,
      uf: resultado.endereco.uf,
    }))
    setErros((e) => ({ ...e, logradouro: null, bairro: null, cidade: null }))
  }

  /* ---------------------------------------------------------------- *
   * Busca de CNPJ — acionada pelo botao
   * ---------------------------------------------------------------- */

  async function preencherPorCnpj() {
    setAvisoCnpj(null)

    const erroCnpj = validateCNPJ(campos.cnpj)
    if (erroCnpj) {
      setErros((e) => ({ ...e, cnpj: erroCnpj }))
      return
    }

    setBuscandoCnpj(true)

    const resultado = await buscarCnpj(campos.cnpj)
    setBuscandoCnpj(false)

    if (!resultado.ok) {
      setAvisoCnpj(resultado.error)
      return
    }

    const d = resultado.dados
    setCampos((c) => ({
      ...c,
      razaoSocial: d.razaoSocial,
      nomeFantasia: d.nomeFantasia,
      ramoAtividade: d.ramoAtividade,
      cep: d.cep,
      logradouro: d.logradouro,
      numero: d.numero,
      bairro: d.bairro,
      cidade: d.cidade,
      uf: d.uf,
    }))
    setErros({})
    setToast({ msg: 'Dados públicos preenchidos a partir do CNPJ.', tone: 'success' })
  }

  /* ---------------------------------------------------------------- *
   * Gravacao
   * ---------------------------------------------------------------- */

  function validarTudo(): boolean {
    const novos: Erros = {
      cnpj: validateCNPJ(campos.cnpj),
      razaoSocial: validateRequired(campos.razaoSocial, 'a razão social'),
      ramoAtividade: validateRequired(campos.ramoAtividade, 'o ramo de atividade'),
      cep: validateCEP(campos.cep),
      logradouro: validateRequired(campos.logradouro, 'o logradouro'),
      numero: validateRequired(campos.numero, 'o numero'),
      bairro: validateRequired(campos.bairro, 'o bairro'),
      cidade: validateRequired(campos.cidade, 'a cidade'),
      uf: validateRequired(campos.uf, 'a UF'),
      ddd: validateDDD(campos.ddd),
      celular: validateCelular(campos.celular),
    }

    setErros(novos)
    return !Object.values(novos).some(Boolean)
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault()

    /*
     * Nao grava antes de ter carregado. O formulario comeca vazio, e um
     * `PUT` com ele em branco seria recusado campo a campo — mas se um dia o
     * contrato aceitar vazio, seria o cadastro apagado por um clique numa tela
     * que ainda estava chegando.
     */
    if (carregando) return

    if (!validarTudo()) {
      setToast({ msg: 'Confira os campos destacados antes de salvar.', tone: 'error' })
      return
    }

    setSalvando(true)

    const resultado = await salvarEmpresa({ ...campos, conexoesHabilitadas: conexoes })
    setSalvando(false)

    if (!resultado.ok) {
      setToast({ msg: resultado.erro, tone: 'error' })
      return
    }

    /* A tela passa a mostrar o que o SERVIDOR gravou. O contrato apara espacos
       e normaliza o telefone; manter o digitado deixaria a tela discordando do
       banco ate o proximo carregamento. */
    setCampos({ ...resultado.dados })
    setToast({ msg: 'Dados da empresa salvos.', tone: 'success' })
  }

  return (
    <>
      <PageHeader
        title="Empresa"
        subtitle="Dados cadastrais, endereço e certificado digital"
        actions={
          <Button onClick={salvar} disabled={salvando || carregando}>
            {salvando ? (
              <>
                <Spinner size={15} />
                Salvando...
              </>
            ) : (
              'Salvar alterações'
            )}
          </Button>
        }
      />

      <form onSubmit={salvar} noValidate className={styles.form}>
        {erroCarga !== null ? (
          <Card>
            <p className={styles.avisoCarga} role="alert">
              {erroCarga}{' '}
              <button
                type="button"
                onClick={() => {
                  setCarregando(true)
                  void carregar()
                }}
              >
                Tentar de novo
              </button>
            </p>
          </Card>
        ) : null}

        {/* ---------------- Identificacao ---------------- */}
        <Card title="Identificação">
          <FormGrid>
            {/*
              O CNPJ e SOMENTE LEITURA. `updateCompanyInputSchema` o omite de
              proposito — trocar CNPJ nao e corrigir um cadastro, e apontar
              para outra empresa, e as notas emitidas, os recebiveis e a trilha
              de auditoria continuariam apontando para a anterior. Um campo
              editavel que a api recusa seria pior que um campo travado.
            */}
            <Field label="CNPJ" span={5} hint={erros.cnpj ?? undefined}>
              <div className={styles.inline}>
                <Input
                  value={maskCNPJ(campos.cnpj)}
                  readOnly
                  aria-readonly="true"
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  aria-invalid={Boolean(erros.cnpj)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={preencherPorCnpj}
                  disabled={buscandoCnpj}
                >
                  {buscandoCnpj ? <Spinner size={14} /> : <IconSearch size={15} />}
                  Buscar dados
                </Button>
              </div>
              {erros.cnpj ? (
                <span className={styles.erro} role="alert">
                  {erros.cnpj}
                </span>
              ) : null}
              {avisoCnpj ? (
                <span className={styles.erro} role="alert">
                  {avisoCnpj}
                </span>
              ) : null}
            </Field>

            <Field label="Razão social" span={7}>
              <Input
                value={campos.razaoSocial}
                onChange={(e) => set('razaoSocial', e.target.value)}
                aria-invalid={Boolean(erros.razaoSocial)}
              />
              {erros.razaoSocial ? (
                <span className={styles.erro} role="alert">
                  {erros.razaoSocial}
                </span>
              ) : null}
            </Field>

            <Field label="Nome fantasia" span={6}>
              <Input
                value={campos.nomeFantasia}
                onChange={(e) => set('nomeFantasia', e.target.value)}
              />
            </Field>

            <Field label="Ramo de atividade" span={6}>
              <Select
                value={campos.ramoAtividade}
                onChange={(e) => set('ramoAtividade', e.target.value)}
                aria-invalid={Boolean(erros.ramoAtividade)}
              >
                <option value="">Selecione</option>
                {RAMOS_ATIVIDADE.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              {erros.ramoAtividade ? (
                <span className={styles.erro} role="alert">
                  {erros.ramoAtividade}
                </span>
              ) : null}
            </Field>

            <Field label="Inscrição estadual (IE)" span={6}>
              <Input
                value={campos.inscricaoEstadual}
                onChange={(e) => set('inscricaoEstadual', e.target.value)}
                placeholder="Isento, se não houver"
              />
            </Field>

            <Field label="Inscrição municipal (IM)" span={6}>
              <Input
                value={campos.inscricaoMunicipal}
                onChange={(e) => set('inscricaoMunicipal', e.target.value)}
              />
            </Field>
          </FormGrid>
        </Card>

        {/* ---------------- Endereco ---------------- */}
        <Card title="Endereço">
          <FormGrid>
            <Field label="CEP" span={4}>
              <div className={styles.inline}>
                <Input
                  value={campos.cep}
                  onChange={(e) => {
                    const mascarado = maskCEP(e.target.value)
                    set('cep', mascarado)
                    setAvisoCep(null)
                    void preencherPorCep(mascarado)
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
              {erros.cep ? (
                <span className={styles.erro} role="alert">
                  {erros.cep}
                </span>
              ) : null}
              {avisoCep ? (
                <span className={styles.erro} role="alert">
                  {avisoCep}
                </span>
              ) : null}
              {buscandoCep ? <span className={styles.dica}>Buscando endereço...</span> : null}
            </Field>

            <Field label="Logradouro" span={8}>
              <Input
                value={campos.logradouro}
                onChange={(e) => set('logradouro', e.target.value)}
                aria-invalid={Boolean(erros.logradouro)}
              />
              {erros.logradouro ? (
                <span className={styles.erro} role="alert">
                  {erros.logradouro}
                </span>
              ) : null}
            </Field>

            <Field label="Número" span={3}>
              <Input
                value={campos.numero}
                onChange={(e) => set('numero', e.target.value)}
                aria-invalid={Boolean(erros.numero)}
              />
              {erros.numero ? (
                <span className={styles.erro} role="alert">
                  {erros.numero}
                </span>
              ) : null}
            </Field>

            <Field label="Complemento" span={4}>
              <Input
                value={campos.complemento}
                onChange={(e) => set('complemento', e.target.value)}
                placeholder="Sala, loja, andar"
              />
            </Field>

            <Field label="Bairro" span={5}>
              <Input
                value={campos.bairro}
                onChange={(e) => set('bairro', e.target.value)}
                aria-invalid={Boolean(erros.bairro)}
              />
              {erros.bairro ? (
                <span className={styles.erro} role="alert">
                  {erros.bairro}
                </span>
              ) : null}
            </Field>

            <Field label="Cidade" span={8}>
              <Input
                value={campos.cidade}
                onChange={(e) => set('cidade', e.target.value)}
                aria-invalid={Boolean(erros.cidade)}
              />
              {erros.cidade ? (
                <span className={styles.erro} role="alert">
                  {erros.cidade}
                </span>
              ) : null}
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
              {erros.uf ? (
                <span className={styles.erro} role="alert">
                  {erros.uf}
                </span>
              ) : null}
            </Field>
          </FormGrid>
        </Card>

        {/* ---------------- Contato e conexoes ---------------- */}
        <Card title="Contato">
          <FormGrid>
            <Field label="DDD" span={2}>
              <Input
                value={campos.ddd}
                onChange={(e) => set('ddd', e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric"
                placeholder="41"
                aria-invalid={Boolean(erros.ddd)}
              />
              {erros.ddd ? (
                <span className={styles.erro} role="alert">
                  {erros.ddd}
                </span>
              ) : null}
            </Field>

            <Field label="Celular / WhatsApp" span={5}>
              <Input
                value={campos.celular}
                onChange={(e) => set('celular', maskCelular(e.target.value))}
                inputMode="tel"
                placeholder="99876-5432"
                aria-invalid={Boolean(erros.celular)}
              />
              {erros.celular ? (
                <span className={styles.erro} role="alert">
                  {erros.celular}
                </span>
              ) : null}
            </Field>
          </FormGrid>

          <div className={styles.conexoes}>
            <Checkbox
              label="Habilitar conexões com outros usuários"
              checked={conexoes}
              onChange={(e) => setConexoes(e.target.checked)}
            />
            <p className={styles.conexoesNota}>
              Permite convidar outras pessoas para acessar esta empresa, cada uma com o próprio
              login. Útil para quem tem sócio, gerente ou contador acompanhando o negócio.
            </p>
          </div>
        </Card>

        {/* ---------------- Certificado ---------------- */}
        <Card title="Certificado digital">
          <CertificadoDigital certificado={certificado} onChange={setCertificado} />
        </Card>

        <ComandosWhatsApp
          comandos={[
            'Qual foi o faturamento mês a mês dos últimos meses',
            'Ranking dos clientes',
            'Ranking dos produtos',
            'Gerar DRE do mes',
          ]}
        />

        <div className={styles.rodape}>
          <Button type="submit" disabled={salvando}>
            {salvando ? (
              <>
                <Spinner size={15} />
                Salvando...
              </>
            ) : (
              'Salvar alterações'
            )}
          </Button>
        </div>
      </form>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
