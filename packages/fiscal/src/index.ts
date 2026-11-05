/**
 * Adapter de emissao fiscal (NFC-e / NFS-e). Implementa a porta `InvoiceIssuer`
 * declarada por `core`.
 *
 * O provedor real ainda nao foi escolhido (DEC-004), e o adapter real entra com
 * a NR-042. O que existe hoje e o falso — `FISCAL_PROVIDER=fake` — que satisfaz
 * a porta inteira, inclusive os caminhos de erro, e permite que a venda, a fila
 * e a tela sejam construidas sem esperar a decisao.
 *
 * A suite de contrato (`invoice-issuer-contract.ts`) NAO e exportada aqui de
 * proposito: ela importa `vitest`, que e dependencia de desenvolvimento. Quem
 * precisa dela e o teste do adapter real, dentro deste mesmo pacote.
 */
export { chaveDeAcesso, createFakeInvoiceIssuer, FakeInvoiceIssuer } from './fake-issuer.js'
export type { FakeInvoiceIssuerOptions } from './fake-issuer.js'

/* Emissor real — Focus NFe, NR-042 / DEC-004. A guarda de notas viaja junto:
   ela nao e cache, e o que torna o cancelamento por chave possivel e o que
   mantem o XML fora da conta do provedor. */
export { criarEmissorFocusNfe, FOCUS_NFE_URLS, reaisDeCentavos } from './focusnfe-issuer.js'
export type { AmbienteFocusNfe, CredenciaisFocusNfe, FocusNfeOptions } from './focusnfe-issuer.js'
export { InMemoryInvoiceStore } from './invoice-store.js'
export type { InvoiceStore, NotaGuardada } from './invoice-store.js'

/* Cadastro da empresa da loja na Focus, como revenda — NR-183. */
export {
  corpoDaEmpresa,
  criarCadastroDeEmpresasFocus,
  criarCadastroDeEmpresasFocusFalso,
} from './focusnfe-empresas.js'
export type {
  CadastroDeEmpresasFocus,
  CadastroDeEmpresasFocusOptions,
  DadosDaEmpresaFocus,
  EmpresaNaFocus,
  RegimeTributarioFocus,
  ResultadoDoCadastro,
} from './focusnfe-empresas.js'
