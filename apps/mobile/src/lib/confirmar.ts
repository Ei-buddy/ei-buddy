import { Alert, Platform } from 'react-native'

/**
 * Pergunta antes de uma acao sem volta — NR-213.
 *
 * No celular, o `Alert` nativo com "Voltar" e a acao em vermelho. No
 * navegador (o app tambem roda la, para teste), o `Alert` do react-native-web
 * nao mostra botoes e a acao nunca aconteceria: ali vai o `window.confirm`.
 */
export function confirmar(
  titulo: string,
  mensagem: string,
  aoConfirmar: () => void | Promise<void>,
  rotulo = 'Excluir',
): void {
  if (Platform.OS === 'web') {
    if (window.confirm(`${titulo}\n\n${mensagem}`)) void aoConfirmar()
    return
  }
  Alert.alert(titulo, mensagem, [
    { text: 'Voltar', style: 'cancel' },
    { text: rotulo, style: 'destructive', onPress: () => void aoConfirmar() },
  ])
}
