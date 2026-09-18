# Research: NR-116

**Date**: 2026-09-18  
**Spec**: [spec.md](./spec.md)

## 1. Onde a foto entra no laço

**Decision**: estender a mensagem de entrada com imagem opcional
(`IncomingMessage` + `agentMessageInputSchema`). A leitura do código acontece
**antes** do LLM, em `processMessage`, via porta `BarcodeDecoder`. Foto sem
texto é válida; texto sem foto permanece o comportamento atual.

**Rationale**: hoje o harness só aceita `text` obrigatório e o LLM só vê string.
Visão do modelo (multimodal) seria instável para EAN, cobraria token e misturaria
identificação de produto com interpretação de linguagem. Recusas de foto ilegível
ou de vários códigos não precisam de modelo. O laço atual já trata confirmação
antes do `decide`; a foto entra no mesmo lugar, como outro portão determinístico.

**Alternatives considered**:

- Mandar a imagem ao `Agent.generate` (visão): rejeitado; identificação de
  catálogo tem de ser determinística e testável sem OpenAI.
- Tool `read_barcode` escolhida pelo LLM: rejeitado; o modelo não vê a imagem no
  `LlmPort` atual (`decide({ text })`) e poderia simplesmente ignorá-la.
- Rota HTTP paralela só de imagem: rejeitado; duplicaria o canal e não
  exercitaria `processMessage`.

## 2. Porta de leitura, não biblioteca no núcleo

**Decision**: declarar `BarcodeDecoder` em `packages/agent` (irmã de `LlmPort`).
Entrada: bytes + tipo MIME. Saída: zero, um ou vários códigos. CI e testes usam
`FakeBarcodeDecoder` (mapa de fixture → códigos). Adapter real (ZXing ou
equivalente, EAN-13/EAN-8/UPC-A) fica atrás da mesma porta e **não** roda na CI.

**Rationale**: constitution II — provedor trocável, testes com adapter falso.
`core` não conhece imagem. `jsQR` só lê QR, inútil para o balcão brasileiro.
O fake permite a matriz da spec sem decodificar JPEG na CI (adapters reais não
entram na CI). O harness HTTP pode enviar a mesma fixture que o fake reconhece.

**Alternatives considered**:

- Decodificar em `core`: rejeitado; imagem é I/O de canal, não regra de
  negócio.
- Dependência obrigatória de ZXing em todo teste: rejeitado pela constitution V
  (adapter real fora da CI) e pelo prazo de dois dias.
- Só QR Code: rejeitado; o código do produto é EAN/GTIN.

## 3. Identificar o produto

**Decision**: com exatamente um código lido, chamar `findProductByBarcode` de
`core` (RF-018) com o `ExecutionContext` da conversa. Não buscar por nome, não
usar `searchProducts` como fonte final, não aceitar `companyId` nos argumentos.

**Rationale**: o caso de uso já devolve `undefined` quando o código não existe
**ou** é de outra empresa — o mesmo 404 semântico do PDV. Reutilizar evita
catálogo paralelo. `ProductOutput.salePriceCents` é o preço de tabela que a
venda por mensagem já usa.

**Alternatives considered**:

- Busca textual pelo dígitos do código: rejeitado; pode colidir com descrição
  e não é RF-018.
- Escolher o primeiro produto da busca: rejeitado; viola isolamento e a
  recusa de item avulso.

## 4. Roteamento venda vs cadastro vs recusa

**Decision**: tabela determinística **depois** da leitura, **sem** LLM:

| Condição                                       | Efeito                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| 0 códigos, imagem corrompida, tipo inválido    | recusa ilegível; não chama `create_sale` nem cadastro                       |
| 2+ códigos, ou 2+ imagens no envio             | recusa; um produto por vez                                                  |
| Pedido explícito de cadastro (`cadastr…`)      | não vende; responde com o código lido; se o produto já existe, avisa        |
| Sem cadastro, produto encontrado               | trata como item de venda (ver §5)                                           |
| Sem cadastro, código lido, produto inexistente | recusa por texto; **não** oferece item avulso; **não** pergunta se cadastra |
| Sem imagem                                     | laço atual inalterado                                                       |

Pedido de cadastro = texto da mesma mensagem casa com intenção explícita
(`cadastra`, `cadastrar`, `cadastre`, e equivalentes acentuados, já
normalizados). Foto sem texto **não** é cadastro. Intenção ambígua não vira
cadastro sozinha.

