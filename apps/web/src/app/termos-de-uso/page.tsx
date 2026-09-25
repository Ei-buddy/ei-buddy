import type { Metadata } from 'next'
import PaginaLegal, { Pendente } from '@/components/legal/PaginaLegal'
import { BRAND } from '@/content/site'

export const metadata: Metadata = {
  title: `Termos de Uso — ${BRAND}`,
  description: 'O que o sistema faz, o que é seu, e o que se espera de cada lado.',
}

/**
 * Termos de Uso — NR-085.
 *
 * ## Por que esta pagina e mais curta que a de privacidade
 *
 * Porque a de privacidade descreve o que o SISTEMA faz, e isso esta no codigo.
 * Termos de uso sao um CONTRATO: preco, prazo de pagamento, nivel de servico,
 * limite de responsabilidade, rescisao, foro. Nada disso da para inferir de
 * codigo, e quase tudo depende de decisoes de negocio abertas — a de cobranca
 * (DEC-010) e a de meio de pagamento (DEC-006 e DEC-015).
 *
 * Entao aqui esta o que ja e verdade e verificavel, e o resto esta marcado. Um
 * contrato inventado por quem escreve software seria pior que a lacuna
 * declarada: teria cara de clausula e nao valeria nada — e, no caso de limite
 * de responsabilidade, poderia prometer ao lojista uma protecao que ninguem se
 * comprometeu a dar.
 *
 * A pagina existe agora porque o formulario de cadastro exige o aceite e
 * linkava para 404: a pessoa marcava "li e aceito" apontando para nada.
 */
export default function TermosDeUso() {
  return (
    <PaginaLegal eyebrow="Documentos" titulo="Termos de Uso" atualizadoEm="2026-09-24">
      <Pendente>
        As condições comerciais — preço, forma e prazo de pagamento, nível de serviço, limite de
        responsabilidade, rescisão e foro — estão em elaboração e serão publicadas aqui antes de o
        sistema entrar em operação comercial. O que está abaixo já vale e descreve o funcionamento
        real do produto.
      </Pendente>

      <h2>O que o {BRAND} é</h2>

      <p>
        Um sistema de gestão para comércio enquadrado como MEI: vendas, estoque, financeiro, emissão
        fiscal e relatórios, com um assistente que responde em linguagem natural. O acesso é por
        conta, e cada conta pertence a uma empresa.
      </p>

      <h2>Sua conta</h2>

      <ul>
        <li>
          Cada pessoa com acesso tem credencial própria e um papel, que define o que ela pode fazer.
          Credencial compartilhada tira de você a capacidade de saber quem lançou o quê — a trilha
          de auditoria registra a pessoa, não o computador.
        </li>
        <li>
          Você é responsável por manter suas credenciais em sigilo e por revogar o acesso de quem
          sai da empresa. O sistema permite as duas coisas.
        </li>
        <li>
          Sair encerra a sessão no servidor. Se suspeitar que alguém obteve seu acesso, troque a
          senha e encerre as sessões.
        </li>
      </ul>

      <h2>Os dados são seus</h2>

      <p>
        O que você lança no sistema é seu. Isso tem consequências práticas, e não é apenas uma
        declaração:
      </p>

      <ul>
        <li>
          Você pode <strong>exportar tudo</strong> em formato aberto, quando quiser, com um
          manifesto que permite conferir se o pacote está completo.
        </li>
        <li>
          A exportação continua disponível mesmo com a conta suspensa por falta de pagamento. Seus
          dados não servem de garantia de cobrança.
        </li>
        <li>
          Não vendemos seus dados, não os cedemos para publicidade e não os usamos para treinar
          modelos.
        </li>
      </ul>

      <p>
        Como cada dado é tratado está na{' '}
        <a href="/politica-de-privacidade">Política de Privacidade</a>.
      </p>

      <h2>Sua responsabilidade sobre os dados de terceiros</h2>

      <p>
        Ao cadastrar clientes, fornecedores e funcionários, você decide o que coletar e para quê.
        Perante essas pessoas, quem responde é você; nós tratamos esses dados por sua conta e ordem.
      </p>

      <p>
        O sistema oferece as ferramentas para você cumprir essa obrigação — exportar os dados de um
        cliente e anonimizá-los mediante pedido de exclusão, preservando o que a legislação fiscal
        obriga a reter.
      </p>

      <h2>Emissão fiscal</h2>

      <p>
        O sistema transmite notas em seu nome, com as credenciais que você fornecer. A
        responsabilidade pelo conteúdo fiscal — dados cadastrais, classificação, tributação — é do
        contribuinte, ou seja, sua e do seu contador. Recusa da Secretaria da Fazenda é devolvida a
        você com o motivo informado por ela.
      </p>

      <h2>Uso aceitável</h2>

      <p>Não é permitido usar o sistema para:</p>

      <ul>
        <li>
          atividade ilícita, ou emissão de documento fiscal que não corresponda a operação real;
        </li>
        <li>
          tentar acessar dados de outra empresa, ou contornar os controles de isolamento e de
          permissão;
        </li>
        <li>
          carga automatizada que degrade o serviço para os demais, fora dos limites documentados.
        </li>
      </ul>

      <h2>Encerramento</h2>

      <p>
        Você pode encerrar sua conta quando quiser. Antes de qualquer remoção, a exportação completa
        fica disponível.
      </p>

      <Pendente>
        Os prazos de aviso, de retenção após o encerramento e as hipóteses de suspensão por nossa
        parte serão definidos junto com as condições comerciais.
      </Pendente>

      <h2>Mudanças nestes termos</h2>

      <p>
        Alterações relevantes serão avisadas dentro do sistema antes de passarem a valer. A data no
        topo diz qual versão você está lendo.
      </p>
    </PaginaLegal>
  )
}
