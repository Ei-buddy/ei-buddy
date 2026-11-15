import { describe, expect, it, vi } from 'vitest'
import { criarAvisoDeChamado } from './aviso-de-chamado.js'

/** O e-mail de chamado novo — DEC-029, NR-220. */

const CHAMADO = {
  companyId: 'loja-1',
  ticketId: 'ch-1',
  protocol: '2026-0007',
  subject: 'A nota nao sai',
  category: 'tecnico',
  authorName: 'Dona Marina',
  body: 'Da erro de CSC ao emitir.',
}

function montar(destinatarios: { nome: string; email: string }[], loja: string | null) {
  const enviados: { to: string; subject: string; text: string }[] = []
  const send = vi.fn(async (m: { to: string; subject: string; text: string }) => {
    if (m.to === 'quebra@x.local') throw new Error('SMTP recusou')
    enviados.push(m)
  })
  const aviso = criarAvisoDeChamado({
    email: { send },
    diretorio: { destinatarios: async () => destinatarios, nomeDaLoja: async () => loja },
    webUrl: 'https://app.eibuddy.com.br',
  })
  return { aviso, enviados, send }
}

describe('aviso de chamado novo', () => {
  it('um e-mail por Super Admin, com loja, protocolo, categoria, mensagem e o link', async () => {
    const { aviso, enviados } = montar(
      [
        { nome: 'Ana', email: 'ana@x.local' },
        { nome: 'Bruno', email: 'bruno@x.local' },
      ],
      'Mercadinho da Ana',
    )
    await aviso.chamadoAberto(CHAMADO)

    expect(enviados.map((e) => e.to)).toEqual(['ana@x.local', 'bruno@x.local'])
    expect(enviados[0]?.subject).toBe('Novo chamado 2026-0007 — Mercadinho da Ana: A nota nao sai')
    const texto = enviados[0]?.text ?? ''
    expect(texto).toContain('Mercadinho da Ana abriu um chamado de suporte.')
    expect(texto).toContain('Categoria: Técnico')
    expect(texto).toContain('Quem escreveu: Dona Marina')
    expect(texto).toContain('Da erro de CSC ao emitir.')
    expect(texto).toContain('https://app.eibuddy.com.br/app/plataforma/chamados')
  })

  it('um envio que falha nao impede os outros', async () => {
    const { aviso, enviados, send } = montar(
      [
        { nome: 'Quebra', email: 'quebra@x.local' },
        { nome: 'Ana', email: 'ana@x.local' },
      ],
      'Loja',
    )
    await expect(aviso.chamadoAberto(CHAMADO)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(2)
    expect(enviados.map((e) => e.to)).toEqual(['ana@x.local'])
  })

  it('sem Super Admin, nao envia nada; loja sem nome vira "Uma loja"', async () => {
    const vazio = montar([], 'Loja')
    await vazio.aviso.chamadoAberto(CHAMADO)
    expect(vazio.send).not.toHaveBeenCalled()

    const semNome = montar([{ nome: 'Ana', email: 'ana@x.local' }], null)
    await semNome.aviso.chamadoAberto(CHAMADO)
    expect(semNome.enviados[0]?.subject).toContain('Uma loja')
  })
})
