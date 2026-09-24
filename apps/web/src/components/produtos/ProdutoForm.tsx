'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { calcularMargem, carregarSugestoes, salvarProduto } from '@/lib/produtos-api'
import { carregarCustosVariaveis } from '@/lib/financeiro-api'
import { formatMoney, formatPercent } from '@/lib/format'
import { validateRequired, type FieldError } from '@/lib/validation'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, Field, FormGrid, Input, PageHeader } from '@/components/ui/UI'
import Toast from '@/components/ui/Toast'
import { Spinner } from '@/components/auth/Fields'
import { IconBarcode, IconTrash } from '@/components/Icons'
import LeitorCodigoBarras from '@/components/app/LeitorCodigoBarras'
import CampoTag from '@/components/app/CampoTag'
import styles from './produtoForm.module.css'
import { reaisDoTexto } from '@/lib/valor'

export default function ProdutoForm() {
  const router = useRouter()

  const [descricao, setDescricao] = useState('')
  const [ean, setEan] = useState('')
  const [ncm, setNcm] = useState('')
  /*
   * CFOP e situacao tributaria — RF-046, entram com a NR-042.
   *
   * Os tres campos fiscais sao OPCIONAIS aqui: exigi-los travaria o cadastro no
   * dia da instalacao, e a RF-017 pede que ele seja rapido. Quem cobra a falta
   * e a emissao da nota, que recusa antes de transmitir e diz qual produto
   * precisa ser classificado — o momento em que a informacao faz falta de
   * verdade.
   */
  const [cfop, setCfop] = useState('')
  const [situacaoTributaria, setSituacaoTributaria] = useState('')
  const [categoria, setCategoria] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [precoCusto, setPrecoCusto] = useState('')
  const [precoVenda, setPrecoVenda] = useState('')
  const [estoque, setEstoque] = useState('0')
  const [estoqueMinimo, setEstoqueMinimo] = useState('0')
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [imagem, setImagem] = useState<string | null>(null)

  const [categorias, setCategorias] = useState<string[]>([])
  const [fornecedores, setFornecedores] = useState<string[]>([])
  /* Soma dos custos variaveis da empresa, em pontos percentuais. Falha ao
     carregar vira zero: a tela so deixa de mostrar a linha, e o cadastro
     segue. */
  const [percentualVariavel, setPercentualVariavel] = useState(0)

  /* Categoria/fornecedor ja usados pela propria loja — nao mais uma lista de
     exemplo igual para toda empresa. */
  useEffect(() => {
    void (async () => {
      const r = await carregarSugestoes()
      if (r.ok) {
        setCategorias(r.dados.categorias)
        setFornecedores(r.dados.fornecedores)
      }
    })()
    void (async () => {
      const r = await carregarCustosVariaveis()
      if (r.ok) setPercentualVariavel(r.dados.reduce((acc, c) => acc + c.percentual, 0))
    })()
  }, [])

  const [erros, setErros] = useState<Record<string, FieldError>>({})
  const [lendoCodigo, setLendoCodigo] = useState(false)

  const [salvando, setSalvando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const custo = reaisDoTexto(precoCusto)
  const venda = reaisDoTexto(precoVenda)
  const margem = calcularMargem(custo, venda)
  const lucro = venda - custo
  /* O que sobra depois de tarifa, imposto, comissao — os custos que crescem
     com a venda. E a margem que o lojista de fato leva para casa. */
  const variavel = (venda * percentualVariavel) / 100
  const sobra = lucro - variavel

  /* ---------------------------------------------------------------- *
   * Imagem
   * ---------------------------------------------------------------- */

  function receberImagem(arquivo: File) {
    if (!arquivo.type.startsWith('image/')) {
      setToast({ msg: 'Envie um arquivo de imagem.', tone: 'error' })
      return
    }

    /* Previa local via data URL. No envio real o arquivo vai para o
       storage e o cadastro guarda so a URL. */
    const reader = new FileReader()
    reader.onload = () => setImagem(String(reader.result))
    reader.readAsDataURL(arquivo)
  }

  /* ---------------------------------------------------------------- *
   * Gravacao
   * ---------------------------------------------------------------- */

  async function salvar(event: React.FormEvent) {
    event.preventDefault()

    const novos: Record<string, FieldError> = {
      descricao: validateRequired(descricao, 'a descrição'),
      categoria: validateRequired(categoria, 'a categoria'),
      precoVenda: venda > 0 ? null : 'Informe um preço de venda maior que zero.',
    }

    setErros(novos)
    if (Object.values(novos).some(Boolean)) {
      setToast({ msg: 'Confira os campos destacados antes de salvar.', tone: 'error' })
      return
    }

    setSalvando(true)

    const r = await salvarProduto({
      descricao,
      ean,
      ncm,
      cfop,
      situacaoTributaria,
      categoria,
      fornecedor,
      precoCusto: custo,
      precoVenda: venda,
      estoque: Number(estoque) || 0,
      estoqueMinimo: Number(estoqueMinimo) || 0,
      imagem,
    })
    setSalvando(false)

    if (!r.ok) {
      setErros(r.campos)
      setToast({ msg: r.error, tone: 'error' })
      return
    }

    setToast({ msg: 'Produto cadastrado.', tone: 'success' })
    router.push('/app/produtos')
  }

  const erroDe = (campo: string) =>
    erros[campo] ? (
      <span className={styles.erro} role="alert">
        {erros[campo]}
      </span>
    ) : null

  return (
    <>
      <PageHeader
        title="Novo produto"
        subtitle="Cadastro, preço e estoque"
        actions={
          <ButtonLink href="/app/produtos" variant="secondary">
            Cancelar
          </ButtonLink>
        }
      />

      <form onSubmit={salvar} noValidate className={styles.form}>
        {/* ---------------- Identificacao ---------------- */}
        <Card title="Identificacao">
          <FormGrid>
            <Field label="Código de barras (EAN)" span={12}>
              <div className={styles.inline}>
                <Input
                  value={ean}
                  onChange={(e) => setEan(e.target.value.replace(/\D/g, ''))}
                  placeholder="7891000000000"
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setLendoCodigo(true)}
                  aria-label="Ler com a camera"
                >
                  <IconBarcode size={16} />
                </Button>
              </div>
            </Field>

            {/* Sem campo de codigo interno: o servidor gera PROD-0001,
                PROD-0002... para todo produto (RF-019). O campo que havia aqui
                era obrigatorio e nunca enviado — quem digitava "CAF500"
                recebia PROD-0001. O codigo gerado aparece na lista e na ficha. */}

            <Field label="Descrição" span={12}>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Café torrado e moído 500g"
                aria-invalid={Boolean(erros.descricao)}
              />
              {erroDe('descricao')}
            </Field>

            <Field label="Categoria" span={6}>
              <CampoTag
                valor={categoria}
                opcoes={categorias}
                onChange={setCategoria}
                onCriar={(nova) => setCategorias((c) => [...c, nova])}
                placeholder="Buscar ou criar categoria"
                ariaLabel="Categoria"
                invalido={Boolean(erros.categoria)}
              />
              {erroDe('categoria')}
            </Field>

            <Field label="Fornecedor" span={6}>
              <CampoTag
                valor={fornecedor}
                opcoes={fornecedores}
                onChange={setFornecedor}
                onCriar={(novo) => setFornecedores((f) => [...f, novo])}
                placeholder="Buscar ou criar fornecedor"
                ariaLabel="Fornecedor"
              />
            </Field>
          </FormGrid>
        </Card>

        {/* ---------------- NCM ---------------- */}
        <Card title="Classificação fiscal">
          <FormGrid>
            {/*
              Os tres textos de ajuda sao CURTOS de proposito: numa coluna de
              4/12 um texto longo quebra de linha ao lado do rotulo, a linha do
              rotulo cresce e a caixa daquele campo desce — era o "campo NCM
              mais alto que os outros" do TXT. O NCM, sem ajuda, ficava em cima.
            */}
            <Field label="NCM" span={4} hint="8 dígitos, na nota de compra">
              <Input
                value={ncm}
                onChange={(e) => setNcm(e.target.value)}
                placeholder="0000.00.00"
              />
              {erroDe('ncm')}
            </Field>

            <Field label="CFOP" span={4} hint="5102 revenda; 5405 com ST">
              <Input
                value={cfop}
                onChange={(e) => setCfop(e.target.value)}
                placeholder="5102"
                inputMode="numeric"
              />
              {erroDe('cfop')}
            </Field>

            <Field
              label="CSOSN"
              span={4}
              /* So CSOSN: o produto atende Simples Nacional e MEI, e nao o
                 regime normal (CST). A dica NAO deduz o codigo: substituicao
                 tributaria depende do produto E do estado, e errar para menos
                 e sonegacao. Dizer como o codigo se parece e ajudar; escolher
                 por ele seria dar conselho fiscal. */
              hint="3 dígitos, ex. 102"
            >
              <Input
                value={situacaoTributaria}
                onChange={(e) => setSituacaoTributaria(e.target.value)}
                placeholder="102"
                inputMode="numeric"
              />
              {erroDe('situacaoTributaria')}
            </Field>
          </FormGrid>
        </Card>

        {/* ---------------- Precos ---------------- */}
        <Card title="Preços">
          <FormGrid>
            <Field label="Preço de custo" span={4}>
              <Input
                value={precoCusto}
                onChange={(e) => setPrecoCusto(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
              {erroDe('precoCusto')}
            </Field>

            <Field label="Preço de venda" span={4}>
              <Input
                value={precoVenda}
                onChange={(e) => setPrecoVenda(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                aria-invalid={Boolean(erros.precoVenda)}
              />
              {erroDe('precoVenda')}
            </Field>

            <Field label="Margem" span={4}>
              {/* Calculada, nao editavel: e resultado dos dois campos acima */}
              <div
                className={`${styles.margemBox} ${
                  margem !== null && margem < 0 ? styles.margemNegativa : ''
                }`}
                aria-live="polite"
              >
                {margem === null ? (
                  <span className={styles.margemVazia}>informe o preço de venda</span>
                ) : (
                  <>
                    <strong>{formatPercent(margem)}</strong>
                    <span>
                      {lucro >= 0 ? 'lucro de ' : 'prejuízo de '}
                      {formatMoney(Math.abs(lucro))} por unidade
                    </span>
                  </>
                )}
              </div>
            </Field>

            {percentualVariavel > 0 && venda > 0 ? (
              <Field label="Depois dos custos variáveis" span={12}>
                <div
                  className={`${styles.margemBox} ${sobra < 0 ? styles.margemNegativa : ''}`}
                  aria-live="polite"
                >
                  <strong>{formatMoney(sobra)} por unidade</strong>
                  <span>
                    custos variáveis de {formatPercent(percentualVariavel)} levam{' '}
                    {formatMoney(variavel)} de cada venda
                  </span>
                </div>
              </Field>
            ) : null}
          </FormGrid>
        </Card>

        {/* ---------------- Estoque ---------------- */}
        <Card title="Estoque">
          <FormGrid>
            <Field label="Quantidade atual" span={4}>
              <Input
                value={estoque}
                onChange={(e) => setEstoque(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </Field>

            <Field
              label="Estoque mínimo"
              span={4}
              hint="Abaixo disso, entra no alerta de reposição."
            >
              <Input
                value={estoqueMinimo}
                onChange={(e) => setEstoqueMinimo(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </Field>

            <Field
              label="Motivo do ajuste"
              span={4}
              hint="Obrigatório ao corrigir a quantidade de um produto já cadastrado."
            >
              <Input
                value={motivoAjuste}
                onChange={(e) => setMotivoAjuste(e.target.value)}
                placeholder="Contagem, avaria, perda..."
              />
            </Field>
          </FormGrid>
        </Card>

        {/* ---------------- Imagem ---------------- */}
        <Card title="Imagem do produto">
          <div className={styles.imagemBloco}>
            {imagem ? (
              <div className={styles.previaWrap}>
                {/* unoptimized: e um data URL local, nao passa pelo otimizador */}
                <Image
                  src={imagem}
                  alt="Prévia da imagem do produto"
                  className={styles.previa}
                  width={160}
                  height={160}
                  unoptimized
                />
                <Button variant="secondary" size="sm" onClick={() => setImagem(null)}>
                  <IconTrash size={15} />
                  Remover
                </Button>
              </div>
            ) : (
              <label className={styles.imagemUpload}>
                <strong>Escolher imagem</strong>
                <span>JPG ou PNG</span>
                <input
                  type="file"
                  accept="image/*"
                  className={styles.imagemInput}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) receberImagem(f)
                  }}
                />
              </label>
            )}
          </div>
        </Card>

        <div className={styles.rodape}>
          <ButtonLink href="/app/produtos" variant="secondary">
            Cancelar
          </ButtonLink>
          <Button type="submit" disabled={salvando}>
            {salvando ? (
              <>
                <Spinner size={15} />
                Salvando...
              </>
            ) : (
              'Cadastrar produto'
            )}
          </Button>
        </div>
      </form>

      {lendoCodigo ? (
        <LeitorCodigoBarras
          onDetectar={(codigoLido) => setEan(codigoLido.replace(/\D/g, ''))}
          onClose={() => setLendoCodigo(false)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
