'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  cadastrarFornecedor,
  type DadosDoFornecedor,
  documentoFormatado,
  editarFornecedor,
  excluirFornecedor,
  type FornecedorCadastrado,
  listarFornecedores,
  telefoneFormatado,
} from '@/lib/fornecedores-cadastro-api'
import { buscarCep, buscarCnpj, UFS } from '@/lib/empresa-api'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  FormGrid,
  Input,
  LegendaObrigatorio,
  PageHeader,
  Select,
} from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import ConfirmarDialog from '@/components/app/ConfirmarDialog'
import { IconPlus, IconSearch } from '@/components/Icons'
import styles from './fornecedores-cadastro.module.css'

type Campos = {
  nome: string
  fantasia: string
  documento: string
  ie: string
  contato: string
  telefone: string
  email: string
  cep: string
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  observacao: string
  ativo: boolean
}

const VAZIO: Campos = {
  nome: '',
  fantasia: '',
  documento: '',
  ie: '',
  contato: '',
  telefone: '',
  email: '',
  cep: '',
  rua: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  observacao: '',
  ativo: true,
}

const doFornecedor = (f: FornecedorCadastrado): Campos => ({
  nome: f.name,
  fantasia: f.tradeName ?? '',
  documento: documentoFormatado(f.document),
  ie: f.stateRegistration ?? '',
  contato: f.contactName ?? '',
  telefone: telefoneFormatado(f.phone),
  email: f.email ?? '',
  cep: f.address.zipCode ?? '',
  rua: f.address.street ?? '',
  numero: f.address.number ?? '',
  complemento: f.address.complement ?? '',
  bairro: f.address.district ?? '',
  cidade: f.address.city ?? '',
  uf: f.address.state ?? '',
  observacao: f.notes ?? '',
  ativo: f.isActive,
})

const digitos = (t: string) => t.replace(/\D/g, '')

/**
 * Os dados para a api. No cadastro, campo vazio nem vai; na edicao, vazio
 * vira `null` — e assim que se apaga um telefone errado.
 */
function paraApi(c: Campos, editando: boolean): DadosDoFornecedor {
  const opcional = (v: string) => {
    const t = v.trim()
    return t === '' ? (editando ? null : undefined) : t
  }
  const endereco = Object.fromEntries(
    Object.entries({
      zipCode: digitos(c.cep),
      street: c.rua.trim(),
      number: c.numero.trim(),
      complement: c.complemento.trim(),
      district: c.bairro.trim(),
      city: c.cidade.trim(),
      state: c.uf.trim(),
    }).filter(([, v]) => v !== ''),
  )
  const dados: DadosDoFornecedor = {
    name: c.nome.trim(),
    tradeName: opcional(c.fantasia),
    document: digitos(c.documento) === '' ? (editando ? null : undefined) : digitos(c.documento),
    stateRegistration: opcional(c.ie),
    contactName: opcional(c.contato),
    phone: digitos(c.telefone) === '' ? (editando ? null : undefined) : digitos(c.telefone),
    email: opcional(c.email),
    notes: opcional(c.observacao),
    ...(Object.keys(endereco).length > 0 || editando ? { address: endereco } : {}),
    ...(editando ? { isActive: c.ativo } : {}),
  }
  return Object.fromEntries(
    Object.entries(dados).filter(([, v]) => v !== undefined),
  ) as DadosDoFornecedor
}

/**
 * Cadastro de fornecedor — NR-191, achado do QA ("cadastro de fornecedor,
 * poder cadastrar por completo").
 *
 * So o nome e obrigatorio. O CNPJ busca razao social, fantasia e endereco na
 * Receita; o CEP completa a rua. A entrada de mercadoria escolhe daqui.
 */
