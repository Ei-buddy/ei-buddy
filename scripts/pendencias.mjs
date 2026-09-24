#!/usr/bin/env node
/**
 * O que falta para o sistema sair do "sobe sem credencial" — `pnpm pendencias`.
 *
 * ## Por que um script, e nao so o documento
 *
 * As pendencias de configuracao estavam espalhadas por cinco arquivos:
 * `.env.example` (as variaveis), `docs/decisoes/README.md` (as decisoes),
 * `docs/processo/task-ledger.md` (as tarefas), `infra/README.md` (o deploy) e
 * os corpos dos PRs. Para saber o que ainda falta era preciso ler os cinco e
 * cruzar — e a resposta mudava sem ninguem atualizar o resumo.
 *
 * Aqui a resposta e LIDA do ambiente. Se a variavel esta preenchida, o item
 * aparece pronto; se nao, aparece com o que exatamente fazer e o que destrava.
 * Documento nao mente por desatualizacao quando ele e um programa.
 *
 * ## O que este script NAO faz
 *
 * Nao valida credencial contra provedor nenhum: preenchido e diferente de
 * valido, e bater na Asaas ou na Meta a cada execucao tornaria o comando lento
 * e dependente de rede. Quem prova que a credencial funciona e o sistema
 * subindo — este script diz apenas se ha o que provar.
 *
 * Uso:
 *   pnpm pendencias           # le .env se existir, senao o ambiente
 *   pnpm pendencias --env .env.producao
 */

import fs from 'node:fs'
import path from 'node:path'

const RAIZ = process.cwd()

/* ------------------------------------------------------------------------- */
/* Leitura do ambiente                                                        */
/* ------------------------------------------------------------------------- */

const argumentos = process.argv.slice(2)
const indiceEnv = argumentos.indexOf('--env')
const arquivoEnv = indiceEnv >= 0 ? argumentos[indiceEnv + 1] : '.env'

/**
 * Parser minimo de `.env`.
 *
 * Nao usa `dotenv` de proposito: o script roda antes de qualquer instalacao
 * em maquina nova, e uma dependencia aqui faria o diagnostico depender do que
 * ele esta diagnosticando.
 *
 * Aceita `CHAVE=valor`, ignora comentario e linha vazia, e tira aspas das
 * pontas — o suficiente para dizer se ha valor.
 */
function lerEnv(caminho) {
  const absoluto = path.resolve(RAIZ, caminho ?? '.env')
  if (!fs.existsSync(absoluto)) return {}

  const mapa = {}
  for (const linha of fs.readFileSync(absoluto, 'utf8').split('\n')) {
    const limpa = linha.trim()
    if (limpa === '' || limpa.startsWith('#')) continue

    const corte = limpa.indexOf('=')
    if (corte < 0) continue

    const chave = limpa.slice(0, corte).trim()
    const valor = limpa
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, '')

    mapa[chave] = valor
  }
  return mapa
}

const doArquivo = lerEnv(arquivoEnv)

/** O ambiente do processo ganha do arquivo: e ele que o sistema vai ler. */
const valor = (chave) => {
  const v = process.env[chave] ?? doArquivo[chave]
  return v === undefined || v.trim() === '' ? undefined : v.trim()
}

const todasPreenchidas = (chaves) => chaves.every((c) => valor(c) !== undefined)
const algumaPreenchida = (chaves) => chaves.some((c) => valor(c) !== undefined)

/* ------------------------------------------------------------------------- */
/* As pendencias                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Cada item diz: o que e, quem resolve, o que destrava, e o que fazer.
 *
 * Todos os itens desta lista sao de PRODUTO — e o recorte do arquivo: o que
 * depende de uma decisao ou de um acesso, nao de escrever codigo. O que e
 * trabalho de codigo mora no ledger.
 */
