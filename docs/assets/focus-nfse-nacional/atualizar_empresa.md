---
updatedAt: 2026-07-06T19:38:50.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Atualizar

Altera os dados de uma empresa. Utilize `dry_run=1` para simular a alteração sem efetivar no banco de dados.

# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Empresas",
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
    }
  ],
  "security": [
    {
      "BasicAuth": []
    }
  ],
  "tags": [
    {
      "name": "Empresas",
      "description": "Operações relacionadas à gestão de empresas"
    }
  ],
  "paths": {
    "/empresas/{id}": {
      "put": {
        "tags": ["Empresas"],
        "summary": "Atualizar",
        "description": "Altera os dados de uma empresa. Utilize `dry_run=1` para simular a alteração sem efetivar no banco de dados.\n",
        "operationId": "atualizar_empresa",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "description": "Identificador único da empresa",
            "schema": {
              "type": "string",
              "example": "123"
            }
          },
          {
            "name": "dry_run",
            "in": "query",
            "required": false,
            "description": "Simula a alteração da empresa sem persistir os dados",
            "schema": {
              "type": "integer",
              "enum": [1],
              "example": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/EmpresaCreate"
              },
              "example": {
                "nome": "Nome da empresa Ltda",
                "nome_fantasia": "Nome Fantasia",
                "bairro": "Vila Isabel",
                "cep": 80210000,
                "cnpj": "12345678000123",
                "complemento": "Loja 1",
                "discrimina_impostos": true,
                "email": "test@example.com",
                "enviar_email_destinatario": true,
                "inscricao_estadual": 1234,
                "inscricao_municipal": 46532,
                "logradouro": "Rua João da Silva",
                "numero": "153",
                "regime_tributario": 1,
                "telefone": "4130333333",
                "municipio": "Curitiba",
                "uf": "PR"
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
                  "$ref": "#/components/schemas/EmpresaResponse"
                },
                "examples": {
                  "Empresa atualizada com sucesso": {
                    "$ref": "#/components/examples/EmpresaResponse"
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ParametrosInvalidos"
          },
          "401": {
            "$ref": "#/components/responses/AccessDenied"
          },
          "404": {
            "$ref": "#/components/responses/EmpresaNaoEncontrada"
          },
          "422": {
            "description": "O servidor entendeu a requisição, mas os dados são inválidos ou não podem ser processados",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ValidationErrorResponse"
                },
                "example": {
                  "codigo": "erro_validacao",
                  "mensagem": "Erro de validação",
                  "erros": [
                    {
                      "codigo": "erro_validacao",
                      "mensagem": "Arquivo certificado base64 Certificado não pertence ao CNPJ informado",
                      "campo": "arquivo_certificado_base64"
                    }
                  ]
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
              "type": "string"
            },
            "example": "HTTP Basic: Access denied"
          }
        }
      },
      "EmpresaNaoEncontrada": {
        "description": "Recurso não encontrado",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "nao_encontrado",
              "mensagem": "Empresa não encontrada"
            }
          }
        }
      },
      "ParametrosInvalidos": {
        "description": "Requisição inválida",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "erros": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/ErrorResponse"
                  }
                }
              }
            },
            "example": {
              "erros": [
                {
                  "codigo": "parametros_invalidos",
                  "mensagem": "Existe um problema no JSON recebido: 822: unexpected token at 'empresa_id=12079'"
                }
              ]
            }
          }
        }
      }
    },
    "schemas": {
      "EmpresaCreate": {
        "title": "Dados de criação/atualização",
        "type": "object",
        "properties": {
          "nome": {
            "type": "string",
            "description": "Razão social da empresa"
          },
          "nome_fantasia": {
            "type": "string",
            "description": "Nome fantasia"
          },
          "cnpj": {
            "type": "string"
          },
          "cpf": {
            "type": "string"
          },
          "inscricao_estadual": {
            "type": "integer",
            "description": "Inscrição estadual"
          },
          "inscricao_municipal": {
            "type": "integer",
            "description": "Inscrição municipal"
          },
          "regime_tributario": {
            "type": "integer",
            "description": "Regime tributário. Valores possíveis:\n1 - Simples Nacional\n2 - Simples Nacional - Excesso de sublimite de receita bruta\n3 - Regime Normal\n4 - Simples Nacional - MEI\n"
          },
          "logradouro": {
            "type": "string",
            "description": "Logradouro do endereço"
          },
          "numero": {
            "type": "string",
            "maxLength": 60,
            "description": "Número do endereço. Aceita texto, ex.: \"SN\" (sem número)."
          },
          "complemento": {
            "type": "string",
            "description": "Complemento do endereço"
          },
          "municipio": {
            "type": "string",
            "description": "Município do endereço"
          },
          "bairro": {
            "type": "string",
            "description": "Bairro do endereço"
          },
          "cep": {
            "type": "integer",
            "description": "CEP do endereço"
          },
          "uf": {
            "type": "string",
            "description": "UF do endereço"
          },
          "telefone": {
            "type": "string",
            "description": "Telefone da empresa"
          },
          "email": {
            "type": "string",
            "format": "email",
            "description": "Email de contato da empresa"
          },
          "enviar_email_destinatario": {
            "type": "boolean",
            "description": "Habilita envio de e-mail ao destinatário/tomador após emissão (produção)"
          },
          "discrimina_impostos": {
            "type": "boolean",
            "description": "Habilita o cálculo automático de impostos totais aproximados (Lei da Transparência). Não utilizado para NFSe."
          },
          "habilita_nfe": {
            "type": "boolean",
            "description": "Habilita emissão de NFe (modelo 55)"
          },
          "habilita_nfce": {
            "type": "boolean",
            "description": "Habilita emissão de NFCe (modelo 65)"
          },
          "habilita_nfse": {
            "type": "boolean",
            "description": "Habilita emissão de NFSe (Nota Fiscal de Serviço Eletrônica). Não pode estar habilitado simultaneamente com NFSe Nacional em produção (habilita_nfsen_producao)."
          },
          "habilita_nfsen_producao": {
            "type": "boolean",
            "description": "Habilita emissão de NFSe Nacional em produção. Não pode estar habilitado simultaneamente com NFSe (habilita_nfse)."
          },
          "habilita_nfsen_homologacao": {
            "type": "boolean",
            "description": "Habilita emissão de NFSe Nacional em homologação"
          },
          "habilita_cte": {
            "type": "boolean",
            "description": "Habilita emissão de CTe/CTeOS (Conhecimento de Transporte)"
          },
          "habilita_mdfe": {
            "type": "boolean",
            "description": "Habilita emissão de MDFe (Manifesto Eletrônico de Documentos Fiscais)"
          },
          "habilita_manifestacao": {
            "type": "boolean",
            "description": "Habilita busca de NFe recebidas para manifestação do destinatário (MDe)"
          },
          "habilita_manifestacao_cte": {
            "type": "boolean",
            "description": "Habilita busca de CTes recebidas"
          },
          "habilita_nfsen_recebidas_producao": {
            "type": "boolean",
            "description": "Informa se empresa será habilitada para consulta de NFSe Nacional recebidas em ambiente de produção. Requer certificado digital com CNPJ idêntico ao da empresa."
          },
          "habilita_nfsen_recebidas_homologacao": {
            "type": "boolean",
            "description": "Informa se empresa será habilitada para consulta de NFSe Nacional recebidas em ambiente de homologação. Requer certificado digital com CNPJ idêntico ao da empresa."
          },
          "habilita_contingencia_offline_nfce": {
            "type": "boolean",
            "description": "Habilita contingência offline de NFCe"
          },
          "reaproveita_numero_nfce_contingencia": {
            "type": "boolean",
            "description": "Reaproveita número de NFCe emitido em contingência"
          },
          "habilita_consulta_automatica_nfce": {
            "type": "boolean",
            "description": "Habilita a consulta automática da NFC-e em caso de erro no envio. A consulta automática será criada somente quando a contingência offline não estiver habilitada."
          },
          "mostrar_danfse_badge": {
            "type": "boolean",
            "description": "Define exibição de distintivo (badge) da Focus na DANFSe. Se verdadeiro, badge é exibido; se falso, emissão white label."
          },
          "orientacao_danfe": {
            "type": "string",
            "enum": ["portrait", "landscape", "simplified"],
            "description": "Orientação da DANFe. Valores possíveis: portrait (retrato), simplified (Simplificado Tipo 2) ou landscape (paisagem)."
          },
          "recibo_danfe": {
            "type": "boolean",
            "description": "Exibe recibo na DANFe"
          },
          "exibe_sempre_ipi_danfe": {
            "type": "boolean",
            "description": "Imprime sempre colunas do IPI na DANFe"
          },
          "exibe_issqn_danfe": {
            "type": "boolean",
            "description": "Mostra dados do ISSQN na DANFe"
          },
          "exibe_impostos_adicionais_danfe": {
            "type": "boolean",
            "description": "Imprime impostos adicionais na DANFe (II, PIS, COFINS, ICMS UF Destino, ICMS UF Remetente, valor total de tributos)"
          },
          "exibe_rastro_danfe": {
            "type": "boolean",
            "description": "Exibe dados de rastreabilidade na DANFe"
          },
          "exibe_unidade_tributaria_danfe": {
            "type": "boolean",
            "description": "Exibe unidade tributária na DANFe"
          },
          "exibe_sempre_volumes_danfe": {
            "type": "boolean",
            "description": "Mostra sempre volumes na DANFe"
          },
          "exibe_composicao_carga_mdfe": {
            "type": "boolean",
            "description": "Mostra composição da carga na MDFe"
          },
          "exibe_itens_danfe_etiqueta": {
            "type": "boolean",
            "description": "Exibe os itens na DANFe Etiqueta"
          },
          "exibe_valores_danfe_etiqueta": {
            "type": "boolean",
            "description": "Exibe os valores na DANFe Etiqueta"
          },
          "enviar_email_homologacao": {
            "type": "boolean",
            "description": "Habilita envio de e-mail ao destinatário em homologação"
          },
          "cpf_cnpj_contabilidade": {
            "type": "string",
            "description": "CPF/CNPJ da contabilidade da empresa. Alguns estados exigem esta informação (ex.: BA)."
          },
          "arquivo_certificado_base64": {
            "type": "string",
            "description": "Arquivo PFX/P12 em base64"
          },
          "senha_certificado": {
            "type": "string",
            "description": "Senha do certificado digital. Obrigatória apenas se informado arquivo_certificado_base64."
          },
          "certificado_especifico": {
            "type": "boolean",
            "description": "Informa se a atualização de certificado é exclusiva para esta empresa.  Se não informado ou false, atualização de certificado é propagada para todas empresas com o mesmo CNPJ base  (matriz e filiais), exceto as que já possuam este campo definido como true."
          },
          "arquivo_logo_base64": {
            "type": "string",
            "description": "Logomarca da empresa para DANFE. Utilize PNG até 200x200 pixels. Nem todas as prefeituras aceitam."
          },
          "delete_logo": {
            "type": "boolean",
            "description": "Quando verdadeiro, remove a logo existente da empresa"
          },
          "nome_responsavel": {
            "type": "string",
            "description": "Nome do responsável pela empresa"
          },
          "cpf_responsavel": {
            "type": "string",
            "description": "CPF do responsável pela empresa"
          },
          "login_responsavel": {
            "type": "string",
            "description": "Login da prefeitura. Necessário para emissão de NFSe em alguns municípios sem certificado digital."
          },
          "senha_responsavel": {
            "type": "string",
            "description": "Senha da prefeitura. Necessária em alguns municípios sem certificado digital. Por segurança, não é exibida após ser salva."
          },
          "data_inicio_recebimento_nfe": {
            "type": "string",
            "format": "date",
            "description": "Data inicial para recebimento de NFe (MDe). Documentos anteriores serão ignorados e não cobrados. Após definido, não pode ser alterado."
          },
          "data_inicio_recebimento_cte": {
            "type": "string",
            "format": "date",
            "description": "Data inicial para recebimento de CTe. Documentos anteriores serão ignorados e não cobrados. Após definido, não pode ser alterado."
          },
          "data_inicio_recebimento_nfsen": {
            "type": "string",
            "format": "date",
            "description": "Data inicial para recebimento de NFSe Nacional. Documentos anteriores serão ignorados e não cobrados. Após definido, não pode ser alterado."
          },
          "habilita_filtro_mde_destinatario_empresa": {
            "type": "boolean",
            "description": "Quando verdadeiro, não serão salvos os documentos recebidos (NFe/CTe) que não tenham como destinatário a empresa."
          },
          "smtp_endereco": {
            "type": "string",
            "description": "Endereço do servidor SMTP"
          },
          "smtp_dominio": {
            "type": "string",
            "description": "Domínio do servidor SMTP (HELO)"
          },
          "smtp_autenticacao": {
            "type": "string",
            "enum": ["plain", "login", "cram_md5"],
            "description": "Tipo de autenticação do SMTP."
          },
          "smtp_porta": {
            "type": "integer",
            "description": "Porta do servidor SMTP"
          },
          "smtp_login": {
            "type": "string",
            "description": "Login do servidor SMTP (se exigir autenticação)"
          },
          "smtp_senha": {
            "type": "string",
            "description": "Senha do servidor SMTP (se exigir autenticação)"
          },
          "smtp_remetente": {
            "type": "string",
            "description": "Remetente (from) dos e-mails enviados"
          },
          "smtp_responder_para": {
            "type": "string",
            "description": "Endereço de resposta (reply-to) dos e-mails enviados"
          },
          "smtp_modo_verificacao_openssl": {
            "type": "string",
            "enum": ["peer", "none"],
            "description": "Modo de verificação do OpenSSL."
          },
          "smtp_habilita_starttls": {
            "type": "boolean",
            "description": "Utiliza STARTTLS ao conectar no SMTP"
          },
          "smtp_ssl": {
            "type": "boolean",
            "description": "Utiliza SSL ao conectar no SMTP"
          },
          "smtp_tls": {
            "type": "boolean",
            "description": "Utiliza TLS ao conectar no SMTP"
          },
          "csc_nfce_producao": {
            "type": "string",
            "description": "CSC para emissão de NFCe em produção. Necessário para emitir NFCe em produção (gerar no SEFAZ do estado)."
          },
          "id_token_nfce_producao": {
            "type": "integer",
            "description": "ID do CSC para NFCe em produção. Necessário para emitir NFCe em produção (gerar no SEFAZ do estado)."
          },
          "csc_nfce_homologacao": {
            "type": "string",
            "description": "CSC para emissão de NFCe em homologação."
          },
          "id_token_nfce_homologacao": {
            "type": "integer",
            "description": "ID do CSC para NFCe em homologação."
          },
          "proximo_numero_nfe_producao": {
            "type": "string",
            "description": "Próximo número da NFe a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_nfe_homologacao": {
            "type": "string",
            "description": "Próximo número da NFe a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_nfe_producao": {
            "type": "string",
            "description": "Série da NFe em produção (padrão: 1)"
          },
          "serie_nfe_homologacao": {
            "type": "string",
            "description": "Série da NFe em homologação (padrão: 1)"
          },
          "proximo_numero_nfce_producao": {
            "type": "string",
            "description": "Próximo número da NFCe a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_nfce_homologacao": {
            "type": "string",
            "description": "Próximo número da NFCe a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_nfce_producao": {
            "type": "string",
            "description": "Série da NFCe em produção (padrão: 1)"
          },
          "serie_nfce_homologacao": {
            "type": "string",
            "description": "Série da NFCe em homologação (padrão: 1)"
          },
          "proximo_numero_nfse_producao": {
            "type": "string",
            "description": "Próximo número do RPS da NFSe em produção (calculado automaticamente)"
          },
          "proximo_numero_nfse_homologacao": {
            "type": "string",
            "description": "Próximo número do RPS da NFSe em homologação (calculado automaticamente)"
          },
          "serie_nfse_producao": {
            "type": "string",
            "description": "Série do RPS da NFSe em produção. Algumas prefeituras não utilizam."
          },
          "serie_nfse_homologacao": {
            "type": "string",
            "description": "Série do RPS da NFSe em homologação"
          },
          "proximo_numero_nfsen_producao": {
            "type": "string",
            "description": "Próximo número do RPS da NFSe Nacional em produção (calculado automaticamente)"
          },
          "proximo_numero_nfsen_homologacao": {
            "type": "string",
            "description": "Próximo número do RPS da NFSe Nacional em homologação (calculado automaticamente)"
          },
          "serie_nfsen_producao": {
            "type": "string",
            "description": "Série do RPS para NFSe Nacional em produção. Algumas prefeituras não utilizam."
          },
          "serie_nfsen_homologacao": {
            "type": "string",
            "description": "Série do RPS para NFSe Nacional em homologação. Algumas prefeituras não utilizam."
          },
          "proximo_numero_cte_producao": {
            "type": "string",
            "description": "Próximo número da CTe a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_cte_homologacao": {
            "type": "string",
            "description": "Próximo número da CTe a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_cte_producao": {
            "type": "string",
            "description": "Série da CTe em produção (padrão: 1)"
          },
          "serie_cte_homologacao": {
            "type": "string",
            "description": "Série da CTe em homologação (padrão: 1)"
          },
          "proximo_numero_cte_os_producao": {
            "type": "string",
            "description": "Próximo número da CTeOS a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_cte_os_homologacao": {
            "type": "string",
            "description": "Próximo número da CTeOS a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_cte_os_producao": {
            "type": "string",
            "description": "Série da CTeOS em produção (padrão: 1)"
          },
          "serie_cte_os_homologacao": {
            "type": "string",
            "description": "Série da CTeOS em homologação (padrão: 1)"
          },
          "proximo_numero_mdfe_producao": {
            "type": "string",
            "description": "Próximo número da MDFe a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_mdfe_homologacao": {
            "type": "string",
            "description": "Próximo número da MDFe a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_mdfe_producao": {
            "type": "string",
            "description": "Série da MDFe em produção (padrão: 1)"
          },
          "serie_mdfe_homologacao": {
            "type": "string",
            "description": "Série da MDFe em homologação (padrão: 1)"
          },
          "habilita_nfcom": {
            "type": "boolean",
            "description": "Habilita emissão de NFCom (Nota Fiscal de Comunicação)"
          },
          "proximo_numero_nfcom_producao": {
            "type": "string",
            "description": "Próximo número da NFCom a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_nfcom_homologacao": {
            "type": "string",
            "description": "Próximo número da NFCom a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_nfcom_producao": {
            "type": "string",
            "description": "Série da NFCom em produção (padrão: 1)"
          },
          "serie_nfcom_homologacao": {
            "type": "string",
            "description": "Série da NFCom em homologação (padrão: 1)"
          },
          "habilita_dce": {
            "type": "boolean",
            "description": "Habilita emissão de DCE (Declaração de Conteúdo Eletrônica)"
          },
          "proximo_numero_dce_producao": {
            "type": "string",
            "description": "Próximo número da DCE a ser emitida em produção (calculado automaticamente)"
          },
          "proximo_numero_dce_homologacao": {
            "type": "string",
            "description": "Próximo número da DCE a ser emitida em homologação (calculado automaticamente)"
          },
          "serie_dce_producao": {
            "type": "string",
            "description": "Série da DCE em produção (padrão: 1)"
          },
          "serie_dce_homologacao": {
            "type": "string",
            "description": "Série da DCE em homologação (padrão: 1)"
          },
          "nfe_sincrono": {
            "type": "boolean",
            "description": "Define emissão síncrona da NFe. Se verdadeiro, a autorização/rejeição ocorre na mesma requisição.\nEm caso de SEFAZ indisponível e contingência desligada, não há alternância automática; será necessário reenviar quando a contingência estiver disponível.\n"
          },
          "nfe_sincrono_homologacao": {
            "type": "boolean",
            "description": "Define emissão síncrona da NFe em homologação"
          },
          "mdfe_sincrono": {
            "type": "boolean",
            "description": "Define emissão síncrona da MDFe. Se verdadeiro, a autorização/rejeição ocorre na mesma requisição.\nEm indisponibilidade, não alterna automaticamente para contingência desligada.\n"
          },
          "mdfe_sincrono_homologacao": {
            "type": "boolean",
            "description": "Define emissão síncrona da MDFe em homologação"
          },
          "senha_responsavel_preenchida": {
            "type": "boolean",
            "description": "Indica se o campo senha_responsavel está preenchido"
          }
        }
      },
      "EmpresaResponse": {
        "title": "Empresa",
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "nome": {
            "type": "string"
          },
          "nome_fantasia": {
            "type": "string"
          },
          "inscricao_estadual": {
            "type": "string"
          },
          "inscricao_municipal": {
            "type": "string"
          },
          "bairro": {
            "type": "string"
          },
          "cargo_responsavel": {
            "type": "string"
          },
          "cep": {
            "type": "string"
          },
          "cnpj": {
            "type": "string"
          },
          "cpf": {
            "type": "string"
          },
          "codigo_municipio": {
            "type": "string"
          },
          "codigo_pais": {
            "type": "string"
          },
          "codigo_uf": {
            "type": "string"
          },
          "complemento": {
            "type": "string"
          },
          "cpf_cnpj_contabilidade": {
            "type": "string"
          },
          "cpf_responsavel": {
            "type": "string"
          },
          "discrimina_impostos": {
            "type": "boolean"
          },
          "email": {
            "type": "string"
          },
          "enviar_email_destinatario": {
            "type": "boolean"
          },
          "enviar_email_homologacao": {
            "type": "boolean"
          },
          "habilita_nfce": {
            "type": "boolean"
          },
          "habilita_nfe": {
            "type": "boolean"
          },
          "habilita_nfse": {
            "type": "boolean"
          },
          "habilita_nfcom": {
            "type": "boolean"
          },
          "habilita_dce": {
            "type": "boolean"
          },
          "habilita_nfsen_producao": {
            "type": "boolean"
          },
          "habilita_nfsen_homologacao": {
            "type": "boolean"
          },
          "habilita_cte": {
            "type": "boolean"
          },
          "habilita_mdfe": {
            "type": "boolean"
          },
          "habilita_manifestacao": {
            "type": "boolean"
          },
          "habilita_manifestacao_homologacao": {
            "type": "boolean"
          },
          "habilita_manifestacao_cte": {
            "type": "boolean"
          },
          "habilita_manifestacao_cte_homologacao": {
            "type": "boolean"
          },
          "logradouro": {
            "type": "string"
          },
          "municipio": {
            "type": "string"
          },
          "nome_responsavel": {
            "type": "string"
          },
          "numero": {
            "type": "string"
          },
          "pais": {
            "type": "string"
          },
          "regime_tributario": {
            "type": "string"
          },
          "telefone": {
            "type": "string"
          },
          "uf": {
            "type": "string"
          },
          "habilita_contingencia_offline_nfce": {
            "type": "boolean"
          },
          "habilita_contingencia_epec_nfce": {
            "type": "boolean"
          },
          "reaproveita_numero_nfce_contingencia": {
            "type": "boolean"
          },
          "habilita_consulta_automatica_nfce": {
            "type": "boolean"
          },
          "mostrar_danfse_badge": {
            "type": "boolean"
          },
          "csc_nfce_producao": {
            "type": "string"
          },
          "id_token_nfce_producao": {
            "type": "string"
          },
          "csc_nfce_homologacao": {
            "type": "string"
          },
          "id_token_nfce_homologacao": {
            "type": "string"
          },
          "proximo_numero_nfe_producao": {
            "type": "string"
          },
          "proximo_numero_nfe_homologacao": {
            "type": "string"
          },
          "serie_nfe_producao": {
            "type": "string"
          },
          "serie_nfe_homologacao": {
            "type": "string"
          },
          "proximo_numero_nfse_producao": {
            "type": "string"
          },
          "proximo_numero_nfse_homologacao": {
            "type": "string"
          },
          "proximo_numero_nfsen_producao": {
            "type": "string"
          },
          "proximo_numero_nfsen_homologacao": {
            "type": "string"
          },
          "serie_nfse_producao": {
            "type": "string"
          },
          "serie_nfse_homologacao": {
            "type": "string"
          },
          "serie_nfsen_producao": {
            "type": "string"
          },
          "serie_nfsen_homologacao": {
            "type": "string"
          },
          "proximo_numero_nfcom_producao": {
            "type": "string"
          },
          "proximo_numero_nfcom_homologacao": {
            "type": "string"
          },
          "serie_nfcom_producao": {
            "type": "string"
          },
          "serie_nfcom_homologacao": {
            "type": "string"
          },
          "proximo_numero_dce_producao": {
            "type": "string"
          },
          "proximo_numero_dce_homologacao": {
            "type": "string"
          },
          "serie_dce_producao": {
            "type": "string"
          },
          "serie_dce_homologacao": {
            "type": "string"
          },
          "proximo_numero_nfce_producao": {
            "type": "string"
          },
          "proximo_numero_nfce_homologacao": {
            "type": "string"
          },
          "serie_nfce_producao": {
            "type": "string"
          },
          "serie_nfce_homologacao": {
            "type": "string"
          },
          "proximo_numero_cte_producao": {
            "type": "string"
          },
          "proximo_numero_cte_homologacao": {
            "type": "string"
          },
          "serie_cte_producao": {
            "type": "string"
          },
          "serie_cte_homologacao": {
            "type": "string"
          },
          "proximo_numero_cte_os_producao": {
            "type": "string"
          },
          "proximo_numero_cte_os_homologacao": {
            "type": "string"
          },
          "serie_cte_os_producao": {
            "type": "string"
          },
          "serie_cte_os_homologacao": {
            "type": "string"
          },
          "proximo_numero_mdfe_producao": {
            "type": "string"
          },
          "proximo_numero_mdfe_homologacao": {
            "type": "string"
          },
          "serie_mdfe_producao": {
            "type": "string"
          },
          "serie_mdfe_homologacao": {
            "type": "string"
          },
          "certificado_valido_ate": {
            "type": "string"
          },
          "certificado_valido_de": {
            "type": "string"
          },
          "certificado_cnpj": {
            "type": "string"
          },
          "certificado_especifico": {
            "type": "boolean"
          },
          "data_ultima_emissao": {
            "type": "string"
          },
          "caminho_logo": {
            "type": "string"
          },
          "login_responsavel": {
            "type": "string"
          },
          "senha_responsavel_preenchida": {
            "type": "boolean"
          },
          "orientacao_danfe": {
            "type": "string"
          },
          "recibo_danfe": {
            "type": "boolean"
          },
          "exibe_sempre_ipi_danfe": {
            "type": "boolean"
          },
          "exibe_issqn_danfe": {
            "type": "boolean"
          },
          "exibe_impostos_adicionais_danfe": {
            "type": "boolean"
          },
          "exibe_fatura_danfe": {
            "type": "boolean"
          },
          "exibe_rastro_danfe": {
            "type": "boolean"
          },
          "exibe_unidade_tributaria_danfe": {
            "type": "boolean"
          },
          "exibe_desconto_itens": {
            "type": "boolean"
          },
          "exibe_sempre_volumes_danfe": {
            "type": "boolean"
          },
          "exibe_composicao_carga_mdfe": {
            "type": "boolean"
          },
          "exibe_itens_danfe_etiqueta": {
            "type": "boolean"
          },
          "exibe_valores_danfe_etiqueta": {
            "type": "boolean"
          },
          "data_inicio_recebimento_nfe": {
            "type": "string"
          },
          "data_inicio_recebimento_cte": {
            "type": "string"
          },
          "data_inicio_recebimento_nfsen": {
            "type": "string"
          },
          "habilita_filtro_mde_destinatario_empresa": {
            "type": "boolean"
          },
          "habilita_csrt_nfe": {
            "type": "boolean"
          },
          "nfe_sincrono": {
            "type": "boolean"
          },
          "nfe_sincrono_homologacao": {
            "type": "boolean"
          },
          "mdfe_sincrono": {
            "type": "boolean"
          },
          "mdfe_sincrono_homologacao": {
            "type": "boolean"
          },
          "smtp_endereco": {
            "type": "string"
          },
          "smtp_dominio": {
            "type": "string"
          },
          "smtp_autenticacao": {
            "type": "string"
          },
          "smtp_porta": {
            "type": "string"
          },
          "smtp_login": {
            "type": "string"
          },
          "smtp_remetente": {
            "type": "string"
          },
          "smtp_responder_para": {
            "type": "string"
          },
          "smtp_modo_verificacao_openssl": {
            "type": "string"
          },
          "smtp_habilita_starttlls": {
            "type": "boolean"
          },
          "smtp_ssl": {
            "type": "boolean"
          },
          "smtp_tls": {
            "type": "boolean"
          },
          "token_producao": {
            "type": "string"
          },
          "token_homologacao": {
            "type": "string"
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
      "ValidationDetail": {
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string"
          },
          "mensagem": {
            "type": "string"
          },
          "campo": {
            "type": "string"
          }
        }
      },
      "ValidationErrorResponse": {
        "title": "Erro de validação",
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string"
          },
          "mensagem": {
            "type": "string"
          },
          "erros": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/ValidationDetail"
            }
          }
        }
      }
    },
    "examples": {
      "EmpresaResponse": {
        "value": {
          "id": 123,
          "nome": "Razão social da empresa",
          "nome_fantasia": "Nome fantasia da empresa",
          "inscricao_estadual": "123456",
          "inscricao_municipal": "123456",
          "bairro": "Bairro",
          "cargo_responsavel": null,
          "cep": "12345-678",
          "cnpj": "12345678000123",
          "cpf": "",
          "codigo_municipio": "12345678",
          "codigo_pais": "1058",
          "codigo_uf": "26",
          "complemento": "",
          "cpf_cnpj_contabilidade": "",
          "cpf_responsavel": "",
          "discrimina_impostos": false,
          "email": "",
          "enviar_email_destinatario": false,
          "enviar_email_homologacao": false,
          "habilita_nfce": false,
          "habilita_nfe": false,
          "habilita_nfse": false,
          "habilita_nfcom": false,
          "habilita_dce": false,
          "habilita_nfsen_producao": false,
          "habilita_nfsen_homologacao": false,
          "habilita_cte": false,
          "habilita_mdfe": false,
          "habilita_manifestacao": false,
          "habilita_manifestacao_homologacao": false,
          "habilita_manifestacao_cte": false,
          "habilita_manifestacao_cte_homologacao": false,
          "logradouro": "Logradouro",
          "municipio": "Municipio",
          "nome_responsavel": "",
          "numero": "1234",
          "pais": "Pais",
          "regime_tributario": "3",
          "telefone": "",
          "uf": "UF",
          "habilita_contingencia_offline_nfce": false,
          "habilita_contingencia_epec_nfce": false,
          "reaproveita_numero_nfce_contingencia": false,
          "habilita_consulta_automatica_nfce": false,
          "mostrar_danfse_badge": true,
          "csc_nfce_producao": null,
          "id_token_nfce_producao": null,
          "csc_nfce_homologacao": null,
          "id_token_nfce_homologacao": null,
          "proximo_numero_nfe_producao": null,
          "proximo_numero_nfe_homologacao": null,
          "serie_nfe_producao": null,
          "serie_nfe_homologacao": null,
          "proximo_numero_nfse_producao": null,
          "proximo_numero_nfse_homologacao": null,
          "proximo_numero_nfsen_producao": null,
          "proximo_numero_nfsen_homologacao": null,
          "serie_nfse_producao": null,
          "serie_nfse_homologacao": null,
          "serie_nfsen_producao": null,
          "serie_nfsen_homologacao": null,
          "proximo_numero_nfcom_producao": null,
          "proximo_numero_nfcom_homologacao": null,
          "serie_nfcom_producao": null,
          "serie_nfcom_homologacao": null,
          "proximo_numero_dce_producao": null,
          "proximo_numero_dce_homologacao": null,
          "serie_dce_producao": null,
          "serie_dce_homologacao": null,
          "proximo_numero_nfce_producao": null,
          "proximo_numero_nfce_homologacao": null,
          "serie_nfce_producao": null,
          "serie_nfce_homologacao": null,
          "proximo_numero_cte_producao": null,
          "proximo_numero_cte_homologacao": null,
          "serie_cte_producao": null,
          "serie_cte_homologacao": null,
          "proximo_numero_cte_os_producao": null,
          "proximo_numero_cte_os_homologacao": null,
          "serie_cte_os_producao": null,
          "serie_cte_os_homologacao": null,
          "proximo_numero_mdfe_producao": null,
          "proximo_numero_mdfe_homologacao": null,
          "serie_mdfe_producao": null,
          "serie_mdfe_homologacao": null,
          "certificado_valido_ate": "2025-04-01T15:03:25-03:00",
          "certificado_valido_de": "2024-04-01T15:03:25-03:00",
          "certificado_cnpj": "12345678000123",
          "certificado_especifico": false,
          "data_ultima_emissao": null,
          "caminho_logo": null,
          "login_responsavel": "",
          "senha_responsavel_preenchida": false,
          "orientacao_danfe": "portrait",
          "recibo_danfe": true,
          "exibe_sempre_ipi_danfe": false,
          "exibe_issqn_danfe": false,
          "exibe_impostos_adicionais_danfe": false,
          "exibe_fatura_danfe": false,
          "exibe_rastro_danfe": false,
          "exibe_unidade_tributaria_danfe": false,
          "exibe_desconto_itens": false,
          "exibe_sempre_volumes_danfe": false,
          "exibe_composicao_carga_mdfe": false,
          "exibe_itens_danfe_etiqueta": true,
          "exibe_valores_danfe_etiqueta": true,
          "data_inicio_recebimento_nfe": null,
          "data_inicio_recebimento_cte": null,
          "data_inicio_recebimento_nfsen": null,
          "habilita_filtro_mde_destinatario_empresa": false,
          "habilita_csrt_nfe": true,
          "nfe_sincrono": false,
          "nfe_sincrono_homologacao": false,
          "mdfe_sincrono": false,
          "mdfe_sincrono_homologacao": false,
          "smtp_endereco": null,
          "smtp_dominio": null,
          "smtp_autenticacao": null,
          "smtp_porta": null,
          "smtp_login": null,
          "smtp_remetente": null,
          "smtp_responder_para": null,
          "smtp_modo_verificacao_openssl": null,
          "smtp_habilita_starttlls": true,
          "smtp_ssl": false,
          "smtp_tls": false,
          "token_producao": "",
          "token_homologacao": ""
        }
      }
    }
  }
}
```
