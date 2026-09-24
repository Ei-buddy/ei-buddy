'use client'

import { useEffect, useState } from 'react'
import {
  estadoDaNota,
  pedirNota,
  reconciliarContingencia,
  situacaoCertificado,
  type EstadoEmissao,
  type NotaEmitida,
  type SituacaoCertificado,
} from '@/lib/vendas-api'
import { formatMoney } from '@/lib/format'
import { tocarConfirmacao } from '@/lib/som'
import { Card } from '@/components/ui/UI'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Spinner } from '@/components/auth/Fields'
import { IconCheck, IconReceipt, IconShield } from '@/components/Icons'
import styles from './vendas.module.css'

export default function EtapaFiscal({
  vendaId,
  vendaNumero,
  total,
  onConcluir,
}: {
  vendaId: string
  vendaNumero: string
  total: number
  onConcluir: () => void
}) {
  const [certificado, setCertificado] = useState<SituacaoCertificado | null>(null)
  const [estado, setEstado] = useState<EstadoEmissao>('ocioso')
  const [nota, setNota] = useState<NotaEmitida | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [totalExibido, setTotalExibido] = useState(0)

  /*
   * O momento de maior satisfacao do dia do lojista e este: a venda fechou.
   * O numero subindo ate o total (em vez de aparecer pronto) e o som de
   * confirmacao dao esse instante um peso que o card estatico de antes nao
   * tinha — NR-100. `tocarConfirmacao` respeita a preferencia de som sozinha.
   */
  useEffect(() => {
    tocarConfirmacao()

    const duracaoMs = 550
    const inicio = performance.now()
    let quadro: number

    function passo(agora: number) {
      const decorrido = Math.min((agora - inicio) / duracaoMs, 1)
      const progresso = 1 - (1 - decorrido) ** 3 /* ease-out */
      setTotalExibido(Math.round(total * progresso))
      if (decorrido < 1) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      /*
       * Reconcilia antes de perguntar o certificado — RF-053.
       *
       * Este e o momento em que o lojista esta olhando para nota: uma que a
       * SEFAZ ja aceitou nao pode continuar aparecendo como pendente na frente
       * dele. Custa nada quando nao ha contingencia — o caso de uso volta sem
       * consultar o provedor.
       */
      await reconciliarContingencia()

      const s = await situacaoCertificado()
      if (!cancelado) setCertificado(s)
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [])

  /**
   * Pede a nota — RF-045.
   *
   * O servidor ENFILEIRA e responde 202: a venda nao espera a SEFAZ (RNF-004).
   * Por isso a tela nao diz "emitida" ao voltar — ela passa a acompanhar o
   * estado, que e o que a RF-054 pede que seja explicito.
   */
  async function emitir() {
    setEstado('processando')
    setErro(null)

    const pedido = await pedirNota(vendaId)

    if (!pedido.ok) {
      /* A recusa por classificacao (RF-046) chega com o NOME dos produtos que
         faltam. Mostrar a mensagem inteira e o que manda o lojista ao lugar
         certo — resumi-la aqui desfaria o trabalho do servidor. */
      setErro(pedido.error)
      setEstado('erro')
      return
    }

    /*
     * Acompanha ate a SEFAZ responder.
     *
     * NFC-e e sincrona no provedor, entao a resposta costuma vir na primeira ou
     * segunda tentativa — o que se espera aqui e o worker tirar o job da fila.
     * Doze tentativas de um segundo cobrem uma fila ocupada sem prender a tela
     * indefinidamente.
     *
     * Desistir NAO e erro: a nota pode sair depois, e a venda ja esta
     * registrada. O que a tela diz e "ainda processando", com o caminho para
     * conferir mais tarde — dizer "falhou" mandaria o lojista pedir de novo e
     * arriscar uma segunda.
     */
    for (let tentativa = 0; tentativa < 12; tentativa += 1) {
      const atual = await estadoDaNota(vendaId)

      if (atual !== null && atual.status !== 'pending') {
        if (atual.status === 'rejected') {
          setErro(atual.rejection.message)
          setEstado('erro')
          return
        }

        setNota({
          tipo: 'nfce',
          numero: String(atual.number),
          chave: atual.accessKey,
          url: atual.status === 'authorized' ? atual.danfeUrl : '',
          impostos: [],
        })
        setEstado('emitida')
        return
      }

      await new Promise((r) => setTimeout(r, 1000))
    }

    setErro(
      'A nota ainda está sendo processada. A venda está registrada — confira o estado dela em Vendas daqui a pouco.',
    )
    setEstado('erro')
  }

  const podeEmitir = certificado === 'valido'

  return (
    <div className={styles.fiscalGrid}>
      {/* ============ Venda fechada ============ */}
      <Card>
        <div className={styles.vendaFechada}>
          <span className={styles.vendaFechadaIcone}>
            <IconCheck size={26} />
          </span>
          <div>
            <strong>Venda #{vendaNumero} fechada</strong>
            <span>{formatMoney(totalExibido)} · o valor líquido já entrou em contas a receber</span>
          </div>
        </div>
      </Card>

      {/* ============ Documentos fiscais ============ */}
      <Card title="Documentos fiscais">
        {certificado === null ? (
          <p className={styles.carregando}>
            <Spinner size={15} />
            Verificando certificado digital...
          </p>
        ) : !podeEmitir ? (
          /* Sem certificado valido nao adianta deixar tentar: o provedor
             recusaria e o erro chegaria sem explicacao util. */
          <div className={styles.semCertificado}>
            <span className={styles.semCertificadoIcone}>
              <IconShield size={22} />
            </span>

            <div className={styles.semCertificadoTexto}>
              <strong>
                {certificado === 'expirado'
                  ? 'Certificado digital expirado'
                  : 'Nenhum certificado digital cadastrado'}
              </strong>
              <p>
                A emissão de NFC-e e NFS-e depende de um certificado A1 válido. A venda já está
                registrada — assim que o certificado for enviado, dá para emitir a nota por esta
                mesma tela.
              </p>
            </div>

            <div className={styles.semCertificadoAcoes}>
              <ButtonLink href="/app/empresa">
                {certificado === 'expirado' ? 'Trocar certificado' : 'Cadastrar certificado'}
              </ButtonLink>
              <Button variant="secondary" onClick={onConcluir}>
                Concluir sem nota
              </Button>
            </div>
          </div>
        ) : estado === 'emitida' && nota ? (
          /* --- Emitida --- */
          <div className={styles.notaEmitida}>
            <span className={styles.notaIcone}>
              <IconCheck size={22} />
            </span>
            <strong className={styles.notaTitulo}>
              {nota.tipo === 'nfce' ? 'NFC-e' : 'NFS-e'} {nota.numero} emitida
            </strong>
            <p className={styles.notaChave}>{nota.chave}</p>

            <h3 className={styles.impostosTitulo}>Impostos apurados</h3>
            <ul className={styles.impostos}>
              {nota.impostos.map((i) => (
                <li key={i.nome}>
                  <span>{i.nome}</span>
                  <strong>{formatMoney(i.valor)}</strong>
                </li>
              ))}
              <li className={styles.impostoTotal}>
                <span>Total</span>
                <strong>{formatMoney(nota.impostos.reduce((a, i) => a + i.valor, 0))}</strong>
              </li>
            </ul>
            <p className={styles.impostosNota}>Guardados na venda para consulta e relatorio.</p>

            <div className={styles.notaAcoes}>
              <Button variant="secondary">Baixar PDF</Button>
              <Button onClick={onConcluir}>Concluir venda</Button>
            </div>
          </div>
        ) : estado === 'processando' ? (
          /* --- Processando --- */
          <div className={styles.emitindo}>
            <Spinner size={26} />
            <strong>Emitindo a nota...</strong>
            <span>Isso costuma levar alguns segundos.</span>
          </div>
        ) : (
          /* --- Escolha do tipo --- */
          <>
            {estado === 'erro' ? (
              <p className={styles.erro} role="alert">
                {erro ?? 'Não foi possível emitir a nota.'}
              </p>
            ) : null}

            <div className={styles.tiposNota}>
              {/*
                So NFC-e.
                O botao de NFS-e saiu: ela e documento MUNICIPAL, com outro
                endpoint, outro cadastro e outra regra por cidade — e o emissor
                que temos (Focus NFe, DEC-004) so faz NFC-e. Oferecer o botao
                era prometer um documento que nao sairia, e a descoberta viria
                no pior momento: com o cliente esperando na frente do balcao.
              */}
              <button type="button" className={styles.tipoNota} onClick={() => void emitir()}>
                <span className={styles.tipoNotaIcone}>
                  <IconReceipt size={20} />
                </span>
                <strong>NFC-e</strong>
                <span>Para os produtos vendidos</span>
              </button>
            </div>

            <Button variant="ghost" block onClick={onConcluir}>
              Concluir sem emitir nota
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