export default function FornecedoresCadastroView() {
  const [lista, setLista] = useState<FornecedorCadastrado[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [campos, setCampos] = useState<Campos>(VAZIO)
  const [editando, setEditando] = useState<FornecedorCadastrado | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [buscandoDoc, setBuscandoDoc] = useState(false)
  const [excluindo, setExcluindo] = useState<FornecedorCadastrado | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async (termo: string, inativos: boolean) => {
    const r = await listarFornecedores({ termo, incluirInativos: inativos })
    if (r.ok) {
      setLista(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        await carregar(busca, incluirInativos)
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [busca, incluirInativos, carregar])

  const set = <K extends keyof Campos>(k: K, v: Campos[K]) => setCampos((c) => ({ ...c, [k]: v }))

  async function preencherPeloCnpj(silencioso: boolean) {
    if (digitos(campos.documento).length !== 14) {
      if (!silencioso) setToast({ msg: 'Informe o CNPJ completo para buscar.', tone: 'error' })
      return
    }
    setBuscandoDoc(true)
    const r = await buscarCnpj(campos.documento)
    setBuscandoDoc(false)
    if (!r.ok) {
      if (!silencioso) setToast({ msg: r.error, tone: 'error' })
      return
    }
    setCampos((c) => ({
      ...c,
      nome: r.dados.razaoSocial,
      fantasia: r.dados.nomeFantasia,
      cep: r.dados.cep,
      rua: r.dados.logradouro,
      numero: r.dados.numero,
      bairro: r.dados.bairro,
      cidade: r.dados.cidade,
      uf: r.dados.uf,
    }))
    setToast({ msg: 'Dados preenchidos a partir do CNPJ.', tone: 'success' })
  }

  async function preencherPeloCep() {
    if (digitos(campos.cep).length !== 8) return
    const r = await buscarCep(campos.cep)
    if (!r.ok) return
    setCampos((c) => ({
      ...c,
      rua: r.endereco.logradouro || c.rua,
      bairro: r.endereco.bairro || c.bairro,
      cidade: r.endereco.cidade || c.cidade,
      uf: r.endereco.uf || c.uf,
    }))
  }

  function limpar() {
    setEditando(null)
    setCampos(VAZIO)
  }

  function editar(f: FornecedorCadastrado) {
    setEditando(f)
    setCampos(doFornecedor(f))
    document.getElementById('fornecedor-documento')?.focus()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (campos.nome.trim().length < 2) {
      setToast({ msg: 'Informe o nome do fornecedor.', tone: 'error' })
      return
    }
    setSalvando(true)
    const dados = paraApi(campos, editando !== null)
    const r =
      editando === null
        ? await cadastrarFornecedor(dados)
        : await editarFornecedor(editando.id, dados)
    setSalvando(false)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    setToast({
      msg: editando === null ? `${r.dados.name} cadastrado.` : `${r.dados.name} salvo.`,
      tone: 'success',
    })
    limpar()
    void carregar(busca, incluirInativos)
  }

  async function confirmarExclusao() {
    if (excluindo === null) return
    const r = await excluirFornecedor(excluindo.id)
    setExcluindo(null)
    if (!r.ok) {
      setToast({ msg: r.erro, tone: 'error' })
      return
    }
    if (editando?.id === excluindo.id) limpar()
    setToast({ msg: 'Fornecedor excluído.', tone: 'success' })
    void carregar(busca, incluirInativos)
  }

  return (
    <>
      <PageHeader
        title="Fornecedores"
        subtitle="O cadastro de quem vende para a loja: CNPJ, contato e endereço"
      />

      <Card title="Seus fornecedores">
        <div className={styles.barra}>
          <label className={styles.busca}>
            <IconSearch size={16} />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, CNPJ ou telefone"
              aria-label="Buscar fornecedor"
            />
          </label>
          <label className={styles.inativos}>
            <input
              type="checkbox"
              checked={incluirInativos}
              onChange={(e) => setIncluirInativos(e.target.checked)}
            />
            Mostrar inativos
          </label>
        </div>

        {erro !== null ? (
          <EmptyState title="Não deu para carregar" description={erro} />
        ) : lista === null ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : lista.length === 0 ? (
          <EmptyState
            title={busca ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
            description="Cadastre abaixo. Só o nome é obrigatório; o CNPJ preenche o resto."
          />
        ) : (
          <ul className={styles.lista} aria-label="Fornecedores">
            {lista.map((f) => (
              <li key={f.id} className={styles.linha}>
                <span className={styles.principal}>
                  <strong>
                    {f.tradeName ?? f.name}
                    {!f.isActive ? <Badge tone="neutral">inativo</Badge> : null}
                  </strong>
                  <small>
                    {[
                      f.tradeName ? f.name : null,
                      documentoFormatado(f.document) || null,
                      telefoneFormatado(f.phone) || null,
                      f.contactName ? `contato: ${f.contactName}` : null,
                      f.address.city ? `${f.address.city}/${f.address.state ?? ''}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Só o nome cadastrado'}
                  </small>
                </span>
                <span className={styles.acoes}>
                  <Button variant="ghost" size="sm" onClick={() => editar(f)}>
                    Editar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setExcluindo(f)}>
                    Excluir
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={editando === null ? 'Cadastrar fornecedor' : `Editar ${editando.name}`}>
        <form onSubmit={salvar} noValidate>
          <LegendaObrigatorio />
          <FormGrid>
            <Field label="CNPJ ou CPF" span={5} hint="o CNPJ busca os dados na Receita">
              <div className={styles.inline}>
                <Input
                  id="fornecedor-documento"
                  value={campos.documento}
                  onChange={(e) => set('documento', e.target.value)}
                  onBlur={() => {
                    if (!editando && campos.nome.trim() === '') void preencherPeloCnpj(true)
                  }}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void preencherPeloCnpj(false)}
                  disabled={buscandoDoc}
                >
                  Buscar
                </Button>
              </div>
            </Field>
            <Field label="Razão social ou nome" span={7} obrigatorio htmlFor="fornecedor-nome">
              <Input
                id="fornecedor-nome"
                value={campos.nome}
                onChange={(e) => set('nome', e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="Nome fantasia" span={6}>
              <Input
                value={campos.fantasia}
                onChange={(e) => set('fantasia', e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="Inscrição estadual" span={6}>
              <Input value={campos.ie} onChange={(e) => set('ie', e.target.value)} maxLength={30} />
            </Field>
            <Field label="Contato" span={4} hint="quem atende na empresa">
              <Input
                value={campos.contato}
                onChange={(e) => set('contato', e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Telefone" span={4}>
              <Input
                value={campos.telefone}
                onChange={(e) => set('telefone', e.target.value)}
                inputMode="tel"
                placeholder="(41) 3333-4444"
              />
            </Field>
            <Field label="E-mail" span={4}>
              <Input
                type="email"
                value={campos.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
            <Field label="CEP" span={3}>
              <Input
                value={campos.cep}
                onChange={(e) => set('cep', e.target.value)}
                onBlur={() => void preencherPeloCep()}
                inputMode="numeric"
                placeholder="00000-000"
              />
            </Field>
            <Field label="Rua" span={6}>
              <Input value={campos.rua} onChange={(e) => set('rua', e.target.value)} />
            </Field>
            <Field label="Número" span={3}>
              <Input value={campos.numero} onChange={(e) => set('numero', e.target.value)} />
            </Field>
            <Field label="Complemento" span={4}>
              <Input
                value={campos.complemento}
                onChange={(e) => set('complemento', e.target.value)}
              />
            </Field>
            <Field label="Bairro" span={4}>
              <Input value={campos.bairro} onChange={(e) => set('bairro', e.target.value)} />
            </Field>
            <Field label="Cidade" span={3}>
              <Input value={campos.cidade} onChange={(e) => set('cidade', e.target.value)} />
            </Field>
            <Field label="UF" span={1}>
              <Select value={campos.uf} onChange={(e) => set('uf', e.target.value)} aria-label="UF">
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observação" span={12}>
              <Input
                value={campos.observacao}
                onChange={(e) => set('observacao', e.target.value)}
                maxLength={500}
                placeholder="Ex.: entrega às terças; pedido mínimo R$ 300"
              />
            </Field>
          </FormGrid>

          {editando !== null ? (
            <label className={styles.inativos}>
              <input
                type="checkbox"
                checked={campos.ativo}
                onChange={(e) => set('ativo', e.target.checked)}
              />
              Ativo (inativo some da escolha na entrada de mercadoria)
            </label>
          ) : null}

          <div className={styles.rodape}>
            {editando !== null ? (
              <Button type="button" variant="ghost" onClick={limpar}>
                Cancelar edição
              </Button>
            ) : null}
            <Button type="submit" disabled={salvando}>
              <IconPlus size={16} />
              {salvando
                ? 'Salvando...'
                : editando === null
                  ? 'Cadastrar fornecedor'
                  : 'Salvar fornecedor'}
            </Button>
          </div>
        </form>
      </Card>

      {excluindo !== null ? (
        <ConfirmarDialog
          titulo="Excluir fornecedor"
          descricao="Ele sai do cadastro e da escolha na entrada de mercadoria. As compras já lançadas continuam mostrando de quem foram."
          tom="perigo"
          rotuloConfirmar="Excluir"
          detalhe={<strong>{excluindo.name}</strong>}
          onConfirmar={() => void confirmarExclusao()}
          onCancelar={() => setExcluindo(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
