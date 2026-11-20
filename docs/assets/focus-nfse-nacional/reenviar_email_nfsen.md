---
updatedAt: 2026-07-30T14:51:27.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Reenviar email

É possível enviar a nota para um email diferente do que foi informado nos dados de emissão.

A confirmação do recebimento desta solicitação é retornada de forma **síncrona**. Contudo, os emails são enviados em segundo plano, podendo levar alguns minutos até que cheguem ao destinatário.

Veja abaixo os campos que podem ser enviados na requisição.

# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "NFSe Nacional",
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
      "name": "NFSe Nacional",
      "description": "Operações relacionadas a Notas Fiscais de Serviços Eletrônicas (NFSe) no Padrão Nacional."
    }
  ],
  "paths": {
    "/nfsen/{referencia}/email": {
      "post": {
        "tags": ["NFSe Nacional"],
        "summary": "Reenviar email",
        "description": "É possível enviar a nota para um email diferente do que foi informado nos dados de emissão.\n\nA confirmação do recebimento desta solicitação é retornada de forma **síncrona**. Contudo, os emails são enviados em segundo plano, podendo levar alguns minutos até que cheguem ao destinatário.\n\nVeja abaixo os campos que podem ser enviados na requisição.\n",
        "operationId": "reenviar_email_nfsen",
        "parameters": [
          {
            "name": "referencia",
            "in": "path",
            "required": true,
            "description": "Referência da NFSe Nacional",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["emails"],
                "properties": {
                  "emails": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "email"
                    },
                    "description": "Array com uma lista de emails que deverão receber uma cópia da nota. Limitado a 10 emails por vez."
                  }
                }
              },
              "example": {
                "emails": ["nome@example.org", "nome2@example.org"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "emails": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "format": "email"
                      },
                      "example": ["nome@example.org", "nome2@example.org"]
                    }
                  }
                }
              }
            }
          },
          "404": {
            "$ref": "#/components/responses/NaoEncontrada"
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
      "NaoEncontrada": {
        "description": "Recurso não encontrado",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "nao_encontrado",
              "mensagem": "Nota fiscal não encontrada"
            }
          }
        }
      }
    },
    "schemas": {
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
