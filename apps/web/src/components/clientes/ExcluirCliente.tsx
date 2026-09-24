'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { excluirCliente, reativarCliente } from '@/lib/clientes-api'
import { formatDateTime } from '@/lib/format'
import styles from './detalhe.module.css'

/**
 * Tirar o cliente da lista, e trazer de volta — RF-009.
 *
 * ## Duas exclusoes na mesma ficha, e elas NAO sao a mesma coisa
 *
 * Logo abaixo desta secao vive `AnonimizarCliente`, que atende pedido de
 * exclusao do titular (LGPD) e e IRREVERSIVEL: os campos pessoais somem para
 * sempre. Esta aqui e decisao do lojista sobre a propria lista, e da para
 * desfazer — nada e apagado, a linha continua no banco e o historico de vendas
 * continua apontando para ela.
 *
 * Confundir as duas seria caro nos dois sentidos: o lojista que so queria
 * limpar a lista apagaria o nome do cliente para sempre, e quem precisava
 * atender um pedido de LGPD acharia que atendeu ao clicar no botao errado. Por
 * isso os textos daqui dizem "lista" em toda frase, e o botao se chama
 * "Excluir da lista" — nunca "Excluir cliente".
 *
 * ## E nao e "inativo"
 *
 * A lista tem um filtro "Inativos" que quer dizer outra coisa: quem nao compra
 * ha sessenta dias. Isso e observacao sobre comportamento de compra, e o
 * sistema calcula sozinho. Esta tela nunca usa essa palavra.
 */
export default function ExcluirCliente({
  clienteId,
  nome,
  excluidoEm,
  onMudou,
}: {
  clienteId: string
  nome: string
  /** Nulo = ativo. Quando tem data, a secao vira o convite para reativar. */
  excluidoEm: string | null
  onMudou: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function executar(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>) {
    setEnviando(true)
    setErro(null)

    const r = await acao()
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setConfirmando(false)
    onMudou()
  }

  if (excluidoEm !== null) {
    return (
      <div className={styles.exclusao}>
        <p className={styles.privacidadeAviso}>
          Este cliente foi excluído da lista em {formatDateTime(excluidoEm)}. Ele não aparece mais
          em buscas nem no cadastro, mas continua no histórico de vendas.
        </p>

        {erro === null ? null : <p className={styles.privacidadeErro}>{erro}</p>}

        <Button
          variant="secondary"
          disabled={enviando}
          onClick={() => void executar(() => reativarCliente(clienteId))}
        >
          {enviando ? 'Trazendo de volta…' : 'Trazer de volta para a lista'}
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.exclusao}>
      <p className={styles.privacidadeTexto}>
        Excluir da lista tira {nome} do cadastro e das buscas. As vendas já feitas continuam no
        histórico, e dá para trazer de volta depois.
      </p>

      {erro === null ? null : <p className={styles.privacidadeErro}>{erro}</p>}

      {/*
        A confirmacao e um segundo clique, e nao um motivo digitado como na
        anonimizacao: aqui nada se perde, entao exigir texto seria atrito sem
        contrapartida. O que ela impede e o clique acidental.
      */}
      {confirmando ? (
        <div className={styles.privacidadeAcoes}>
          <Button
            variant="danger"
            disabled={enviando}
            onClick={() => void executar(() => excluirCliente(clienteId))}
          >
            {enviando ? 'Excluindo…' : 'Confirmar exclusão da lista'}
          </Button>
          <Button variant="ghost" disabled={enviando} onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirmando(true)}>
          Excluir da lista
        </Button>
      )}
    </div>
  )
}
