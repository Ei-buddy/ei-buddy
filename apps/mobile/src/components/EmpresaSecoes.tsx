import { getDocumentAsync } from 'expo-document-picker'
import { File } from 'expo-file-system'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import {
  carregarSituacaoFiscal,
  celularDoCanal,
  enviarCertificado,
  exportarDados,
  salvarCsc,
  trocarCelularDoCanal,
  type ResultadoDaExportacao,
  type SituacaoFiscal,
} from '@/lib/empresa-api'
import { dataDoTexto, formatDate, formatDateTime, hoje, mascaraData } from '@/lib/format'
import { maskPhone } from '@/lib/validation'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import Sanfona from '@/components/ui/Sanfona'
import { Etiqueta } from '@/components/ui/Cartao'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Certificado digital A1 — RF-004.
 *
 * O arquivo sai do celular (Arquivos, Drive, e-mail baixado) em base64, junto
 * com a senha e a validade, e o servidor guarda cifrado. Nem o arquivo nem a
 * senha voltam do servidor depois.
 */
export function CertificadoDigital() {
  const [situacao, setSituacao] = useState<SituacaoFiscal | null>(null)
  const [arquivo, setArquivo] = useState<{ nome: string; uri: string } | null>(null)
  const [senha, setSenha] = useState('')
  const [validade, setValidade] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await carregarSituacaoFiscal()
      if (!cancelado && r.ok) setSituacao(r.dados)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function escolher() {
    const r = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
    if (r.canceled) return
    const a = r.assets[0]
    if (!a) return
    const nome = a.name.toLowerCase()
    if (!nome.endsWith('.pfx') && !nome.endsWith('.p12')) {
      setMensagem({ tom: 'erro', texto: 'O certificado precisa ser um arquivo .pfx ou .p12.' })
      return
    }
    setMensagem(null)
    setArquivo({ nome: a.name, uri: a.uri })
  }

  async function enviar() {
    const ate = dataDoTexto(validade)
    if (arquivo === null) return
    if (senha === '') {
      setMensagem({ tom: 'erro', texto: 'Informe a senha do certificado.' })
      return
    }
    if (ate === null) {
      setMensagem({ tom: 'erro', texto: 'Informe até quando o certificado vale.' })
      return
    }
    setEnviando(true)
    setMensagem(null)
    let base64: string
    try {
      base64 = await new File(arquivo.uri).base64()
    } catch {
      setEnviando(false)
      setMensagem({ tom: 'erro', texto: 'Não deu para ler o arquivo. Escolha de novo.' })
      return
    }
    const r = await enviarCertificado(base64, senha, ate)
    setEnviando(false)
    if (!r.ok) {
      setMensagem({ tom: 'erro', texto: r.erro })
      return
    }
    setSituacao(r.dados)
    setArquivo(null)
    setSenha('')
    setValidade('')
    setMensagem({ tom: 'ok', texto: 'Certificado enviado. A loja já pode emitir NFC-e.' })
  }

  const vencido = situacao?.validoAte != null && situacao.validoAte < hoje()

  return (
    <Sanfona
      titulo="Certificado digital"
      resumo={
        situacao === null
          ? 'carregando'
          : situacao.temCertificado
            ? `vale até ${formatDate(situacao.validoAte)}`
            : 'não enviado'
      }
      etiqueta={
        situacao?.temCertificado ? (
          vencido ? (
            <Etiqueta tom="erro">Vencido</Etiqueta>
          ) : (
            <Etiqueta tom="sucesso">Válido</Etiqueta>
          )
        ) : (
          <Etiqueta tom="atencao">Falta</Etiqueta>
        )
      }
    >
      <View style={estilos.bloco}>
        <Text style={estilos.texto}>
          {situacao?.temCertificado
            ? 'Para trocar (renovação, por exemplo), envie o novo arquivo.'
            : 'Sem o certificado A1, a venda é registrada mas a NFC-e não sai.'}
        </Text>
        <Botao variante="secundario" onPress={() => void escolher()} largura>
          {arquivo === null ? 'Escolher arquivo .pfx' : arquivo.nome}
        </Botao>
        {arquivo !== null ? (
          <>
            <Campo rotulo="Senha do certificado" valor={senha} onChange={setSenha} senha />
            <Campo
              rotulo="Válido até"
              valor={validade}
              onChange={(v) => setValidade(mascaraData(v))}
              tipoTeclado="numeric"
              placeholder="DD/MM/AAAA"
            />
            <Botao onPress={() => void enviar()} carregando={enviando} largura>
              Enviar certificado
            </Botao>
          </>
        ) : null}
        {mensagem !== null ? (
          <Text style={mensagem.tom === 'erro' ? estilos.erro : estilos.ok}>{mensagem.texto}</Text>
        ) : null}
      </View>
    </Sanfona>
  )
}

