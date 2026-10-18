/**
 * Arquivo de som importado pelo Metro vira o id numerico do asset — o mesmo
 * que `require()` devolveria. Declarado aqui porque os tipos do Expo cobrem
 * imagem e nao audio.
 */
declare module '*.wav' {
  const asset: number
  export default asset
}
