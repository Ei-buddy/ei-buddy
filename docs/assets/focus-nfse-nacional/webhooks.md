---
updatedAt: 2026-04-10T18:08:45.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Webhooks

Gatilhos ou "WebHooks" são eventos automáticos disparados a partir de mudanças específicas nos documentos fiscais. Quando isso ocorre, os dados do documento são enviados em formato JSON via método POST para uma URL definida por você. Cada acionamento do gatilho contém os dados de apenas um documento.

Se o **POST** para a URL configurada **falhar** — por exemplo, **servidor indisponível** ou **resposta HTTP fora da família 2xx** — a API **reenvia** a notificação nos intervalos abaixo. **Depois da última tentativa, o gatilho não é disparado de novo** para aquele evento.

- 1 minuto
- 30 minutos
- 1 hora
- 3 horas
- 24 horas