/**
 * Emissao de NFC-e — NR-183, a mesma secao do web.
 *
 * A EiBuddy cadastra a empresa na Focus NFe (como revenda) com o certificado,
 * o CSC e o endereco. Aqui o lojista informa o CSC que gerou no site da SEFAZ e
 * ve se o cadastro foi aceito — ou o que a Focus disse.
 */
export function EmissaoNfce() {
  const [situacao, setSituacao] = useState<SituacaoFiscal | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const r = await carregarSituacaoFiscal()
      if (!cancelado && r.ok) setSituacao(r.dados)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const focus = situacao?.focus
  const etiqueta =
    situacao === null ? null : !focus?.disponivel ? (
      <Etiqueta tom="neutro">Em breve</Etiqueta>
    ) : focus.erro !== null ? (
      <Etiqueta tom="atencao">Pendente</Etiqueta>
    ) : focus.cadastradaEm !== null ? (
      <Etiqueta tom="sucesso">Cadastrada</Etiqueta>
    ) : (
      <Etiqueta tom="atencao">Falta</Etiqueta>
    )

  return (
    <Sanfona
      titulo="Emissão de NFC-e"
      resumo={
        situacao === null
          ? 'carregando'
          : focus?.cadastradaEm != null && focus.erro === null
            ? 'cadastrada na Focus NFe'
            : 'cadastro na Focus NFe'
      }
      etiqueta={etiqueta}
    >
      <View style={estilos.bloco}>
        {situacao === null ? null : !situacao.focus.disponivel ? (
          <Text style={estilos.texto}>
            O cadastro na Focus ainda não está ligado neste servidor. Você já pode enviar o
            certificado e o CSC: eles ficam guardados e vão para a Focus assim que for ativado.
          </Text>
        ) : situacao.focus.erro !== null ? (
          <Text style={estilos.erro}>{situacao.focus.erro}</Text>
        ) : situacao.focus.cadastradaEm !== null ? (
          <Text style={estilos.ok}>
            Cadastrada na Focus NFe em {formatDateTime(situacao.focus.cadastradaEm)}.
          </Text>
        ) : (
          <Text style={estilos.texto}>
            Para cadastrar, envie o certificado digital e o CSC. O endereço completo da empresa
            também é necessário.
          </Text>
        )}
        <FormularioCsc
          titulo="CSC de produção"
          configurado={situacao?.temCscProducao ?? false}
          salvar={(csc) => salvarCsc({ producao: csc })}
          onSalvo={setSituacao}
        />
        <FormularioCsc
          titulo="CSC de homologação (testes)"
          configurado={situacao?.temCscHomologacao ?? false}
          salvar={(csc) => salvarCsc({ homologacao: csc })}
          onSalvo={setSituacao}
        />
        <Text style={estilos.texto}>
          O CSC (Código de Segurança do Contribuinte) é gerado no site da SEFAZ do seu estado, junto
          com o ID dele. Ele assina o QR Code da NFC-e e fica guardado cifrado.
        </Text>
      </View>
    </Sanfona>
  )
}

