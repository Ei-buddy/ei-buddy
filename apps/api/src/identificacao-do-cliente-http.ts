/**
 * Como nos identificamos ao chamar provedor publico.
 *
 * O `fetch` do Node NAO manda `User-Agent` nenhum, e a BrasilAPI responde
 * **403 Forbidden** ao endpoint de CNPJ quando ele falta — o mesmo pedido pelo
 * `curl` passa, porque o curl se identifica. Foi assim que a consulta de CNPJ
 * parou de achar empresa que existe: Petrobras e Banco do Brasil voltavam
 * "nao encontramos esse CNPJ".
 *
 * Vale para qualquer provedor publico e gratuito: identificar quem chama e o
 * minimo de educacao com quem paga a conta do servico, e e o que permite a
 * eles falar conosco se algo sair errado.
 */
export const USER_AGENT = 'EiBuddy/1.0 (+https://eibuddy.com.br)'
