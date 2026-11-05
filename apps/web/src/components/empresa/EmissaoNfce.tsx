'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { carregarSituacaoFiscal, salvarCsc, type Csc, type SituacaoFiscal } from '@/lib/empresa-api'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/UI'
import { IconShield } from '@/components/Icons'
import { Spinner } from '@/components/auth/Fields'
import styles from './empresa.module.css'

/**
 * Emissao de NFC-e — NR-183.
 *
 * A EiBuddy cadastra a empresa da loja na Focus NFe (como revenda) com o
 * certificado, o CSC e o endereco desta tela. O lojista nao abre conta na
 * Focus nem cola token: ele informa o CSC que gera no site da SEFAZ e acompanha
 * aqui se o cadastro foi aceito, ou o que falta.
 *
 * Le a situacao do SERVIDOR, e nao do estado da tela: e o unico lugar que sabe
 * se o certificado ja foi enviado numa visita anterior.
 */
export default function EmissaoNfce() {
  const [situacao, setSituacao] = useState<SituacaoFiscal | null>(null)
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarSituacaoFiscal()
    if (r.ok) {
      setSituacao(r.dados)
      setErroDeCarga(null)
    } else {
      setErroDeCarga(r.error)
    }
  }, [])

  useEffect(() => {
    /* `async` explicito: os `setState` vem depois do await, nunca sincronos no
       corpo do efeito — mesmo padrao do `EmpresaForm`. */
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  if (erroDeCarga !== null) {
    return (
      <p className={styles.certErro} role="alert">
        {erroDeCarga}
      </p>
    )
  }
  if (situacao === null) {
    return (
      <p className={styles.certNota}>
        <Spinner size={14} /> Carregando a situação fiscal...
      </p>
    )
  }

  return (
    <div className={styles.certCard}>
      <div className={styles.certHead}>
        <span className={styles.certIcon}>
          <IconShield size={20} />
        </span>
        <div className={styles.certInfo}>
          <strong>Cadastro na Focus NFe</strong>
          <span>Emissor da NFC-e. A EiBuddy faz o cadastro por você.</span>
        </div>
        <SeloDaFocus situacao={situacao} />
      </div>

      <SituacaoDaFocus situacao={situacao} />

      <FormularioCsc
        titulo="CSC de produção"
        configurado={situacao.hasCscProduction}
        onSalvar={(csc) => salvarCsc({ producao: csc })}
        onSalvo={setSituacao}
      />
      <FormularioCsc
        titulo="CSC de homologação (testes)"
        configurado={situacao.hasCscHomologation}
        onSalvar={(csc) => salvarCsc({ homologacao: csc })}
        onSalvo={setSituacao}
      />

      <p className={styles.certNota}>
        O CSC (Código de Segurança do Contribuinte) é gerado no site da SEFAZ do seu estado, junto
        com o ID dele. Ele assina o QR Code da NFC-e e fica guardado cifrado.
      </p>
    </div>
  )
}

function SeloDaFocus({ situacao }: { situacao: SituacaoFiscal }) {
  if (!situacao.focus.available) return <Badge>Em breve</Badge>
  if (situacao.focus.error !== null) return <Badge tone="warning">Pendente</Badge>
  if (situacao.focus.syncedAt !== null) return <Badge tone="success">Cadastrada</Badge>
  return <Badge>Não cadastrada</Badge>
}

function SituacaoDaFocus({ situacao }: { situacao: SituacaoFiscal }) {
  if (!situacao.focus.available) {
    return (
      <p className={styles.certNota}>
        O cadastro na Focus ainda não está ligado neste servidor. Você já pode enviar o certificado
        e o CSC: eles ficam guardados e vão para a Focus assim que for ativado.
      </p>
    )
  }
  if (situacao.focus.error !== null) {
    return (
      <p className={styles.certAlert} role="alert">
        {situacao.focus.error}
      </p>
    )
  }
  if (situacao.focus.syncedAt !== null) {
    return (
      <dl className={styles.certMeta}>
        <div>
          <dt>Cadastrada em</dt>
          <dd>{formatDateTime(situacao.focus.syncedAt)}</dd>
        </div>
        <div>
          <dt>Certificado</dt>
          <dd>{situacao.hasCertificate ? 'Enviado' : 'Falta enviar'}</dd>
        </div>
      </dl>
    )
  }
  return (
    <p className={styles.certNota}>
      Para cadastrar, envie o certificado digital acima e o CSC abaixo. O endereço completo da
      empresa também é necessário.
    </p>
  )
}

function FormularioCsc({
  titulo,
  configurado,
  onSalvar,
  onSalvo,
}: {
  titulo: string
  configurado: boolean
  onSalvar: (
    csc: Csc,
  ) => Promise<{ ok: true; dados: SituacaoFiscal } | { ok: false; error: string }>
  onSalvo: (s: SituacaoFiscal) => void
}) {
  const idId = useId()
  const codigoId = useId()
  const [id, setId] = useState('')
  const [codigo, setCodigo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
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
    const r = await onSalvar({ id: id.trim(), code: codigo.trim() })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    setId('')
    setCodigo('')
    onSalvo(r.dados)
  }

  return (
    <div className={styles.certForm}>
      <div className={styles.certField}>
        <span className={styles.certLabel}>
          {titulo} {configurado ? <Badge tone="success">Configurado</Badge> : null}
        </span>
      </div>
      <div className={styles.certField}>
        <label className={styles.certLabel} htmlFor={idId}>
          ID do CSC
        </label>
        <input
          id={idId}
          className={styles.certInput}
          inputMode="numeric"
          value={id}
          onChange={(e) => {
            setId(e.target.value)
            setErro(null)
          }}
          disabled={salvando}
          placeholder={configurado ? 'Preencha só para trocar' : 'Ex.: 1'}
        />
      </div>
      <div className={styles.certField}>
        <label className={styles.certLabel} htmlFor={codigoId}>
          CSC
        </label>
        <input
          id={codigoId}
          type="password"
          className={styles.certInput}
          value={codigo}
          onChange={(e) => {
            setCodigo(e.target.value)
            setErro(null)
          }}
          disabled={salvando}
          autoComplete="off"
          placeholder={configurado ? 'Preencha só para trocar' : 'Código gerado na SEFAZ'}
        />
      </div>
      {erro ? (
        <p className={styles.certErro} role="alert">
          {erro}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={salvar}
        disabled={salvando || id === '' || codigo === ''}
      >
        {salvando ? (
          <>
            <Spinner size={15} />
            Salvando...
          </>
        ) : configurado ? (
          'Trocar CSC'
        ) : (
          'Salvar CSC'
        )}
      </Button>
    </div>
  )
}
