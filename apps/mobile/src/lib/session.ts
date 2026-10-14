import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/**
 * Sessao do usuario no aplicativo — NR-070.
 *
 * Diferente do web, que passa por Route Handlers do Next para o token nunca
 * chegar ao JavaScript da pagina, aqui o app fala direto com a api. Nao ha
 * servidor no meio e nao ha XSS — o que ha e um aparelho que pode ser perdido,
 * emprestado ou ter backup extraido.
 *
 * ## Por que o token NAO fica no AsyncStorage
 *
 * O AsyncStorage e texto puro no sistema de arquivos do app. Em aparelho com
 * root, e em backups nao criptografados, ele e legivel. Guardar ali um token
 * que abre doze horas de sessao seria deixar a chave debaixo do tapete.
 *
 * O `expo-secure-store` usa Keychain no iOS e Keystore no Android — o mesmo
 * lugar onde o sistema guarda senha. O comentario que existia neste arquivo ja
 * dizia isso ("trocar antes de sair do prototipo"); agora que ha token de
 * verdade, trocou.
 *
 * O que NAO e segredo — nome, empresa ativa — continua no AsyncStorage: ele e
 * mais rapido, aceita objeto grande, e nao ha nada a proteger ali.
 */

const CHAVE_PERFIL = 'eibuddy:perfil'
const CHAVE_TOKEN = 'eibuddy:token'

/** Uma loja a que a pessoa tem acesso. */
export type LojaDaSessao = {
  readonly companyId: string
  readonly companyName: string
  readonly role: string
}

/**
 * O que a interface precisa mostrar sobre quem entrou.
 *
 * `empresaId` e `lojas` entraram junto com a escolha de loja. Antes a sessao
 * guardava so o NOME da empresa ativa, e com isso:
 *
 * - o menu nao tinha como dizer em qual loja a pessoa esta — e nao dizia;
 * - trocar de loja era impossivel sem sair e entrar de novo, porque a lista de
 *   vinculos se perdia depois do login.
 */
export type Sessao = {
  userId: string
  nome: string
  empresa: string
  /**
   * Nulo enquanto a pessoa nao escolheu, e isso e estado LEGITIMO.
   *
   * Acontece entre o login e a escolha, e sobrevive a fechar o app no meio: a
   * porta de entrada manda quem esta assim de volta para escolher, em vez de
   * abrir o painel sem empresa e falhar em toda chamada.
   */
  empresaId: string | null
  readonly lojas: readonly LojaDaSessao[]
  /**
   * Super Admin da plataforma — ADR-0007. Opcional porque sessoes gravadas
   * antes deste campo nao o tem, e ausente vale como nao-admin.
   */
  readonly admin?: boolean
}

export async function abrirSessao(sessao: Sessao, token: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(CHAVE_PERFIL, JSON.stringify(sessao)).catch(() => undefined),
    guardarToken(token),
  ])
}

/**
 * Troca a empresa ativa sem mexer no token — o Super Admin entrando numa loja
 * (ou saindo dela) muda o estado da sessao no servidor, e o mesmo token segue.
 */
export async function atualizarEmpresaAtiva(
  empresaId: string | null,
  empresa: string,
): Promise<void> {
  const atual = await lerSessao()
  if (atual === null) return
  await AsyncStorage.setItem(CHAVE_PERFIL, JSON.stringify({ ...atual, empresaId, empresa })).catch(
    () => undefined,
  )
}

export async function lerSessao(): Promise<Sessao | null> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_PERFIL)
    return bruto ? (JSON.parse(bruto) as Sessao) : null
  } catch {
    return null
  }
}

export async function encerrarSessao(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(CHAVE_PERFIL).catch(() => undefined),
    /*
     * Apagar o TOKEN e o que de fato encerra. Se so o perfil saisse, a tela
     * mostraria "entre na sua conta" com um token valido ainda guardado — e a
     * proxima chamada continuaria autenticada.
     */
    SecureStore.deleteItemAsync(CHAVE_TOKEN).catch(() => undefined),
  ])
}

async function guardarToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(CHAVE_TOKEN, token, {
      /*
       * So depois do primeiro desbloqueio, e nunca em backup. Sem isto, o token
       * viajaria no backup do aparelho para outro dispositivo — e uma sessao
       * restaurada de backup e uma sessao que ninguem abriu.
       */
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  } catch {
    /*
     * Aparelho sem armazenamento seguro disponivel. NAO cai para o
     * AsyncStorage: silenciosamente guardar em texto puro seria pior que
     * falhar, porque ninguem descobriria. Sem token, a proxima chamada responde
     * 401 e a pessoa entra de novo.
     */
  }
}

export async function lerToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CHAVE_TOKEN)
  } catch {
    return null
  }
}
