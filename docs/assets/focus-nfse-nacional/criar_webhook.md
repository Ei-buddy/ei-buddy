---
updatedAt: 2026-05-18T12:22:55.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Criar

Cria um novo gatilho para receber notificações de eventos.

# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Webhooks",
    "version": "2.0.0",
    "contact": {
      "name": "Focus NFe Suporte",
      "email": "suporte@focusnfe.com.br"
    },
    "license": {
      "name": "Proprietary",
      "url": "https://focusnfe.com.br"
    }
  },
  "servers": [
    {
      "url": "https://api.focusnfe.com.br/v2",
      "description": "Servidor de Produção"
    },
    {
      "url": "https://homologacao.focusnfe.com.br/v2",
      "description": "Servidor de Homologação"
    }
  ],
  "security": [
    {
      "BasicAuth": []
    }
  ],
  "tags": [
    {
      "name": "Webhooks",
      "description": "Operações relacionadas a criação, consulta, exclusão e teste de gatilhos"
    }
  ],
  "paths": {
    "/hooks": {
      "post": {
        "tags": ["Webhooks"],
        "summary": "Criar",
        "description": "Cria um novo gatilho para receber notificações de eventos.\n",
        "operationId": "criar_webhook",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/HookCreateRequest"
              },
              "example": {
                "cnpj": "12345678000123",
                "event": "nfe",
                "url": "http://minha.url/nfe"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Gatilho criado com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Hook"
                },
                "example": {
                  "id": "Vj5rmkBq",
                  "url": "http://minha.url/nfe",
                  "authorization": null,
                  "authorization_header": null,
                  "event": "nfe",
                  "cnpj": "12345678000123"
                }
              }
            }
          },
          "400": {
            "description": "Requisição inválida",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          },
          "404": {
            "$ref": "#/components/responses/HookNaoEncontrado"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "BasicAuth": {
        "type": "http",
        "scheme": "basic",
        "description": "Autenticação com usuário e senha (HTTP Basic). O usuário é o token da API e a senha deve ser deixada em branco."
      }
    },
    "responses": {
      "HookNaoEncontrado": {
        "description": "Recurso não encontrado",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "nao_encontrado",
              "mensagem": "Gatilho não encontrado"
            }
          }
        }
      }
    },
    "schemas": {
      "Hook": {
        "title": "Gatilho",
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "url": {
            "type": "string",
            "format": "uri"
          },
          "authorization": {
            "type": "string",
            "nullable": true
          },
          "authorization_header": {
            "type": "string",
            "nullable": true
          },
          "event": {
            "type": "string",
            "description": "Evento monitorado",
            "enum": [
              "nfe",
              "nfse",
              "nfsen",
              "nfce_contingencia",
              "nfe_recebida",
              "nfe_recebida_falha_consulta",
              "nfsen_recebida",
              "cte_recebida",
              "inutilizacao",
              "cte",
              "mdfe",
              "nfcom",
              "nfce_consulta_automatica"
            ]
          },
          "cnpj": {
            "type": "string",
            "description": "CNPJ vinculado ao gatilho"
          },
          "cpf": {
            "type": "string",
            "description": "CPF vinculado ao gatilho"
          }
        },
        "example": {
          "id": "Vj5rmkBq",
          "url": "http://minha.url/nfe",
          "authorization": null,
          "authorization_header": null,
          "event": "nfe",
          "cnpj": "12345678000123"
        }
      },
      "HookCreateRequest": {
        "title": "Criação de gatilho",
        "type": "object",
        "properties": {
          "cnpj": {
            "type": "string",
            "description": "CNPJ da empresa"
          },
          "cpf": {
            "type": "string",
            "description": "CPF do prestador de serviço"
          },
          "event": {
            "type": "string",
            "description": "Evento a ser monitorado",
            "enum": [
              "nfe",
              "nfse",
              "nfsen",
              "nfce_contingencia",
              "nfe_recebida",
              "nfe_recebida_falha_consulta",
              "cte_recebida",
              "inutilizacao",
              "cte",
              "mdfe",
              "nfcom",
              "nfsen_recebida",
              "dce",
              "nfce_consulta_automatica"
            ]
          },
          "url": {
            "type": "string",
            "format": "uri",
            "description": "URL que receberá as notificações"
          },
          "authorization": {
            "type": "string",
            "description": "Valor a ser enviado no cabeçalho de autorização",
            "nullable": true
          },
          "authorization_header": {
            "type": "string",
            "description": "Nome do cabeçalho HTTP a ser utilizado para enviar o campo authorization",
            "nullable": true
          }
        },
        "required": ["event", "url"],
        "example": {
          "cnpj": "12345678000123",
          "event": "nfe",
          "url": "http://minha.url/nfe"
        }
      },
      "ErrorResponse": {
        "title": "Erro",
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string",
            "description": "Código do erro"
          },
          "mensagem": {
            "type": "string",
            "description": "Mensagem descritiva do erro"
          }
        }
      }
    }
  }
}
```
