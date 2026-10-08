import { Drawer } from 'expo-router/drawer'
import MenuLateral from '@/components/MenuLateral'
import Tutorial from '@/components/Tutorial'
import { cores } from '@/theme/tokens'

/**
 * Navegacao do app: gaveta lateral com os grupos retrateis.
 *
 * Sao doze modulos — barra de abas nao comporta, e uma lista corrida de
 * doze itens tambem nao. A gaveta espelha a sidebar do web, e os grupos
 * abrem e fecham para manter so o assunto do momento na frente.
 *
 * Cada tela desenha o proprio cabecalho (com o botao da gaveta), entao o
 * header nativo fica desligado.
 */
export default function LayoutApp() {
  return (
    <>
      <Drawer
        drawerContent={(props) => <MenuLateral {...props} />}
        screenOptions={{
          headerShown: false,
          drawerType: 'front',
          drawerStyle: { backgroundColor: cores.painel, width: 280 },
          sceneStyle: { backgroundColor: cores.fundo },
          /* Deslizar da borda para abrir — gesto esperado no celular. */
          swipeEnabled: true,
          swipeEdgeWidth: 40,
        }}
      />
      {/* Por cima de qualquer tela: o item do menu pode reabri-lo de onde for. */}
      <Tutorial />
    </>
  )
}
