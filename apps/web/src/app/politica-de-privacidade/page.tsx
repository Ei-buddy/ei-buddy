import type { Metadata } from 'next'
import PaginaLegal, { Pendente } from '@/components/legal/PaginaLegal'
import { BRAND } from '@/content/site'

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description:
    'Quais dados o sistema trata, com qual base legal, por quanto tempo, e como exercer seus direitos.',
}

/**
 * Politica de Privacidade — NR-085, LGPD.
 *
 * ## O que esta pagina e, e o que ela nao e
 *
 * O conteudo abaixo descreve o que o SISTEMA faz, e isso da para afirmar com
 * precisao porque esta no codigo: quais tabelas existem, o que cada uma guarda,
 * o que a exportacao cobre (`exportCollectionSchema`), o que a anonimizacao
 * preserva e por que (`anonymize-customer.ts`), como a sessao e guardada
 * (NR-083), como o isolamento entre lojas funciona (ADR-0001).
 *
 * O que NAO esta aqui, e esta marcado com `Pendente`, e o que nao da para
 * inferir de codigo nenhum: razao social e CNPJ do controlador, contato do
 * encarregado (art. 41), prazo de retencao alem do minimo fiscal, e a lista
 * final de operadores — que depende de decisoes de fornecedor ainda abertas.
 *
 * Preencher esses campos por conta propria produziria um documento com cara de
 * oficial e conteudo inventado, que e pior que a lacuna visivel: ninguem
 * desconfia de um documento que parece completo.
 *
 * ## A distincao que sustenta o resto
 *
 * Ha dois papeis diferentes no mesmo produto, e eles vem da arquitetura, nao de
 * uma escolha de redacao:
 *
 * - dos dados do LOJISTA (conta, empresa, cobranca) somos **controlador**;
 * - dos dados dos CLIENTES do lojista somos **operador** — quem decide o que
 *   coletar e para que e ele, e o isolamento por RLS existe para que nenhuma
 *   loja alcance a base da outra.
 *
 * Misturar os dois faria a pagina prometer, ao consumidor final, direitos que
 * so o lojista pode atender — e faria o lojista achar que a obrigacao dele e
 * nossa.
 */
