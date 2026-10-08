import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import somBipe from '../../assets/sons/bipe.wav'
import somConfirmacao from '../../assets/sons/confirmacao.wav'

/**
 * Som do app — bipe do leitor e confirmacao de venda fechada (NR-163).
 *
 * O MESMO som do web (`lib/som.ts`): la ele e sintetizado com `AudioContext`;
 * aqui o aparelho nao tem esse sintetizador, entao os dois arquivos em
 * `assets/sons` foram gerados com as mesmas notas e o mesmo envelope — bipe
 * de 1500 Hz em 90 ms; confirmacao em duas notas subindo (880 Hz e 1318,5 Hz).
 *
 * A preferencia liga/desliga mora no aparelho, como no web mora no
 * navegador, e comeca LIGADA, tambem como no web.
 */

export type PreferenciaDeSom = 'ligado' | 'desligado'

const CHAVE_SOM = 'eibuddy:som'

let atual: PreferenciaDeSom = 'ligado'
let carregada = false
const ouvintes = new Set<(p: PreferenciaDeSom) => void>()

/** Le a preferencia gravada uma vez; depois responde da memoria. */
export async function lerSom(): Promise<PreferenciaDeSom> {
  if (!carregada) {
    try {
      atual = (await AsyncStorage.getItem(CHAVE_SOM)) === 'off' ? 'desligado' : 'ligado'
    } catch {
      atual = 'ligado'
    }
    carregada = true
  }
  return atual
}

export function assinarSom(ouvinte: (p: PreferenciaDeSom) => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

export async function alternarSom(): Promise<PreferenciaDeSom> {
  const proximo: PreferenciaDeSom = (await lerSom()) === 'ligado' ? 'desligado' : 'ligado'
  atual = proximo
  try {
    await AsyncStorage.setItem(CHAVE_SOM, proximo === 'ligado' ? 'on' : 'off')
  } catch {
    /* Sem onde gravar, a escolha vale ate fechar o app. */
  }
  for (const ouvinte of ouvintes) ouvinte(proximo)
  return proximo
}

/*
 * Um tocador por som, criado na primeira vez e reaproveitado: o bipe toca a
 * cada produto lido, e criar um tocador por bipe atrasaria o som justamente
 * na leitura rapida do balcao.
 */
const tocadores: { bipe?: AudioPlayer; confirmacao?: AudioPlayer } = {}

function tocar(qual: 'bipe' | 'confirmacao') {
  void (async () => {
    if ((await lerSom()) === 'desligado') return
    try {
      tocadores[qual] ??= createAudioPlayer(qual === 'bipe' ? somBipe : somConfirmacao)
      const p = tocadores[qual]!
      await p.seekTo(0)
      p.play()
    } catch {
      /* Som e acessorio: falhar em tocar nunca pode atrapalhar a venda. */
    }
  })()
}

/** Bipe curto e agudo — o da leitora de mercado. */
export const tocarBipe = () => tocar('bipe')

/** Duas notas subindo — o "pronto" de uma venda fechada. */
export const tocarConfirmacao = () => tocar('confirmacao')
