---
updatedAt: 2026-07-30T14:51:27.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Consultar

Após enviar uma nota, você poderá usar a operação de consulta para verificar se a nota está em processamento ou se já foi processada.

Como retorno você receberá os campos descritos nos exemplos abaixo, de acordo com o status da nota.

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
      "get": {
        "tags": ["NFSe Nacional"],
        "summary": "Consultar",
        "description": "Após enviar uma nota, você poderá usar a operação de consulta para verificar se a nota está em processamento ou se já foi processada.\n\nComo retorno você receberá os campos descritos nos exemplos abaixo, de acordo com o status da nota.\n",
        "operationId": "consultar_nfse_nacional",
        "parameters": [
          {
            "name": "referencia",
            "in": "path",
            "required": true,
            "description": "Referência do DPS/NFSe",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    {
                      "$ref": "#/components/schemas/ProcessandoAutorizacaoResponse"
                    },
                    {
                      "$ref": "#/components/schemas/AutorizadaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/CanceladaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/ErroAutorizacaoResponse"
                    }
                  ]
                },
                "examples": {
                  "Processando autorização": {
                    "$ref": "#/components/examples/ProcessandoAutorizacaoResponse"
                  },
                  "Autorizada": {
                    "$ref": "#/components/examples/AutorizadaResponse"
                  },
                  "Cancelada": {
                    "$ref": "#/components/examples/CanceladaResponse"
                  },
                  "Erro autorização": {
                    "$ref": "#/components/examples/ErroAutorizacaoResponse"
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
      "AutorizadaResponse": {
        "title": "Autorizada",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status atual da NFSe.",
            "enum": ["autorizado", "negado", "cancelado", "erro_autorizacao"]
          },
          "cnpj_prestador": {
            "type": "string",
            "description": "O CNPJ emitente da nota fiscal ."
          },
          "ref": {
            "type": "string",
            "description": "Referência da NFSe Nacional."
          },
          "numero_rps": {
            "type": "string",
            "description": "Número do RPS de controle do Ambiente Nacional."
          },
          "serie_rps": {
            "type": "string",
            "description": "A série do RPS de controle do Ambiente Nacional."
          },
          "tipo_rps": {
            "type": "string",
            "description": "O tipo do RPS."
          },
          "numero": {
            "type": "string",
            "description": "Número da NFSe Nacional."
          },
          "codigo_verificacao": {
            "type": "string",
            "description": "Código de verificação para consulta da NFSe Nacional, pode ser usado no portal do Ambiente Nacional para consulta."
          },
          "data_emissao": {
            "type": "string",
            "description": "Data da emissão da nota fiscal."
          },
          "url": {
            "type": "string",
            "format": "uri",
            "description": "URL para a consulta da nota fiscal no portal do Ambiente Nacional."
          },
          "url_danfse": {
            "type": "string",
            "format": "uri",
            "description": "URL para acesso e download do DANFSe (versão PDF)."
          },
          "caminho_xml_nota_fiscal": {
            "type": "string",
            "description": "Caminho para acesso e download do XML da nota fiscal."
          }
        }
      },
      "CanceladaResponse": {
        "title": "Cancelada",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status atual da NFSe.",
            "enum": ["cancelado"]
          },
          "cnpj_prestador": {
            "type": "string",
            "description": "O CNPJ emitente da nota fiscal ."
          },
          "ref": {
            "type": "string",
            "description": "Referência da NFSe Nacional."
          },
          "numero_rps": {
            "type": "string",
            "description": "Número do RPS de controle do Ambiente Nacional."
          },
          "serie_rps": {
            "type": "string",
            "description": "A série do RPS de controle do Ambiente Nacional."
          },
          "tipo_rps": {
            "type": "string",
            "description": "O tipo do RPS."
          },
          "numero": {
            "type": "string",
            "description": "Número da NFSe Nacional."
          },
          "codigo_verificacao": {
            "type": "string",
            "description": "Código de verificação para consulta da NFSe Nacional, pode ser usado no portal do Ambiente Nacional para consulta."
          },
          "data_emissao": {
            "type": "string",
            "description": "Data da emissão da nota fiscal."
          },
          "url": {
            "type": "string",
            "format": "uri",
            "description": "URL para a consulta da nota fiscal no portal do Ambiente Nacional."
          },
          "url_danfse": {
            "type": "string",
            "format": "uri",
            "description": "URL para acesso e download do DANFSe (versão PDF)."
          },
          "caminho_xml_nota_fiscal": {
            "type": "string",
            "description": "Caminho para acesso e download do XML da nota fiscal."
          }
        }
      },
      "ErroAutorizacaoResponse": {
        "title": "Erro autorização",
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "description": "Status atual da NFSe.",
            "enum": ["erro_autorizacao"]
          },
          "cnpj_prestador": {
            "type": "string",
            "description": "O CNPJ emitente da nota fiscal ."
          },
          "ref": {
            "type": "string",
            "description": "Referência da NFSe Nacional."
          },
          "numero_rps": {
            "type": "string",
            "description": "Número do RPS de controle do Ambiente Nacional."
          },
          "serie_rps": {
            "type": "string",
            "description": "A série do RPS de controle do Ambiente Nacional."
          },
          "tipo_rps": {
            "type": "string",
            "description": "O tipo do RPS."
          },
          "erros": {
            "type": "array",
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
    },
    "examples": {
      "ProcessandoAutorizacaoResponse": {
        "value": {
          "cnpj_prestador": "12345678000123",
          "ref": "123456",
          "status": "processando_autorizacao"
        }
      },
      "AutorizadaResponse": {
        "value": {
          "cnpj_prestador": "12345678000123",
          "ref": "TRANSACTION=742130=1=0=092467d0-e275-4ff2-b633-3510643cfd03",
          "numero_rps": "73895",
          "serie_rps": "1",
          "tipo_rps": "1",
          "status": "autorizado",
          "numero": "74798",
          "codigo_verificacao": "ABC123",
          "data_emissao": "2026-03-30T11:25:14-03:00",
          "url": "https://www.nfse.gov.br/consultapublica/?tpc=1&chave=42054072212345678000123000000007479826039913594189",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123_1/202603/XMLsNFSe/NFS42054072212345678000123000000007479826039913594189-nfse.xml",
          "url_danfse": "https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/12345678000123_1/202603/DANFSEs/NFS42054072212345678000123000000007479826039913594189.pdf"
        }
      },
      "CanceladaResponse": {
        "value": {
          "cnpj_prestador": "12345678000123",
          "ref": "123456",
          "numero_rps": "1",
          "serie_rps": "1",
          "tipo_rps": "1",
          "status": "cancelado",
          "numero": "1",
          "codigo_verificacao": "ABC123",
          "data_emissao": "2025-01-01T10:00:00-03:00",
          "url": "https://www.nfse.gov.br/consultapublica/?tpc=1&chave=21113002212345678000123000000000003026031025747746",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123_1/202603/XMLsNFSe/NFS21113002212345678000123000000000003026031025747746-nfse.xml",
          "caminho_xml_cancelamento": "/arquivos/12345678000123_1/202603/XMLsNFSe/NFS21113002212345678000123000000000003026031025747746-can.xml",
          "url_danfse": "https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/12345678000123_1/202603/DANFSEs/NFS21113002212345678000123000000000003026031025747746.pdf"
        }
      },
      "ErroAutorizacaoResponse": {
        "value": {
          "status": "erro_autorizacao",
          "cnpj_prestador": "12345678000123",
          "ref": "12345",
          "numero_rps": 1,
          "serie_rps": 1,
          "tipo_rps": 1,
          "erros": [
            {
              "codigo": "E0014",
              "mensagem": "Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente."
            }
          ]
        }
      }
    }
  }
}
```
