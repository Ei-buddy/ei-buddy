'use client'

import { useId, useRef, useState } from 'react'
import { enviarCertificado, type Certificado } from '@/lib/empresa-api'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/UI'
import { IconShield, IconTrash, IconUpload } from '@/components/Icons'
import { Spinner } from '@/components/auth/Fields'
import styles from './empresa.module.css'

/**
 * Envio do certificado digital A1 (.pfx/.p12), necessario para emitir
 * NFC-e e NFS-e no modulo de Vendas.
 *
 * SEGURANCA: o arquivo e a senha vao direto para o backend por HTTPS. O
 * navegador nao abre o certificado nem guarda a senha — a validade
 * mostrada aqui vem da resposta do servidor.
 */
export default function CertificadoDigital({
  certificado,
  onChange,
}: {
  certificado: Certificado | null
  onChange: (certificado: Certificado | null) => void
}) {
  const inputId = useId()
  const senhaId = useId()
  const validadeId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  /*
   * A validade e OPCIONAL desde a NR-214: o servidor abre o certificado com a
   * senha e le a data do proprio arquivo (e recusa senha errada e certificado
   * vencido na hora). Digitar so e preciso no A1 de formato antigo, que o
   * servidor nao consegue ler — e ai ele mesmo pede a data.
   */
  const [validoAte, setValidoAte] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    if (!arquivo) {
      setErro('Escolha o arquivo do certificado.')
      return
    }

    setErro(null)
    setEnviando(true)

    const resultado = await enviarCertificado(arquivo, senha, validoAte)
    setEnviando(false)

    if (!resultado.ok) {
      setErro(resultado.error)
      return
    }

    onChange(resultado.certificado)
    setArquivo(null)
    setSenha('')
    setValidoAte('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function remover() {
    onChange(null)
    setArquivo(null)
    setSenha('')
    setValidoAte('')
    setErro(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  /* --- Estado: certificado ja enviado --- */
  if (certificado) {
    const expirado = certificado.status === 'expirado'

    return (
      <div className={styles.certCard}>
        <div className={styles.certHead}>
          <span className={`${styles.certIcon} ${expirado ? styles.certIconWarn : ''}`}>
            <IconShield size={20} />
          </span>

          <div className={styles.certInfo}>
            <strong>{certificado.nomeArquivo}</strong>
            {/* O titular saiu: sem abrir o arquivo, exibi-lo seria inventar. */}
          </div>

          {expirado ? <Badge tone="warning">Expirado</Badge> : <Badge tone="success">Válido</Badge>}
        </div>

        <dl className={styles.certMeta}>
          <div>
            <dt>Válido até</dt>
            <dd>{formatDate(certificado.validoAte)}</dd>
          </div>
          <div>
            <dt>Emissão fiscal</dt>
            <dd>{expirado ? 'Bloqueada' : 'Liberada'}</dd>
          </div>
        </dl>

        {expirado ? (
          <p className={styles.certAlert}>
            O certificado venceu. Até enviar um novo, não é possível emitir NFC-e nem NFS-e.
          </p>
        ) : null}

        <Button variant="secondary" size="sm" onClick={remover}>
          <IconTrash size={15} />
          Trocar certificado
        </Button>
      </div>
    )
  }

  /* --- Estado: nenhum certificado --- */
  return (
    <div className={styles.certCard}>
      <div className={styles.certHead}>
        <span className={styles.certIcon}>
          <IconShield size={20} />
        </span>
        <div className={styles.certInfo}>
          <strong>Nenhum certificado enviado</strong>
          <span>Necessário para emitir NFC-e e NFS-e</span>
        </div>
        <Badge>Não enviado</Badge>
      </div>

      <div className={styles.certForm}>
        <div className={styles.certField}>
          <label className={styles.certLabel} htmlFor={inputId}>
            Arquivo do certificado (.pfx ou .p12)
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept=".pfx,.p12"
            className={styles.certFile}
            disabled={enviando}
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null)
              setErro(null)
            }}
          />
        </div>

        <div className={styles.certField}>
          <label className={styles.certLabel} htmlFor={senhaId}>
            Senha do certificado
          </label>
          <input
            id={senhaId}
            type="password"
            className={styles.certInput}
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value)
              setErro(null)
            }}
            disabled={enviando}
            autoComplete="off"
            placeholder="Senha definida na emissão"
          />
        </div>

        <div className={styles.certField}>
          <label className={styles.certLabel} htmlFor={validadeId}>
            Válido até <span className={styles.certOpcional}>(opcional)</span>
          </label>
          <input
            id={validadeId}
            type="date"
            className={styles.certInput}
            value={validoAte}
            onChange={(e) => {
              setValidoAte(e.target.value)
              setErro(null)
            }}
            disabled={enviando}
          />
          <span className={styles.certAjuda}>
            Pode deixar em branco: lemos a validade do próprio certificado. Só pedimos a data se o
            arquivo for de um formato antigo que não dá para ler.
          </span>
        </div>
      </div>

      {erro ? (
        <p className={styles.certErro} role="alert">
          {erro}
        </p>
      ) : null}

      <Button onClick={enviar} disabled={enviando || !arquivo}>
        {enviando ? (
          <>
            <Spinner size={15} />
            Enviando...
          </>
        ) : (
          <>
            <IconUpload size={16} />
            Enviar certificado
          </>
        )}
      </Button>

      <p className={styles.certNota}>
        O arquivo e a senha são enviados direto ao servidor por conexão segura. A senha não fica
        guardada no navegador.
      </p>
    </div>
  )
}
