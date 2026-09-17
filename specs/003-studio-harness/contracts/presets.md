# Contract: arquivo de presets do harness Studio

**Feature**: NR-121 · **Env**: `AGENT_STUDIO_PRESETS`  
**Default**: `packages/agent/studio/presets.json` (local, gitignored se contiver UUIDs reais)  
**Exemplo versionado**: `packages/agent/studio/presets.example.json`

## Schema

```json
{
  "presets": [
    {
      "id": "claudia-loja-1",
      "peer": "5511999000001",
      "companyId": "00000000-0000-4000-8000-000000000001",
      "userId": "00000000-0000-4000-8000-000000000011",
      "role": "owner"
    },
    {
      "id": "claudia-loja-2",
      "peer": "5511999000002",
      "companyId": "00000000-0000-4000-8000-000000000002",
      "userId": "00000000-0000-4000-8000-000000000012",
      "role": "owner"
    }
  ]
}
```

| Campo       | Regras                                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `id`        | slug `[a-z0-9-]+`, único                                                    |
| `peer`      | só dígitos após normalizar; E.164 BR de teste (`55…`); **único** no arquivo |
| `companyId` | UUID da fixture criada pelo desenvolvedor                                   |
| `userId`    | UUID do owner da mesma fixture                                              |
| `role`      | literal `owner`                                                             |

`.strict()` no objeto de cada preset. Chaves extra → load recusa.

## Dropdown do Studio

O loader gera o mapa no formato de request-context presets do Mastra (`id` → `{ "preset": "<id>" }`), para o flag/arquivo que o Studio lê. O desenvolvedor **não** precisa colar UUID no editor.

## Segredos e git

- Placeholders no `*.example.json` (UUIDs óbvios, peers 5511999…).
- Arquivo local com IDs reais: fora do git (gitignore do path default, ou o dev aponta `AGENT_STUDIO_PRESETS` para fora do repo).
- Peer MUST NOT ser celular de lojista real (RNF-034).