const PENDENCIAS = [
  {
    id: 'QST-002',
    titulo: 'Preco da mensalidade e prazos do periodo de teste',
    chaves: [
      'BILLING_TRIAL_DAYS',
      'BILLING_TRIAL_WARNING_DAYS',
      'BILLING_GRACE_DAYS',
      'BILLING_TRIAL_PLAN',
    ],
    pronto: () =>
      todasPreenchidas([
        'BILLING_TRIAL_DAYS',
        'BILLING_TRIAL_WARNING_DAYS',
        'BILLING_GRACE_DAYS',
        'BILLING_TRIAL_PLAN',
      ]),
    destrava: 'o resto da NR-063 (varredura diaria de assinatura) e toda a NR-075 (planos na web)',
    oQueFazer: [
      'Quatro numeros e um nome de plano, no `.env` do servidor:',
      '  BILLING_TRIAL_DAYS          dias de teste gratuito',
      '  BILLING_TRIAL_WARNING_DAYS  quantos dias antes do fim o lojista e avisado',
      '  BILLING_GRACE_DAYS          tolerancia depois do vencimento antes de bloquear',
      '  BILLING_TRIAL_PLAN          identificador do plano em que a empresa nasce',
      '',
      'Os quatro andam JUNTOS: meio periodo configurado e um teste que comeca e',
      'nunca avisa que vai acabar. Enquanto vazios, a empresa nasce sem',
      'assinatura e continua lancando normalmente — nada quebra.',
      '',
      'O preco em si ainda nao tem variavel: ele entra com a NR-075, junto da',
      'tela de planos. O que trava hoje sao os prazos.',
    ],
  },
  {
    id: 'DEC-009 / NR-015',
    titulo: 'Destino do backup remoto',
    chaves: ['BACKUP_REMOTO'],
    pronto: () => valor('BACKUP_REMOTO') !== undefined,
    destrava: 'a NR-015 (restore mensal testado, RNF-013)',
    oQueFazer: [
      'Um destino rclone em `BACKUP_REMOTO` — por exemplo `s3:meu-bucket/eibuddy`',
      'ou `b2:eibuddy-backup`.',
      '',
      'Sem ele o dump roda e fica NA PROPRIA VM: um disco que morre leva o',
      'backup junto, que e o cenario que o backup existe para cobrir.',
    ],
  },
  {
    id: 'ADR-0014 / NR-046',
    titulo: 'Credenciais da Meta Cloud API (WhatsApp)',
    chaves: [
      'WHATSAPP_API_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_WEBHOOK_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
    ],
    pronto: () =>
      valor('WHATSAPP_PROVIDER') === 'meta' &&
      todasPreenchidas([
        'WHATSAPP_API_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_WEBHOOK_SECRET',
        'WHATSAPP_VERIFY_TOKEN',
      ]),
    destrava: 'o aceite no chip que fecha a NR-046',
    oQueFazer: [
      'Do painel da Meta, em `WHATSAPP_PROVIDER=meta`:',
      '  WHATSAPP_API_TOKEN        Bearer de envio',
      '  WHATSAPP_PHONE_NUMBER_ID  id do numero',
      '  WHATSAPP_WEBHOOK_SECRET   App Secret (o HMAC do X-Hub-Signature-256)',
      '  WHATSAPP_VERIFY_TOKEN     o que voce escolher, repetido no painel',
      '',
      'O App Secret NAO e o mesmo que o token de envio — foi confundir os dois',
      'que deixaria toda notificacao voltando 401 em silencio.',
      '',
      'O codigo esta pronto: adapter, webhook, verificacao e consentimento.',
      'Falta a secao 3 (manual) de',
      'specs/009-conversa-agente-whatsapp/quickstart.md.',
    ],
  },
  {
    id: 'QST-012',
    titulo: 'Conta Asaas de sandbox',
    chaves: ['ASAAS_API_KEY', 'ASAAS_WEBHOOK_AUTH_TOKEN'],
    pronto: () => todasPreenchidas(['ASAAS_API_KEY', 'ASAAS_WEBHOOK_AUTH_TOKEN']),
    destrava: 'exercitar o adapter de pagamento contra o provedor de verdade',
    oQueFazer: [
      '  ASAAS_API_KEY             chave da conta (sandbox serve)',
      '  ASAAS_WEBHOOK_AUTH_TOKEN  o token estatico que voce cadastra no painel',
      '',
      'O webhook da Asaas NAO manda HMAC: ela manda esse token fixo no cabecalho',
      '`asaas-access-token`. Conferir assinatura em vez do token faria toda',
      'notificacao voltar 401 e nada nunca baixar.',
    ],
  },
  {
    id: 'ADR-0010',
    titulo: 'Chave da OpenAI para o assistente',
    chaves: ['OPENAI_API_KEY'],
    pronto: () => valor('OPENAI_API_KEY') !== undefined,
    destrava: 'o assistente responder de verdade (sem ela a rota responde 503)',
    oQueFazer: ['  OPENAI_API_KEY  chave do projeto'],
  },
]

/* ------------------------------------------------------------------------- */
/* O que nao da para ler de variavel                                          */
/* ------------------------------------------------------------------------- */

/**
 * Passos em painel, que nenhum arquivo do repositorio registra.
 *
 * Aparecem sempre, sem marca de pronto: dizer "pronto" aqui seria chute, e um
 * chute otimista num checklist e pior que a ausencia do item.
 */
