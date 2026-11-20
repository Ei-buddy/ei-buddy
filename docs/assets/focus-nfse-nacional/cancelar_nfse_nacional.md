---
updatedAt: 2026-07-30T14:51:27.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Cancelar

Apenas notas com status "autorizado" podem ser canceladas. O cancelamento é definitivo e não pode ser desfeito.
Este endpoint possui retorno **síncrono**. Como resposta você poderá receber os campos descritos abaixo. Os exemplos de resposta mostram os campos retornados de acordo com o status da nota.

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
    "/nfsen/{referencia}": {
      "delete": {
        "tags": ["NFSe Nacional"],
        "summary": "Cancelar",
        "description": "Apenas notas com status \"autorizado\" podem ser canceladas. O cancelamento é definitivo e não pode ser desfeito.\nEste endpoint possui retorno **síncrono**. Como resposta você poderá receber os campos descritos abaixo. Os exemplos de resposta mostram os campos retornados de acordo com o status da nota.\n",
        "operationId": "cancelar_nfse_nacional",
        "parameters": [
          {
            "name": "referencia",
            "in": "path",
            "required": true,
            "description": "Referência da NFSe a ser cancelada",
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "justificativa": {
                    "type": "string",
                    "description": "Justificativa do cancelamento (necessária se o código de cancelamento for 4)."
                  }
                }
              },
              "example": {
                "justificativa": "Emissão em duplicidade"
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
                  "oneOf": [
                    {
                      "$ref": "#/components/schemas/CancelamentoResponse"
                    },
                    {
                      "$ref": "#/components/schemas/ErroCancelamentoResponse"
                    }
                  ]
                },
                "examples": {
                  "Cancelada": {
                    "value": {
                      "status": "cancelado"
                    }
                  },
                  "Erro cancelamento": {
                    "value": {
                      "status": "erro_cancelamento",
                      "erros": [
                        {
                          "codigo": "V999",
                          "mensagem": "NFSe fora do prazo de cancelamento permitido",
                          "correcao": null
                        }
                      ]
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
      "CancelamentoResponse": {
        "title": "Cancelada",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status da NFSe",
            "enum": ["cancelado"]
          }
        }
      },
      "ErroCancelamentoResponse": {
        "title": "Erro cancelamento",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status da NFSe",
            "enum": ["erro_cancelamento"]
          },
          "erros": {
            "type": "array",
            "description": "Lista de erros",
            "items": {
              "$ref": "#/components/schemas/ArrayErrorResponse"
            }
          }
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
      },
      "ArrayErrorResponse": {
        "title": "Lista de erros",
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string",
            "description": "Código do erro"
          },
          "mensagem": {
            "type": "string",
            "description": "Mensagem do erro"
          },
          "correcao": {
            "type": "string",
            "description": "Correção do erro"
          }
        }
      }
    }
  }
}
```
