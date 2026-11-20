---
updatedAt: 2026-07-30T14:51:27.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Solicitar reenvio de notificação

Para efeitos de teste ou para recuperar notificações perdidas é possível solicitar à API o reenvio desta notificação para todos os gatilhos cadastrados.

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
    "/nfsen/{referencia}/hook": {
      "post": {
        "tags": ["NFSe Nacional"],
        "summary": "Solicitar reenvio de notificação",
        "description": "Para efeitos de teste ou para recuperar notificações perdidas é possível solicitar à API o reenvio desta notificação para todos os gatilhos cadastrados.",
        "operationId": "reenviar_hook_nfsen",
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
        "responses": {
          "200": {
            "description": "Lista de gatilhos acionados",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Hook"
                  }
                }
              }
            }
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
            "enum": ["nfsen"]
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
          "event": "nfsen",
          "cnpj": "12345678000123"
        }
      }
    }
  }
}
```
