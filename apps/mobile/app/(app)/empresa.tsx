import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { buscarCep, carregarEmpresa, salvarEmpresa, type DadosEmpresa } from '@/lib/empresa-api'
import { maskCelular, maskCEP, maskCNPJ } from '@/lib/validation'
import { CelularDoCanal, CertificadoDigital, MeusDados } from '@/components/EmpresaSecoes'
import ComandosWhatsApp from '@/components/ComandosWhatsApp'
import { COMANDOS_EMPRESA } from '@/lib/comandos'
import Cabecalho from '@/components/Cabecalho'
import Sanfona from '@/components/ui/Sanfona'
import Campo from '@/components/ui/Campo'
import Botao from '@/components/ui/Botao'
import { cores, espaco, fonte } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/**
 * Dados da empresa.
 *
 * Formulario longo — no web sao quatro cartoes lado a lado. Aqui cada
 * bloco e uma sanfona, senao vira uma rolagem de trinta campos.
 *
 * Como no web: certificado digital (RF-004), o celular que opera a loja pelo
 * WhatsApp (RF-132) e a exportacao completa dos dados (LGPD art. 18).
 */
export default function Empresa() {
  const [campos, setCampos] = useState<DadosEmpresa | null>(null)
  const [erroAoCarregar, setErroAoCarregar] = useState<string | null>(null)

  /* Abre com o que a loja TEM gravado — antes abria com a mercearia de
     exemplo, e quem salvasse sem reparar gravaria os dados de outra empresa. */
  useEffect(() => {
    let cancelado = false
    void carregarEmpresa().then((r) => {
      if (cancelado) return
      if (r.ok) setCampos({ ...r.dados, cnpj: maskCNPJ(r.dados.cnpj), cep: maskCEP(r.dados.cep) })
      else setErroAoCarregar(r.erro)
    })
    return () => {
      cancelado = true
    }
  }, [])

  const [buscandoCep, setBuscandoCep] = useState(false)
  const [salvando, setSalvando] = useState(false)

  function set<K extends keyof DadosEmpresa>(chave: K, valor: string) {
    setCampos((c) => (c === null ? c : { ...c, [chave]: valor }))
  }

  async function preencherPorCep(cep: string) {
    if (cep.replace(/\D/g, '').length !== 8) return

    setBuscandoCep(true)
    const r = await buscarCep(cep)
    setBuscandoCep(false)

    if (!r.ok) {
      Alert.alert('CEP', r.erro)
      return
    }

    /* Numero e complemento continuam com quem preencheu — o CEP nao os
       conhece, e sobrescrever apagaria o que ja foi digitado. */
    setCampos((c) =>
      c === null
        ? c
        : {
            ...c,
            logradouro: r.dados.logradouro,
            bairro: r.dados.bairro,
            cidade: r.dados.cidade,
            uf: r.dados.uf,
          },
    )
  }

  async function salvar() {
    if (campos === null) return

    setSalvando(true)
    const r = await salvarEmpresa(campos)
    setSalvando(false)

    if (!r.ok) {
      Alert.alert('Não deu certo', r.erro)
      return
    }
    setCampos({ ...r.dados, cnpj: maskCNPJ(r.dados.cnpj), cep: maskCEP(r.dados.cep) })
    Alert.alert('Salvo', 'Dados da empresa atualizados.')
  }

  if (campos === null) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <Cabecalho titulo="Empresa" />
        {erroAoCarregar ? (
          <Text style={estilos.erroAoCarregar}>{erroAoCarregar}</Text>
        ) : (
          <ActivityIndicator style={estilos.carregando} color={cores.acento} />
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <Cabecalho titulo="Empresa" subtitulo={campos.nomeFantasia} />

      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <Sanfona titulo="Identificação" resumo={campos.cnpj} inicialAberta>
          {/* Somente leitura: trocar CNPJ e outra empresa, e a api nem aceita. */}
          <Campo
            rotulo="CNPJ"
            valor={campos.cnpj}
            onChange={() => undefined}
            editavel={false}
            dica="Para trocar o CNPJ, fale com o suporte."
          />
          <Campo
            rotulo="Razão social"
            valor={campos.razaoSocial}
            onChange={(v) => set('razaoSocial', v)}
          />
          <Campo
            rotulo="Nome fantasia"
            valor={campos.nomeFantasia}
            onChange={(v) => set('nomeFantasia', v)}
          />
          <Campo
            rotulo="Ramo de atividade"
            valor={campos.ramoAtividade}
            onChange={(v) => set('ramoAtividade', v)}
          />
          <Campo
            rotulo="Inscrição estadual"
            valor={campos.inscricaoEstadual}
            onChange={(v) => set('inscricaoEstadual', v)}
          />
          <Campo
            rotulo="Inscrição municipal"
            valor={campos.inscricaoMunicipal}
            onChange={(v) => set('inscricaoMunicipal', v)}
          />
        </Sanfona>

        <Sanfona titulo="Endereço" resumo={resumoDoEndereco(campos.cidade, campos.uf)}>
          <Campo
            rotulo="CEP"
            valor={campos.cep}
            onChange={(v) => {
              const m = maskCEP(v)
              set('cep', m)
              void preencherPorCep(m)
            }}
            dica={buscandoCep ? 'Buscando endereço...' : undefined}
            tipoTeclado="numeric"
          />
          <Campo
            rotulo="Logradouro"
            valor={campos.logradouro}
            onChange={(v) => set('logradouro', v)}
          />
          <Campo
            rotulo="Número"
            valor={campos.numero}
            onChange={(v) => set('numero', v)}
            tipoTeclado="numeric"
          />
          <Campo
            rotulo="Complemento"
            valor={campos.complemento}
            onChange={(v) => set('complemento', v)}
          />
          <Campo rotulo="Bairro" valor={campos.bairro} onChange={(v) => set('bairro', v)} />
          <Campo rotulo="Cidade" valor={campos.cidade} onChange={(v) => set('cidade', v)} />
          <Campo
            rotulo="UF"
            valor={campos.uf}
            onChange={(v) => set('uf', v.toUpperCase().slice(0, 2))}
            autoCap="characters"
          />
        </Sanfona>

        <Sanfona titulo="Contato" resumo={resumoDoContato(campos.ddd, campos.celular)}>
          <Campo
            rotulo="DDD"
            valor={campos.ddd}
            onChange={(v) => set('ddd', v.replace(/\D/g, '').slice(0, 2))}
            tipoTeclado="numeric"
          />
          <Campo
            rotulo="Celular / WhatsApp"
            valor={campos.celular}
            onChange={(v) => set('celular', maskCelular(v))}
            tipoTeclado="phone-pad"
          />
        </Sanfona>

        <Botao onPress={salvar} carregando={salvando} largura>
          {salvando ? 'Salvando...' : 'Salvar alterações'}
        </Botao>

        {/* Fora do formulario: cada um grava sozinho, com seu proprio botao. */}
        <CertificadoDigital />
        <CelularDoCanal />
        <MeusDados />
        {/* Via WhatsApp, como no web — NR-165. */}
        <ComandosWhatsApp comandos={COMANDOS_EMPRESA} />
      </ScrollView>
    </SafeAreaView>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  carregando: { marginTop: espaco.xl },
  erroAoCarregar: { padding: espaco.lg, fontSize: fonte.corpo, color: cores.texto },
  conteudo: { padding: espaco.lg, gap: espaco.md, paddingBottom: espaco.xxl },
}))

/* Campo vazio vira "não informado" — antes o resumo mostrava "/" e "()". */
function resumoDoEndereco(cidade: string, uf: string): string {
  const partes = [cidade.trim(), uf.trim()].filter((p) => p !== '')
  return partes.length > 0 ? partes.join('/') : 'não informado'
}

function resumoDoContato(ddd: string, celular: string): string {
  if (celular.trim() === '') return 'não informado'
  return ddd.trim() === '' ? celular : `(${ddd}) ${celular}`
}
