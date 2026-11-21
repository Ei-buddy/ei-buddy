---
updatedAt: 2026-10-22T20:45:44.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Emitir

Quando uma NFS-e é enviada para processamento, é realizada uma pré-validação, caso ocorra algum problema como: ausência de campos essenciais, formato de dados incorreto ou problemas com o cadastro do prestador em nossa base, a nota não será aceita e você receberá uma mensagem de erro de forma **síncrona**.

Caso a nota seja aceita para processamento, ela será enviada para uma fila e será processada de forma **assíncrona**. Com isto, a nota poderá ser autorizada ou retornar um erro, de acordo com a validação do ambiente nacional.

Para verificar se a nota já foi autorizada, você terá que efetuar uma [consulta](/reference/consultar_nfse_nacional) ou se utilizar de webhooks (gatilhos).

Abaixo você poderá verificar uma listagem dos **principais** campos disponíveis.

[Documentação completa dos campos da NFSe Nacional em produção](https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html)

Se você desejar emitir em homologação, veja a documentação completa dos campos [aqui](https://campos.focusnfe.com.br/nfse_nacional_homologacao/EmissaoDPSXml.html).

<br />

<br />

<br />

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
    "/nfsen": {
      "post": {
        "tags": ["NFSe Nacional"],
        "summary": "Emitir",
        "description": "Quando uma NFS-e é enviada para processamento, é realizada uma pré-validação, caso ocorra algum problema como: ausência de campos essenciais, formato de dados incorreto ou problemas com o cadastro do prestador em nossa base, a nota não será aceita e você receberá uma mensagem de erro de forma **síncrona**.\n\nCaso a nota seja aceita para processamento, ela será enviada para uma fila e será processada de forma **assíncrona**. Com isto, a nota poderá ser autorizada ou retornar um erro, de acordo com a validação do ambiente nacional.\n\nPara verificar se a nota já foi autorizada, você terá que efetuar uma [consulta](/reference/consultar_nfse_nacional) ou se utilizar de webhooks (gatilhos).\n\nAbaixo você poderá verificar uma listagem dos **principais** campos disponíveis.\n\n[Documentação completa dos campos da NFSe Nacional em produção](https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html)\n\nSe você desejar emitir em homologação, veja a documentação completa dos campos  [aqui](https://campos.focusnfe.com.br/nfse_nacional_homologacao/EmissaoDPSXml.html).\n",
        "operationId": "emitir_dps_nacional",
        "parameters": [
          {
            "name": "ref",
            "in": "query",
            "required": true,
            "description": "Referência única para o DPS/NFSe",
            "schema": {
              "type": "string",
              "example": "ref_dps_001"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/NFSeNacionalRequest"
              },
              "examples": {
                "NFSe Nacional": {
                  "$ref": "#/components/examples/NFSeNacionalRequest"
                }
              }
            }
          }
        },
        "responses": {
          "202": {
            "description": "Requisição aceita para processamento",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ProcessandoAutorizacaoResponse"
                },
                "examples": {
                  "Processando autorização": {
                    "$ref": "#/components/examples/ProcessandoAutorizacaoResponse"
                  }
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
                },
                "examples": {
                  "Requisição inválida": {
                    "value": {
                      "codigo": "requisicao_invalida",
                      "mensagem": "O campo dfe.prestador.cpf_cnpj é obrigatório."
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/AccessDenied"
          },
          "422": {
            "description": "O servidor entendeu a requisição, mas os dados são inválidos ou não podem ser processados.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                },
                "examples": {
                  "Erro validação": {
                    "value": {
                      "codigo": "erro_validacao",
                      "mensagem": "Já existe um DPS com esta referência."
                    }
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
      "NFSeNacionalRequest": {
        "title": "Campos de envio",
        "type": "object",
        "properties": {
          "data_emissao": {
            "type": "string",
            "format": "date-time",
            "description": "Data e hora da emissão da DPS."
          },
          "serie_dps": {
            "type": "integer",
            "description": "Série da DPS."
          },
          "numero_dps": {
            "type": "integer",
            "description": "Número da DPS."
          },
          "data_competencia": {
            "type": "string",
            "format": "date",
            "description": "Data de competência da prestação do serviço."
          },
          "emitente_dps": {
            "type": "string",
            "description": "Emitente da DPS."
          },
          "codigo_municipio_emissora": {
            "type": "integer",
            "description": "Código IBGE de 7 dígitos da localidade emissora da NFS-e."
          },
          "cnpj_prestador": {
            "type": "string",
            "description": "Número da inscrição federal (CNPJ) do prestador do serviço."
          },
          "nif_prestador": {
            "type": "string",
            "description": "Número de Identificação Fiscal fornecido por órgão de administração tributária no exterior."
          },
          "codigo_opcao_simples_nacional": {
            "type": "string",
            "description": "Situação perante Simples Nacional."
          },
          "regime_especial_tributacao": {
            "type": "string",
            "description": "Regime Especial de Tributação Municipal."
          },
          "cnpj_tomador": {
            "type": "string",
            "description": "Número da inscrição federal (CNPJ) do tomador do serviço."
          },
          "cpf_tomador": {
            "type": "string",
            "description": "Número da inscrição federal (CPF) do tomador do serviço."
          },
          "nif_tomador": {
            "type": "string",
            "description": "Número de Identificação Fiscal fornecido por órgão de administração tributária no exterior."
          },
          "motivo_ausencia_nif_tomador": {
            "type": "string",
            "description": "Motivo para não informação do NIF."
          },
          "codigo_municipio_prestacao": {
            "type": "string",
            "description": "Código IBGE de 7 dígitos da localidade da prestação do serviço."
          },
          "codigo_tributacao_nacional_iss": {
            "type": "string",
            "description": "Código de tributação nacional do ISSQN."
          },
          "descricao_servico": {
            "type": "string",
            "description": "Descrição completa do serviço prestado."
          },
          "valor_servico": {
            "type": "number",
            "description": "Valor monetário do serviço (R$)."
          },
          "tributacao_iss": {
            "type": "number",
            "description": "Tributação do ISSQN sobre o serviço prestado."
          }
        }
      },
      "ProcessandoAutorizacaoResponse": {
        "title": "Processando autorização",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status do processamento.",
            "example": "processando_autorizacao"
          },
          "ref": {
            "type": "string",
            "description": "Referência do DPS."
          },
          "protocolo": {
            "type": "string",
            "description": "Protocolo de recebimento do DPS."
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
      }
    },
    "examples": {
      "ProcessandoAutorizacaoResponse": {
        "value": {
          "cnpj_prestador": "12345678000123",
          "ref": "123456",
          "status": "processando_autorizacao"
        }
      },
      "NFSeNacionalRequest": {
        "value": {
          "data_emissao": "2025-01-01T07:30:00-0300",
          "serie_dps": 1,
          "numero_dps": 1,
          "data_competencia": "2025-01-01",
          "emitente_dps": 1,
          "codigo_municipio_emissora": 4106902,
          "cnpj_prestador": "12345678000123",
          "nif_prestador": "123456789",
          "codigo_opcao_simples_nacional": 1,
          "regime_especial_tributacao": 0,
          "cnpj_tomador": "12345678000123",
          "cpf_tomador": "12345678000123",
          "nif_tomador": "1234567890",
          "codigo_municipio_prestacao": 4106902,
          "codigo_tributacao_nacional_iss": "010701",
          "descricao_servico": "Nota emitida em caráter de TESTE",
          "valor_servico": 1,
          "tributacao_iss": 1
        }
      }
    }
  }
}
```