const NO_PAINEL = [
  {
    titulo: 'Environment `dev` no GitHub, com os segredos da VM de teste',
    onde: 'Settings → Environments → New environment → `dev`',
    porque: [
      'O deploy automatico da `dev` le os segredos DESTE Environment. Sem ele o',
      'workflow falha alto e para — nao cai em producao, isso esta travado na',
      'expressao do `deploy.yml`. Mas tambem nao deploya nada.',
      '',
      'Quatro segredos, os mesmos nomes do Environment de producao apontando',
      'para outra maquina: VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_KNOWN_HOSTS.',
    ],
  },
  {
    titulo: 'Protecao de branch na `dev`',
    onde: 'Settings → Branches → Add rule → `dev`',
    porque: [
      'A `dev` recebe deploy automatico: um push direto vai para a VM de teste',
      'sem passar pela CI. Exigir PR e checks verdes fecha esse caminho.',
    ],
  },
  {
    titulo: 'Promover `dev` para `main`',
    onde: 'PR de `dev` para `main`, com merge COMMIT (nao squash)',
    porque: [
      'Producao esta atras da `dev` — por desenho, mas a distancia so cresce.',
      'Squash achataria dezenas de commits num so e a `main` perderia o',
      'historico que a `dev` tem; merge commit preserva.',
      '',
      'O PR nao introduz codigo novo: tudo ali ja passou pela CI. O deploy de',
      'producao continua sendo um passo a parte, manual.',
    ],
  },
  {
    titulo: 'Revisao juridica dos Termos e da Politica (DEC-016)',
    onde: 'docs/decisoes/README.md#dec-016',
    porque: [
      'As lacunas estao MARCADAS no ponto exato de cada documento, e nao',
      'preenchidas com texto plausivel. O material factual esta pronto — a',
      'revisao parte dele.',
      '',
      'Ao mexer no texto, suba `VERSOES_LEGAIS` no MESMO commit',
      '(packages/contracts/src/legal/legal.ts). Sem isso ninguem reaceita.',
    ],
  },
  {
    titulo: 'Consulta por CPF: existe base contratada e base legal?',
    onde: 'apps/web/src/lib/clientes-api.ts (cabecalho)',
    porque: [
      'Diferente do CNPJ, dado de CPF nao e publico. A consulta so pode existir',
      'com base contratada E base legal (LGPD), com registro de quem consultou',
      'o que.',
      '',
      'Enquanto nao houver, a tela trata como "consulta indisponivel" e o',
      'cadastro segue manual — que e o comportamento de hoje, e esta correto.',
    ],
  },
]

/* ------------------------------------------------------------------------- */
/* Saida                                                                      */
/* ------------------------------------------------------------------------- */

const existeArquivo = fs.existsSync(path.resolve(RAIZ, arquivoEnv ?? '.env'))

console.log('')
console.log('O que falta configurar')
console.log('======================')
console.log('')
console.log(
  existeArquivo
    ? `Lendo \`${arquivoEnv}\` (o ambiente do processo ganha dele).`
    : `Sem \`${arquivoEnv}\` aqui — lendo so o ambiente do processo.`,
)
console.log('')

let faltando = 0

for (const p of PENDENCIAS) {
  const ok = p.pronto()
  if (!ok) faltando += 1

  console.log(`${ok ? '[ok]  ' : '[----]'} ${p.id} — ${p.titulo}`)

  if (ok) continue

  /* Meio preenchido e o caso mais perigoso: parece configurado e nao esta. */
  if (algumaPreenchida(p.chaves)) {
    const vazias = p.chaves.filter((c) => valor(c) === undefined)
    console.log(`        PARCIAL — faltam: ${vazias.join(', ')}`)
  }

  console.log(`        destrava: ${p.destrava}`)
  for (const linha of p.oQueFazer) console.log(`        ${linha}`)
  console.log('')
}

console.log('')
console.log('No painel, fora do repositorio')
console.log('------------------------------')
console.log('')

for (const item of NO_PAINEL) {
  console.log(`  ${item.titulo}`)
  console.log(`    onde: ${item.onde}`)
  for (const linha of item.porque) console.log(`    ${linha}`)
  console.log('')
}

console.log(
  faltando === 0
    ? 'Nenhuma variavel pendente. Os passos de painel acima continuam sendo manuais.'
    : `${faltando} de ${PENDENCIAS.length} itens de configuracao ainda vazios.`,
)
console.log('')

/*
 * Sai zero mesmo faltando coisa: este script DIAGNOSTICA, nao reprova. Ele
 * roda em maquina de desenvolvimento, onde estar tudo vazio e o esperado — o
 * sistema sobe sem credencial de proposito. Sair diferente de zero faria
 * qualquer um que o colocasse num hook transformar o diagnostico em barreira.
 */
