---
updatedAt: 2026-06-10T12:42:39.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Listar códigos tributários municipais

Retorna códigos tributários do município, com filtros opcionais. O **formato dos códigos** retornados depende do padrão que cada município utiliza: alguns seguem o padrão de **item da lista de serviço**, outros o de **código CNAE**, e há municípios com **padrão próprio**.

# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Municípios",
    "description": "API de consulta à base de municípios do IBGE utilizada pela Focus NFe. Permite localizar municípios por nome ou UF, obter o código IBGE, verificar integração e regras de NFSe (provedor, obrigatoriedade de CNAE, item da lista de serviço, código tributário municipal, etc.) e consultar itens da lista de serviço e códigos tributários vinculados a um município.\n\nNovos campos podem ser adicionados à API sem aviso prévio; clientes devem tolerar propriedades desconhecidas.\n",
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
      "name": "Municípios",
      "description": "Consulta de municípios IBGE, regras de NFSe e tabelas auxiliares por município"
    }
  ],
  "paths": {
    "/municipios/{codigo_municipio}/codigos_tributarios_municipio": {
      "get": {
        "tags": ["Municípios"],
        "summary": "Listar códigos tributários municipais",
        "description": "Retorna códigos tributários do município, com filtros opcionais. O **formato dos códigos** retornados depende do padrão que cada município utiliza: alguns seguem o padrão de **item da lista de serviço**, outros o de **código CNAE**, e há municípios com **padrão próprio**.\n",
        "operationId": "listar_codigos_tributarios_municipio",
        "parameters": [
          {
            "$ref": "#/components/parameters/CodigoMunicipio"
          },
          {
            "name": "codigo",
            "in": "query",
            "description": "Trecho do código tributário municipal",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "descricao",
            "in": "query",
            "description": "Trecho da descrição",
            "schema": {
              "type": "string"
            }
          },
          {
            "$ref": "#/components/parameters/OffsetPaginacao"
          },
          {
            "name": "limit",
            "in": "query",
            "description": "Quantidade máxima de códigos tributários por página (padrão **50**). Use com **offset** para paginar.\n",
            "schema": {
              "type": "integer",
              "default": 50
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "headers": {
              "X-Total-Count": {
                "description": "Número total de ocorrências da pesquisa",
                "schema": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/CodigoTributarioMunicipio"
                  }
                },
                "example": [
                  {
                    "codigo": "1.06",
                    "descricao": "Assessoria e consultoria em informática."
                  },
                  {
                    "codigo": "1.07",
                    "descricao": "Suporte técnico em informática, inclusive instalação, configuração e manutenção de programas de computação e bancos de dados.\n"
                  }
                ]
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/AccessDenied"
          },
          "404": {
            "description": "Recurso não encontrado",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "example": {
                  "codigo": "nao_encontrado",
                  "mensagem": "Município não encontrado"
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
    "parameters": {
      "CodigoMunicipio": {
        "name": "codigo_municipio",
        "in": "path",
        "required": true,
        "description": "Código IBGE do município (7 dígitos)",
        "schema": {
          "type": "string",
          "pattern": "^[0-9]{7}$"
        },
        "example": "4307807"
      },
      "OffsetPaginacao": {
        "name": "offset",
        "in": "query",
        "description": "Deslocamento para paginação. A API retorna até 100 registros por requisição (0 = primeiros 100, 100 = registros 101–200, etc.).\n",
        "schema": {
          "type": "integer",
          "minimum": 0,
          "default": 0
        }
      }
    },
    "responses": {
      "AccessDenied": {
        "description": "Não autorizado",
        "content": {
          "text/html": {
            "schema": {
              "type": "string",
              "example": "HTTP Basic: Access denied"
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
      },
      "CodigoTributarioMunicipio": {
        "title": "Código tributário municipal",
        "type": "object",
        "description": "Código tributário municipal vinculado ao município.",
        "properties": {
          "codigo": {
            "type": "string"
          },
          "descricao": {
            "type": "string"
          }
        },
        "additionalProperties": true
      }
    }
  }
}
```
