---
updatedAt: 2026-06-10T12:42:39.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Consultar município por código IBGE

Busca um município pelo código IBGE de sete dígitos.

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
    "/municipios/{codigo_municipio}": {
      "get": {
        "tags": ["Municípios"],
        "summary": "Consultar município por código IBGE",
        "description": "Busca um município pelo código IBGE de sete dígitos.",
        "operationId": "consultar_municipio",
        "parameters": [
          {
            "$ref": "#/components/parameters/CodigoMunicipio"
          }
        ],
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Municipio"
                }
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
      "StatusNfseMunicipio": {
        "type": "string",
        "description": "Status operacional da NFSe no município",
        "enum": [
          "ativo",
          "fora_do_ar",
          "pausado",
          "em_implementacao",
          "em_reimplementacao",
          "inativo",
          "nao_implementado"
        ]
      },
      "Municipio": {
        "title": "Município",
        "type": "object",
        "description": "Município conforme base IBGE e metadados de NFSe na Focus NFe",
        "properties": {
          "codigo_municipio": {
            "type": "string",
            "description": "Código do município (IBGE)"
          },
          "nome_municipio": {
            "type": "string",
            "description": "Nome oficial do município (IBGE)"
          },
          "sigla_uf": {
            "type": "string",
            "description": "Sigla da UF"
          },
          "nome_uf": {
            "type": "string",
            "description": "Nome completo do estado"
          },
          "nfse_habilitada": {
            "type": "boolean",
            "description": "Indica se a NFSe está implementada para o município"
          },
          "requer_certificado_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Se exige certificado digital para emissão de NFSe"
          },
          "possui_ambiente_homologacao_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Se existe ambiente de homologação de NFSe"
          },
          "possui_cancelamento_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Se o cancelamento de NFSe é possível via API"
          },
          "provedor_nfse": {
            "type": "string",
            "nullable": true,
            "description": "Nome do provedor de NFSe"
          },
          "endereco_obrigatorio_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Obrigatoriedade de endereço na emissão (true/false/null = indefinido)"
          },
          "cpf_cnpj_obrigatorio_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Obrigatoriedade de CPF/CNPJ (true/false/null = indefinido)"
          },
          "codigo_cnae_obrigatorio_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Obrigatoriedade de código CNAE (true/false/null = indefinido)"
          },
          "item_lista_servico_obrigatorio_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Obrigatoriedade de item da lista de serviço"
          },
          "codigo_tributario_municipio_obrigatorio_nfse": {
            "type": "boolean",
            "nullable": true,
            "description": "Obrigatoriedade de código tributário municipal"
          },
          "status_nfse": {
            "$ref": "#/components/schemas/StatusNfseMunicipio"
          },
          "data_previsao_reimplementacao_nfse": {
            "type": "string",
            "format": "date",
            "nullable": true,
            "description": "Data prevista de reimplementação (YYYY-MM-DD); null se não houver"
          },
          "ultima_emissao_nfse": {
            "type": "string",
            "format": "date-time",
            "nullable": true,
            "description": "Data/hora da última emissão de NFSe via API (ISO 8601)"
          }
        }
      }
    }
  }
}
```