export default function PoliticaDePrivacidade() {
  return (
    <PaginaLegal eyebrow="Documentos" titulo="Política de Privacidade" atualizadoEm="2026-09-09">
      <p>
        Esta página explica quais dados o {BRAND} trata, por que, por quanto tempo e o que você pode
        exigir a respeito. Ela descreve o funcionamento real do sistema.
      </p>

      <Pendente>
        A identificação do controlador (razão social e CNPJ) e o contato do encarregado pelo
        tratamento de dados, exigido pelo art. 41 da LGPD, ainda serão definidos e publicados aqui.
      </Pendente>

      <h2>Dois papéis diferentes, e a diferença importa</h2>

      <p>
        O {BRAND} é um sistema de gestão usado por comerciantes. Isso cria duas situações que a lei
        trata de forma distinta:
      </p>

      <ul>
        <li>
          <strong>Dados da sua conta e da sua empresa.</strong> Aqui nós somos o controlador: somos
          nós que decidimos quais dados são necessários para o sistema funcionar e para cobrar a
          mensalidade.
        </li>
        <li>
          <strong>Dados dos clientes do comerciante.</strong> Aqui nós somos apenas o operador. Quem
          decide o que registrar sobre cada cliente é o comerciante, e é a ele que o cliente final
          deve se dirigir. Nós apenas guardamos e processamos por conta dele, e cada loja enxerga
          somente a própria base.
        </li>
      </ul>

      <p>
        Se você é cliente de uma loja que usa o {BRAND} e quer acessar ou apagar seus dados, o
        pedido é para a loja. Ela tem, dentro do sistema, as ferramentas para atender você.
      </p>

      <h2>O que o sistema guarda</h2>

      <h3>Sobre você e sua empresa</h3>

      <ul>
        <li>Nome, e-mail e telefone de cada pessoa com acesso, e o papel de cada uma.</li>
        <li>Razão social, CNPJ, endereço, regime tributário e contatos da empresa.</li>
        <li>
          Credenciais de emissão fiscal, quando você as informa. Elas são guardadas cifradas e não
          voltam a ser exibidas.
        </li>
        <li>
          Registro de acesso: quando cada sessão começou e terminou, e o endereço de origem das
          tentativas de login — usado para conter tentativa em massa de adivinhar senha.
        </li>
      </ul>

      <h3>Sobre a operação da loja</h3>

      <p>
        Vendas e itens, pagamentos, contas a pagar e a receber, baixas e estornos, movimentos de
        estoque, produtos, compromissos da agenda, plano de contas, transações bancárias importadas,
        chamados de suporte e a trilha de auditoria. Nos dados de clientes da loja, o que o
        comerciante registrar: nome, telefone, e-mail, CPF ou CNPJ, endereço e saldo em aberto.
      </p>

      <h3>Sua senha</h3>

      <p>
        Não é guardada. O que fica é uma verificação derivada dela, que permite conferir se a senha
        digitada está certa sem que ninguém — inclusive nós — consiga reconstruir a original.
      </p>

      <h2>Por que tratamos cada coisa</h2>

      <ul>
        <li>
          <strong>Execução do contrato</strong> (art. 7, V): sua conta, sua empresa, a sessão e todo
          o dado de operação. Sem eles não há produto.
        </li>
        <li>
          <strong>Obrigação legal</strong> (art. 7, II): documentos fiscais e a trilha de auditoria.
          É o que a legislação fiscal e contábil obriga a guardar.
        </li>
        <li>
          <strong>Legítimo interesse</strong> (art. 7, IX): registros de segurança, como o controle
          de tentativas de login, para proteger a sua conta e as das outras lojas.
        </li>
      </ul>

      <p>
        <strong>
          Não vendemos seus dados, não os cedemos para publicidade e não os usamos para treinar
          modelos.
        </strong>
      </p>

      <h2>Quem mais tem acesso</h2>

      <p>
        Para funcionar, o sistema depende de terceiros — cada um com acesso apenas ao que a função
        dele exige. Hoje está definido o provedor de emissão fiscal, que recebe os dados da nota que
        você emite porque é ele quem a transmite à Secretaria da Fazenda.
      </p>

      <Pendente>
        A lista completa de operadores — hospedagem, meio de pagamento, envio de mensagens e
        assistente — será publicada aqui quando cada fornecedor for escolhido. Enquanto isso, o
        sistema não está em operação comercial.
      </Pendente>

      <h2>Por quanto tempo</h2>

      <p>
        Documentos fiscais ficam <strong>cinco anos</strong>, porque a legislação fiscal exige. A
        trilha de auditoria é somente-inserção: não pode ser alterada nem apagada, inclusive por
        nós, e é o que permite reconstruir quem fez o quê.
      </p>

      <Pendente>
        Os prazos de retenção dos demais dados após o encerramento da conta ainda serão definidos.
      </Pendente>

      <h2>Seus direitos, e como exercer</h2>

      <p>O art. 18 da LGPD garante, entre outros, o direito de:</p>

      <ul>
        <li>saber que dados existem sobre você e obter cópia deles;</li>
        <li>corrigir dado incompleto ou desatualizado;</li>
        <li>
          pedir a exclusão, no que a lei permitir apagar — o que a legislação fiscal obriga a manter
          fica;
        </li>
        <li>levar seus dados para outro fornecedor, em formato aberto.</li>
      </ul>

      <h3>Exportação completa</h3>

      <p>
        Você pode pedir todos os dados da sua empresa em formato aberto, com um manifesto que diz
        quantos registros de cada tipo vieram — para dar para conferir se o pacote está completo, em
        vez de receber um arquivo e ter de confiar. A exportação continua disponível mesmo com a
        conta suspensa por falta de pagamento: seus dados não ficam de refém.
      </p>

      <h3>Exclusão de um cliente</h3>

      <p>
        Quando um cliente da sua loja pede exclusão, o sistema substitui os dados pessoais dele e
        apaga as conversas, mas <strong>preserva as vendas</strong> — sem os dados pessoais. Isso é
        deliberado: apagar as vendas mudaria o seu faturamento e o seu resultado, o que seria
        falsear a contabilidade para atender um pedido de privacidade. Os totais e relatórios
        continuam iguais depois da anonimização.
      </p>

      <p>
        As notas fiscais não são alteradas. O XML é assinado digitalmente: mexer nele destrói o
        próprio documento que a lei obriga a guardar. O CPF que consta ali está amparado em
        obrigação legal, e não em interesse nosso.
      </p>

      <h3>Como pedir</h3>

      <p>
        Abra um chamado em <strong>Suporte</strong>, dentro do sistema. Todo pedido recebe
        protocolo, e a conversa fica registrada — para você e para nós.
      </p>

      <Pendente>
        Um canal de contato para quem não tem conta no sistema, e o prazo de resposta, serão
        publicados junto com o contato do encarregado.
      </Pendente>

      <h2>Segurança</h2>

      <ul>
        <li>
          Cada loja é isolada no banco de dados por política aplicada pelo próprio banco, e não
          apenas pelo código da aplicação. Consulta sem loja definida falha, em vez de devolver dado
          de outra.
        </li>
        <li>O token da sua sessão nunca fica ao alcance do JavaScript da página.</li>
        <li>
          Sair encerra a sessão no servidor, e não apenas no seu aparelho: um token copiado deixa de
          valer.
        </li>
        <li>Credenciais de terceiros que você informa são guardadas cifradas.</li>
      </ul>

      <h2>Cookies</h2>

      <p>
        Há um cookie, e ele é essencial. Não usamos cookie de análise, de publicidade ou de
        rastreamento. O inventário completo está na{' '}
        <a href="/politica-de-cookies">Política de Cookies</a>.
      </p>

      <h2>Mudanças nesta página</h2>

      <p>
        Alterações relevantes serão avisadas dentro do sistema antes de passarem a valer. A data no
        topo diz qual versão você está lendo.
      </p>
    </PaginaLegal>
  )
}