function FormularioCsc({
  titulo,
  configurado,
  salvar,
  onSalvo,
}: {
  titulo: string
  configurado: boolean
  salvar: (csc: { id: string; code: string }) => ReturnType<typeof salvarCsc>
  onSalvo: (s: SituacaoFiscal) => void
}) {
  const [id, setId] = useState('')
  const [codigo, setCodigo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    if (!/^[0-9]{1,6}$/.test(id.trim())) {
      setErro('O ID do CSC tem só números (até 6).')
      return
    }
    if (codigo.trim().length < 8) {
      setErro('Confira o CSC: ele tem pelo menos 8 caracteres.')
      return
    }
    setErro(null)
    setSalvando(true)
    const r = await salvar({ id: id.trim(), code: codigo.trim() })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setId('')
    setCodigo('')
    onSalvo(r.dados)
  }

  return (
    <View style={estilos.bloco}>
      <Text style={estilos.rotuloCsc}>
        {titulo}
        {configurado ? ' · configurado' : ''}
      </Text>
      <Campo
        rotulo="ID do CSC"
        valor={id}
        onChange={setId}
        tipoTeclado="numeric"
        placeholder={configurado ? 'Preencha só para trocar' : 'Ex.: 1'}
      />
      <Campo
        rotulo="CSC"
        valor={codigo}
        onChange={setCodigo}
        senha
        placeholder={configurado ? 'Preencha só para trocar' : 'Código gerado na SEFAZ'}
      />
      {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
      <Botao
        variante="secundario"
        onPress={() => void enviar()}
        carregando={salvando}
        desabilitado={id === '' || codigo === ''}
        largura
      >
        {configurado ? 'Trocar CSC' : 'Salvar CSC'}
      </Botao>
    </View>
  )
}

/**
 * O celular que opera a loja pelo WhatsApp — RF-132.
 *
 * E o celular da PESSOA, com gravacao propria e senha: quem pega o aparelho
 * destravado de alguem nao deve conseguir sequestrar o canal.
 */
export function CelularDoCanal() {
  const [atual, setAtual] = useState<string | null | undefined>(undefined)
  const [novo, setNovo] = useState('')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const c = await celularDoCanal()
      if (!cancelado) setAtual(c)
    })()
    return () => {
      cancelado = true
    }
  }, [])

  async function salvar() {
    if (novo.replace(/\D/g, '').length < 10) {
      setMensagem({ tom: 'erro', texto: 'Informe o celular com DDD.' })
      return
    }
    if (senha === '') {
      setMensagem({ tom: 'erro', texto: 'Informe a sua senha atual.' })
      return
    }
    setSalvando(true)
    const r = await trocarCelularDoCanal(novo, senha)
    setSalvando(false)
    if (!r.ok) {
      setMensagem({ tom: 'erro', texto: r.erro })
      return
    }
    setAtual(r.dados)
    setNovo('')
    setSenha('')
    setMensagem({
      tom: 'ok',
      texto: 'Celular trocado. O número antigo não opera mais a loja pelo WhatsApp.',
    })
  }

  return (
    <Sanfona
      titulo="Seu celular no WhatsApp"
      resumo={atual === undefined ? 'carregando' : atual === null ? 'nenhum' : maskPhone(atual)}
    >
      <View style={estilos.bloco}>
        <Text style={estilos.texto}>
          É o número que opera a loja pelo WhatsApp e com que você entra por telefone.
        </Text>
        <Campo
          rotulo="Novo celular com DDD"
          valor={novo}
          onChange={(v) => setNovo(maskPhone(v))}
          tipoTeclado="phone-pad"
        />
        <Campo rotulo="Sua senha atual" valor={senha} onChange={setSenha} senha />
        <Botao onPress={() => void salvar()} carregando={salvando} largura>
          Trocar celular
        </Botao>
        {mensagem !== null ? (
          <Text style={mensagem.tom === 'erro' ? estilos.erro : estilos.ok}>{mensagem.texto}</Text>
        ) : null}
      </View>
    </Sanfona>
  )
}

/**
 * Exportar todos os dados da empresa — LGPD art. 18.
 *
 * O pacote e escrito no servidor com um manifesto de quantos registros de cada
 * tipo foram gerados. Continua disponivel com a conta suspensa: os dados nao
 * servem de garantia de cobranca.
 */
export function MeusDados() {
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDaExportacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function exportar() {
    setGerando(true)
    setErro(null)
    const r = await exportarDados()
    setGerando(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setResultado(r.dados)
  }

  const total = resultado?.manifest.collections.reduce((s, c) => s + c.rows, 0) ?? 0

  return (
    <Sanfona titulo="Seus dados" resumo="exportação completa">
      <View style={estilos.bloco}>
        <Text style={estilos.texto}>
          Leve todos os dados desta empresa para outro sistema quando quiser: vendas, clientes,
          produtos, financeiro, estoque, notas e a trilha de auditoria. Cada exportação fica
          registrada na trilha, com quem gerou e quando.
        </Text>
        <Botao onPress={() => void exportar()} carregando={gerando} largura>
          {gerando ? 'Gerando o pacote...' : 'Exportar meus dados'}
        </Botao>
        {erro !== null ? <Text style={estilos.erro}>{erro}</Text> : null}
        {resultado !== null ? (
          <View style={estilos.resultado}>
            <Text style={estilos.resultadoTitulo}>
              Pacote gerado: {total.toLocaleString('pt-BR')} registros
            </Text>
            {resultado.manifest.collections.map((c) => (
              <View key={c.name} style={estilos.linha}>
                <Text style={estilos.texto}>{c.name}</Text>
                <Text style={estilos.texto}>{c.rows.toLocaleString('pt-BR')}</Text>
              </View>
            ))}
            <Text style={estilos.texto}>
              Escrito no servidor em {resultado.location}. Peça o arquivo pelo Suporte citando este
              caminho.
            </Text>
          </View>
        ) : null}
      </View>
    </Sanfona>
  )
}

const estilos = criarEstilos(() => ({
  bloco: { gap: espaco.md },
  texto: { fontSize: fonte.micro, lineHeight: 19, color: cores.textoFraco },
  erro: { fontSize: fonte.pequeno, color: cores.erro },
  ok: { fontSize: fonte.pequeno, color: cores.sucesso },
  rotuloCsc: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  resultado: {
    ...vidro.painel,
    gap: espaco.xs,
    padding: espaco.md,
    borderRadius: raio.sm,
  },
  resultadoTitulo: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.texto },
  linha: { flexDirection: 'row', justifyContent: 'space-between' },
}))
