---
updatedAt: 2026-04-08T19:36:29.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Ambiente

A API Focus NFe oferece **dois ambientes**: **homologação** e **produção**. A autenticação é a mesma nos dois; o que muda é a **URL base** e o **efeito fiscal** das operações.

## Homologação

O ambiente de **homologação** destina-se a **testes de integração** e emissões experimentais. Os documentos emitidos ali **não têm validade fiscal nem tributária**.

## Produção

O ambiente de **produção** é o que gera documentos com **validade fiscal e tributária**. **Por isso**, use-o somente quando estiver pronto para operar com notas válidas em nome dos seus clientes ou da sua empresa.

## Endereços dos servidores

| Ambiente    | URL base                              |
| ----------- | ------------------------------------- |
| Homologação | `https://homologacao.focusnfe.com.br` |
| Produção    | `https://api.focusnfe.com.br`         |

As rotas REST documentadas neste portal usam o prefixo **`/v2`**. Exemplo: `https://api.focusnfe.com.br/v2/nfe`.

## SSL / TLS

Confira na sua linguagem ou runtime se é preciso **alguma configuração extra** para HTTPS (versão mínima de TLS, trust store, etc.). Em alguns casos é necessário **confiar explicitamente** na cadeia da autoridade certificadora que emitiu o certificado do nosso servidor. Em **Java**, em especial, costuma ser preciso importar **toda a cadeia** (intermediárias e raiz) no truststore.

Para inspecionar e salvar os certificados apresentados pelo servidor de produção, você pode usar no Linux (ou macOS):

```bash
openssl s_client -showcerts -connect api.focusnfe.com.br:443
```

Copie cada bloco entre `-----BEGIN CERTIFICATE-----` e `-----END CERTIFICATE-----` para arquivos separados e importe-os na ferramenta ou keystore que sua aplicação utiliza. Para homologação, repita o comando apontando para `homologacao.focusnfe.com.br:443` se necessário.

Se algo falhar nesse processo, fale com o suporte em <suporte@focusnfe.com.br>.
