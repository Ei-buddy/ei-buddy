import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cores, espaco, fonte, peso, raio, vidro } from '@/theme/tokens'

/**
 * Campo de texto com rotulo e erro inline.
 *
 * `keyboardType` e `autoCapitalize` sao repassados de proposito: no
 * celular, abrir o teclado errado (letras para um campo de valor) e um
 * atrito que aparece em toda digitacao.
 */
export default function Campo({
  rotulo,
  valor,
  onChange,
  erro,
  dica,
  placeholder,
  senha = false,
  tipoTeclado = 'default',
  autoCap = 'sentences',
  editavel = true,
}: {
  rotulo: string
  valor: string
  onChange: (valor: string) => void
  erro?: string | null
  dica?: string
  placeholder?: string
  senha?: boolean
  tipoTeclado?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'decimal-pad'
  autoCap?: 'none' | 'sentences' | 'words' | 'characters'
  editavel?: boolean
}) {
  const [visivel, setVisivel] = useState(false)

  return (
    <View style={estilos.campo}>
      <Text style={estilos.rotulo}>{rotulo}</Text>

      <View style={[estilos.caixa, Boolean(erro) && estilos.caixaErro]}>
        <TextInput
          style={estilos.input}
          value={valor}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={cores.textoFraco}
          secureTextEntry={senha && !visivel}
          keyboardType={tipoTeclado}
          autoCapitalize={autoCap}
          autoCorrect={false}
          editable={editavel}
          accessibilityLabel={rotulo}
        />

        {senha ? (
          <Pressable
            onPress={() => setVisivel((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          >
            <Text style={estilos.alternar}>{visivel ? 'ocultar' : 'mostrar'}</Text>
          </Pressable>
        ) : null}
      </View>

      {erro ? (
        <Text style={estilos.erro} accessibilityRole="alert">
          {erro}
        </Text>
      ) : dica ? (
        <Text style={estilos.dica}>{dica}</Text>
      ) : null}
    </View>
  )
}

const estilos = StyleSheet.create({
  campo: { gap: espaco.sm },
  rotulo: {
    fontSize: fonte.pequeno,
    fontWeight: peso.medio,
    color: cores.textoFraco,
  },
  caixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    minHeight: 50,
    paddingHorizontal: espaco.lg,
    /* Vidro REBAIXADO — afunda na superficie em vez de saltar dela. */
    ...vidro.campo,
    borderRadius: raio.sm,
  },
  caixaErro: { borderColor: cores.erro },
  input: {
    flex: 1,
    fontSize: fonte.corpo,
    color: cores.texto,
    /* Sem padding vertical: a altura vem do container, senao Android e
       iOS ficam com alturas diferentes. */
    paddingVertical: 0,
  },
  alternar: {
    fontSize: fonte.micro,
    fontWeight: peso.forte,
    color: cores.acento,
  },
  erro: { fontSize: fonte.micro, color: cores.erro },
  dica: { fontSize: fonte.micro, color: cores.textoFraco },
})
