import type { Metadata } from 'next'
import PaginaLegal, { estilosLegais as styles } from '@/components/legal/PaginaLegal'
import { BRAND } from '@/content/site'
import {
  ARMAZENAMENTO_LOCAL,
  COOKIES,
  EXIGE_CONSENTIMENTO,
  ROTULO_DA_CATEGORIA,
} from '@/lib/cookies'

export const metadata: Metadata = {
  title: `Política de Cookies — ${BRAND}`,
  description:
    'Quais cookies o sistema usa, para que servem e quanto duram. Hoje há um, e ele é essencial.',
}

/**
 * Politica de cookies — NR-085, LGPD art. 9.
 *
 * A tabela sai do inventario em `lib/cookies.ts`, e nao de texto escrito aqui.
 * O motivo esta la: politica de cookies e o documento que envelhece primeiro, e
 * `cookies.test.ts` reprova o PR que gravar um cookie fora da lista. Assim a
 * pagina nao pode divergir do que o codigo faz.
 */
export default function PoliticaDeCookies() {
  return (
    <PaginaLegal
      eyebrow="Documentos"
      titulo="Política de Cookies"
      atualizadoEm="2026-09-09"
      voltarPara="/"
    >
      <p>
        Esta página lista tudo o que o {BRAND} guarda no seu navegador, para que serve e quanto
        tempo fica. A lista é gerada a partir do próprio código do sistema — não é um texto mantido
        à mão, e por isso ela não pode ficar desatualizada em relação ao que acontece de verdade.
      </p>

      <h2>Não pedimos seu consentimento, e explicamos por quê</h2>

      <p>
        Hoje existe <strong>um</strong> cookie, e sem ele o sistema não funciona: é o que mantém
        você autenticado entre uma tela e outra. A base legal para ele não é o consentimento — é a
        execução do contrato (art. 7, inciso V, da LGPD).
      </p>

      <p>
        Perguntar &quot;você aceita cookies?&quot; para algo que será gravado de qualquer forma não
        protegeria você de nada. Serviria para nós, como aparência de conformidade, e treinaria você
        a clicar em &quot;aceitar&quot; sem ler — o que torna o consentimento pior justamente nos
        casos em que ele importa. O que a lei pede aqui é transparência, e é o que está abaixo.
      </p>

      <p>
        <strong>
          Não usamos cookie de análise, de publicidade ou de rastreamento, nem carregamos script de
          terceiros.
        </strong>{' '}
        No dia em que isso mudar, você será perguntado antes — de forma separada por finalidade, e
        podendo mudar de ideia depois. {EXIGE_CONSENTIMENTO ? '' : 'Não é o caso hoje.'}
      </p>

      <h2>Cookies</h2>

      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Para que serve</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((c) => (
              <tr key={c.nome}>
                <td>
                  <code>{c.nome}</code>
                </td>
                <td>
                  <span className={styles.etiqueta}>{ROTULO_DA_CATEGORIA[c.categoria]}</span>
                </td>
                <td>
                  {c.finalidade}
                  {c.httpOnly ? (
                    <>
                      {' '}
                      Ele é marcado como <code>httpOnly</code>: nem o código da própria página
                      consegue lê-lo, o que limita o dano de uma falha de segurança.
                    </>
                  ) : null}
                </td>
                <td>{c.duracao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Outras coisas guardadas no seu navegador</h2>

      <p>
        Tecnicamente não são cookies, e a diferença não muda nada para você: também ficam no seu
        aparelho. Por isso entram aqui.
      </p>

      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Chave</th>
              <th>Tipo</th>
              <th>Para que serve</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {ARMAZENAMENTO_LOCAL.map((a) => (
              <tr key={a.chave}>
                <td>
                  <code>{a.chave}</code>
                </td>
                <td>
                  <span className={styles.etiqueta}>{ROTULO_DA_CATEGORIA[a.categoria]}</span>
                </td>
                <td>{a.finalidade}</td>
                <td>{a.duracao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Como remover</h2>

      <p>
        Você pode apagar tudo isso a qualquer momento pelas configurações do seu navegador, ou
        clicando em <strong>Sair</strong> dentro do sistema — o que encerra a sessão no servidor, e
        não apenas no seu aparelho.
      </p>

      <p>
        Apagar o cookie de sessão desconecta você. Não há perda de dado: o que você lançou fica no
        sistema, e você entra de novo com a mesma conta.
      </p>

      <h2>Dúvidas</h2>

      <p>
        Sobre seus dados em geral, veja a{' '}
        <a href="/politica-de-privacidade">Política de Privacidade</a>, que explica o que coletamos,
        por que, e como exercer seus direitos.
      </p>
    </PaginaLegal>
  )
}
