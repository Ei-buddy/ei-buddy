# Visão do produto

> Documento de referência para decisões de escopo. Se uma funcionalidade não
> ajuda a atender o problema descrito aqui, ela não entra no MVP.

## O problema

Pequenos e médios negócios brasileiros — lojas de bairro, prestadores de
serviço, revendedores — operam a gestão em três lugares desconectados:

1. **Caderno ou planilha** para vendas, fiado e contas.
2. **WhatsApp** para falar com cliente, negociar, mandar catálogo e cobrar.
3. **Contador**, que recebe tudo tarde, incompleto e fora de padrão.

ERPs existentes resolvem o item 1, mas exigem que o lojista pare de vender,
sente na frente de um computador e aprenda um sistema com dezenas de telas. O
custo de adoção é alto demais para quem atende no balcão o dia inteiro, e o
resultado é o abandono: o sistema é comprado, usado por duas semanas e
esquecido.

Enquanto isso, o WhatsApp já é onde o negócio acontece — mas não registra nada.
A conversa vira venda, e a venda não vira dado.

## A proposta

Um ERP completo cujo **canal principal de operação é a conversa**. O lojista
pede por mensagem o que faria por formulário:

> — _cadastra o cliente João, telefone 11 98888-7777_
> — _lança uma venda pro João: 2 camisetas M a 49,90, pagou no Pix_
> — _quanto tenho a receber essa semana?_
> — _manda a cobrança pro João_

E o aplicativo continua existindo para o que é melhor na tela: bipar código de
barras no balcão, conferir relatório, revisar o fechamento do dia.

**As duas formas de uso operam sobre o mesmo banco e as mesmas regras.** Uma
venda lançada por mensagem é idêntica a uma venda lançada no app: mesmo cálculo
de custo, imposto e tarifa de cartão, mesmo lançamento em contas a receber,
mesma emissão fiscal.

## Público-alvo

**Primário (MVP):** comércio varejista de pequeno porte no Brasil, com CNPJ,
operado pelo próprio dono no balcão, faturamento até R$ 360 mil/ano (Simples
Nacional), que já vende pelo WhatsApp e emite (ou deveria emitir) NFC-e. Sem
equipe como usuário do sistema — ver
[US-003](user-stories.md#us-003--convidar-equipe).

**Secundário (pós-MVP):** prestadores de serviço com NFS-e, e negócios sem CNPJ
em fase de formalização.

**Fora do alvo:** indústria, atacado com regime tributário complexo, negócios
com múltiplas filiais e estoque distribuído. Ver
[Escopo do MVP](escopo-mvp.md#fora-do-mvp).

## Proposta de valor

| Para o lojista                  | O que muda                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Não precisa aprender um sistema | Fala com o assistente como fala com um funcionário                           |
| Não precisa parar de vender     | Registra a venda na mesma conversa em que ela aconteceu                      |
| Sabe o lucro real               | Custo, imposto e tarifa de cartão são calculados na venda, não no fim do mês |
| Cobra sem constrangimento       | O sistema dispara a cobrança, com o histórico correto                        |
| Fica em dia com o fisco         | Emissão de NFC-e/NFS-e no momento da venda                                   |

## Diferencial

O diferencial **não** é ter um chatbot: é que o assistente aciona os mesmos
casos de uso do ERP, com as mesmas validações e a mesma trilha de auditoria.
Concorrentes ou têm ERP sem conversa, ou têm bot de atendimento sem ERP por
trás. A arquitetura descrita em [`principios.md`](../arquitetura/principios.md)
existe para garantir que essa equivalência não se perca com o tempo — é uma
decisão de engenharia sustentando uma decisão de produto.

## Métricas de sucesso

> [!IMPORTANT]
> Os alvos abaixo são **hipóteses iniciais**, não metas validadas. Precisam ser
> revisados com dados reais depois dos primeiros clientes — ver
> [QST-007](../decisoes/README.md#qst-007).

| #   | Métrica                                      | Por que importa                                                           | Alvo inicial         |
| --- | -------------------------------------------- | ------------------------------------------------------------------------- | -------------------- |
| M1  | % de lojistas ativos após 30 dias            | Mede se a adoção sobrevive à novidade — é o problema que mata ERPs de SMB | ≥ 60%                |
| M2  | % de vendas lançadas via WhatsApp            | Valida a tese central do produto                                          | ≥ 40%                |
| M3  | Tempo até a primeira venda registrada        | Mede o atrito de onboarding                                               | ≤ 15 min             |
| M4  | Vendas registradas por lojista/semana        | Distingue uso real de uso cerimonial                                      | ≥ 20                 |
| M5  | % de intenções atendidas sem correção humana | Qualidade do assistente                                                   | ≥ 85%                |
| M6  | Churn mensal                                 | Saúde do negócio                                                          | ≤ 5%                 |
| M7  | Custo de IA por lojista/mês                  | Viabilidade da margem — ver [RNF-072](requisitos-nao-funcionais.md)       | ≤ 15% da mensalidade |

## Princípios de produto

1. **A conversa é a interface principal.** Toda funcionalidade nova precisa
   responder: como isso é acionado por mensagem?
2. **Nunca perguntar o que já se sabe.** Se o dado está no cadastro, no
   histórico ou na conversa, o assistente não pergunta de novo.
3. **Dinheiro exige confirmação explícita.** Consultar é livre; criar,
   alterar ou apagar algo que mexe em valor pede confirmação do usuário —
   ver [`fluxos.md`](../arquitetura/fluxos.md#confirmação-de-ações-sensíveis).
4. **Errar barato.** Toda ação é reversível ou estornável, com trilha de
   auditoria. O lojista precisa poder desfazer sem medo.
5. **O lojista é dono dos dados dele.** Exportação sempre disponível, sem
   sequestro de dados como estratégia de retenção.

## Não-objetivos

O que o produto conscientemente **não** se propõe a ser:

- Não é uma **plataforma de atendimento** ao cliente final. O assistente atende
  o lojista, não os clientes dele (isso é roadmap, não MVP).
- Não é um **marketplace** no MVP — está no [roadmap](escopo-mvp.md#roadmap).
- Não é um **sistema contábil**. Gera dado fiscal correto e exportável para o
  contador; não substitui o contador.
- Não é uma **instituição de pagamento**. O sistema gera cobrança Pix e link de
  pagamento através de um PSP ([PagMaxx](../arquitetura/integracoes/pagmaxx.md)),
  e registra o que passa pela maquininha da lojista — mas não custodia dinheiro
  nem substitui a adquirente dela. O limite exato entre "gerar cobrança" e
  "processar pagamento" tem consequência regulatória e está em
  [DEC-015](../decisoes/README.md#dec-015).

## Documentos relacionados

- [Personas](personas.md) — quem são os usuários descritos aqui
- [Escopo do MVP](escopo-mvp.md) — o recorte concreto desta visão
- [User Stories](user-stories.md) — como isso vira trabalho
