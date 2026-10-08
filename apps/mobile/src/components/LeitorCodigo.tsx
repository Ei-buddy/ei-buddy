import { useRef, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { SafeAreaView } from 'react-native-safe-area-context'
import Botao from './ui/Botao'
import Campo from './ui/Campo'
import { tocarBipe } from '@/lib/som'
import { cores, espaco, fonte, peso, raio } from '@/theme/tokens'
import { criarEstilos } from '@/theme/estilos'

/** Tempo travado apos uma leitura, para nao ler o mesmo codigo em rajada. */
const TRAVA_MS = 1500

/**
 * Leitura de codigo de barras pela camera.
 *
 * Diferente da versao web, que dependia da API BarcodeDetector do
 * navegador (so no Chrome), aqui a leitura e nativa e funciona nos dois
 * sistemas — e o motivo principal do app existir.
 *
 * A entrada manual continua disponivel: codigo de barras rasgado ou
 * embalagem amassada acontece todo dia no balcao.
 */
export default function LeitorCodigo({
  aberto,
  onLer,
  onFechar,
}: {
  aberto: boolean
  onLer: (codigo: string) => void
  onFechar: () => void
}) {
  const [permissao, pedirPermissao] = useCameraPermissions()
  const [manual, setManual] = useState('')
  const travadoAte = useRef(0)

  function aoLer(codigo: string) {
    /* A camera dispara varias vezes por segundo com o mesmo codigo na
       frente; sem a trava, um bipe viraria dez itens no carrinho. */
    const agora = Date.now()
    if (agora < travadoAte.current) return
    travadoAte.current = agora + TRAVA_MS

    /* O bipe da leitora, como no web — NR-163. Respeita o liga/desliga. */
    tocarBipe()
    onLer(codigo)
  }

  function enviarManual() {
    const limpo = manual.trim()
    if (!limpo) return
    setManual('')
    onLer(limpo)
    onFechar()
  }

  return (
    <Modal visible={aberto} animationType="slide" onRequestClose={onFechar} statusBarTranslucent>
      <SafeAreaView style={estilos.tela} edges={['top', 'bottom']}>
        <View style={estilos.cabecalho}>
          <Text style={estilos.titulo}>Ler código de barras</Text>
          <Pressable onPress={onFechar} hitSlop={12} accessibilityRole="button">
            <Text style={estilos.fechar}>fechar</Text>
          </Pressable>
        </View>

        <View style={estilos.camera}>
          {!permissao ? (
            /* Ainda verificando a permissao. */
            <View style={estilos.aviso}>
              <Text style={estilos.avisoTexto}>Verificando a câmera...</Text>
            </View>
          ) : !permissao.granted ? (
            <View style={estilos.aviso}>
              <Text style={estilos.avisoTitulo}>Câmera bloqueada</Text>
              <Text style={estilos.avisoTexto}>
                Para bipar produtos, o app precisa da câmera. Você pode digitar o código abaixo
                enquanto isso.
              </Text>
              <Botao onPress={pedirPermissao} variante="secundario">
                Liberar câmera
              </Botao>
            </View>
          ) : (
            <>
              <CameraView
                style={estilos.preview}
                facing="back"
                barcodeScannerSettings={{
                  /* Formatos de produto no varejo brasileiro. */
                  barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'],
                }}
                onBarcodeScanned={({ data }) => aoLer(data)}
              />
              <View style={estilos.mira} pointerEvents="none" />
              <Text style={estilos.instrucao}>Aponte para o código de barras</Text>
            </>
          )}
        </View>

        <View style={estilos.manual}>
          <Campo
            rotulo="Ou digite o código"
            valor={manual}
            onChange={setManual}
            placeholder="789..."
            tipoTeclado="numeric"
          />
          <Botao onPress={enviarManual} desabilitado={!manual.trim()} largura>
            Usar código
          </Botao>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const estilos = criarEstilos(() => ({
  tela: { flex: 1, backgroundColor: cores.fundo },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: espaco.lg,
  },
  titulo: { fontSize: fonte.medio, fontWeight: peso.forte, color: cores.texto },
  fechar: { fontSize: fonte.pequeno, fontWeight: peso.forte, color: cores.acento },

  camera: {
    flex: 1,
    margin: espaco.lg,
    borderRadius: raio.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  preview: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },

  mira: {
    alignSelf: 'center',
    width: '76%',
    height: '26%',
    borderWidth: 2,
    borderColor: cores.acento,
    borderRadius: raio.md,
  },
  instrucao: {
    position: 'absolute',
    bottom: espaco.lg,
    alignSelf: 'center',
    fontSize: fonte.pequeno,
    color: '#fff',
  },

  aviso: {
    padding: espaco.xl,
    gap: espaco.md,
    alignItems: 'center',
  },
  avisoTitulo: {
    fontSize: fonte.medio,
    fontWeight: peso.forte,
    color: cores.texto,
  },
  avisoTexto: {
    fontSize: fonte.pequeno,
    color: cores.textoFraco,
    textAlign: 'center',
    lineHeight: 20,
  },

  manual: { padding: espaco.lg, gap: espaco.md },
}))