**Rationale**: RF-137–139 são regras de produto, não de linguagem. Deixar o
modelo escolher `create_sale` numa foto de cadastro, ou oferecer avulso quando
o código não existe, quebraria o aceite. A NR-117 é quem grava o produto; esta
fatia só preserva o código na resposta (e no histórico em texto).

**Alternatives considered**:

- LLM decide a rota: rejeitado; o FakeLlm hoje cai em `unknown` ou, pior, em
  `create_sale` se houver script genérico de venda.
- Executar `registerProduct` aqui: rejeitado; é a NR-117 e inventaria nome,
  custo e preço.
- Perguntar “quer cadastrar?” quando o produto não existe: rejeitado
  explicitamente pela US-068.

## 5. Venda depois da foto

**Decision**: reutilizar a tool `create_sale` já existente (`mutatesValue:
true`, `registerSale`, confirmação NR-061). Esta fatia **não** cria tool nova
de mutação.

Com produto encontrado e sem pedido de cadastro:

1. Quantidade omitida = 1; `unitPriceCents` = `salePriceCents` do produto
   (cópia do núcleo, não cálculo do agente).
2. Se a mensagem **não** informa forma de pagamento: resposta `clarify`
   identificando o produto e o preço, pedindo pagamento (e cliente, se a
   forma for fiado). Não inventa Pix, não pede confirmação ainda, não grava.
3. Se a mensagem informa uma forma de pagamento reconhecível (as mesmas do
   schema de venda): monta `CreateSaleInput` com um item e um pagamento cujo
   `amountCents` é o preço da linha (qty 1). Segue o caminho já existente de
   proposta + `sim`/`não`.
4. Pagamento misto, desconto, quantidade &gt; 1 ou cliente a resolver por
   nome: não são montados nesta fatia a partir da foto. O assistente pede o
   restante por texto e o fluxo US-049 já entregue assume o turno seguinte.

**Rationale**: `createSaleInputSchema` exige `payments`. Confirmar uma venda
sem forma de pagamento seria inventar dinheiro. Copiar o preço de tabela do
`ProductOutput` respeita “o agente nunca calcula”. `registerSale` continua
sendo quem fecha totais, imposto e estoque. Não há tool `lookup_barcode`
exposta ao LLM: a foto não é intenção de linguagem.

**Alternatives considered**:

- Prefixo no texto e deixar o LLM chamar `create_sale`: rejeitado no FakeLlm
  (ignora histórico, mutação só por `script()`) e frágil no modelo real.
- Item avulso com a descrição do código: rejeitado pela US-068.
- Pular confirmação porque a foto “já é o bipo”: rejeitado pela constitution
  (criar valor exige confirmação) e pela US-050.

## 6. Contrato HTTP e Studio

**Decision**: `agentMessageInputSchema` passa a aceitar `text` e/ou `image`
(`mimeType` + `dataBase64`), com refine: pelo menos um dos dois. Teto de
tamanho da imagem no schema. A rota `POST /agent/messages` converte base64 em
bytes e **não** persiste a imagem. Studio reutiliza o mesmo schema na tool
`process_message`; a UI do Studio pode continuar só texto — o aceite da NR-116
é o harness HTTP. WhatsApp/Meta não entra.

**Rationale**: o contrato do harness já é o que o webhook futuro deve alimentar.
Guardar JPEG no histórico violaria FR-009 e incharia `messages`. O placeholder
textual (`[foto do codigo]` + código lido, se houver) basta para a janela da
NR-062. Produção do lojista continua 503.

**Alternatives considered**:

- Multipart/form-data: rejeitado nesta fatia; o harness é JSON e o schema
  Zod único serve HTTP e Studio.
- Exigir texto sempre: rejeitado; foto sozinha é o caso principal no balcão.
- Aceite só no Studio com visão: rejeitado; Studio não é canal do lojista e
  não precisa de UI de anexo para o DoD.

## 7. Isolamento, log e histórico

**Decision**: `companyId` só do `ExecutionContext`; teste com duas empresas e o
mesmo código. Bytes da imagem não entram em log, em `messages.body` nem em
proposta de confirmação. Recusa e cadastro são `mutatesValue: false` (não
criam pendência).

**Rationale**: constitution IV e RNF-034. `findProductByBarcode` já esconde
produto alheio como inexistente. Confirmação só existe no caminho `create_sale`.

**Alternatives considered**:

- Logar hash da imagem para debug: rejeitado nesta fatia; não é requisito e
  aproxima de dado que não devemos reter.
- Cobrir isolamento só com fake de produto: insuficiente para o repositório
  real, mas o caso de uso já tem teste de tenant em `core`; o agente prova
  que a recusa/venda usa esse resultado, não um catálogo próprio.
