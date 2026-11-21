---
updatedAt: 2026-07-30T12:42:45.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Autenticação

Todas as chamadas à API Focus NFe exigem **autenticação HTTP Basic** (RFC 7617). Não há cabeçalho de API key separado: o **token da empresa** é enviado como **usuário** do Basic Auth e a **senha fica em branco**.

## Como funciona

1. O cliente monta o par **usuário** = token alfanumérico gerado no cadastro da empresa (painel Focus NFe).
2. A **senha** do Basic deve ser **vazia** (string vazia, não omita o esquema Basic).
3. O cabeçalho `Authorization` enviado pelo cliente é equivalente a `Basic` + Base64(`token:`) — note os dois pontos e nada depois deles.

O mesmo esquema vale para **homologação** e **produção**; muda apenas a URL base do servidor e o token.

## Exemplo com cURL

```bash
curl -u 'SEU_TOKEN_AQUI:' \
  https://api.focusnfe.com.br/v2/empresas
```

O caractere após os dois pontos é intencional: senha vazia. Sem aspas, alguns shells podem exigir escapar caracteres especiais do token.
