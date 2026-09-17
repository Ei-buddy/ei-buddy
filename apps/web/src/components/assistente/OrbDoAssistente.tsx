'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Mesh, ShaderMaterial } from 'three'
import styles from './OrbDoAssistente.module.css'

/**
 * A orb do assistente — NR-127, so visual.
 *
 * ## Onde ela aparece, e por que nao em toda mensagem
 *
 * Em dois lugares: nas boas-vindas (antes da conversa comecar) e enquanto o
 * assistente pensa. Os dois sao momentos de UM elemento na tela.
 *
 * O avatar de cada mensagem continua sendo o icone leve de sempre, e isso e
 * decisao de desempenho, nao de gosto: uma conversa de vinte respostas viraria
 * vinte contextos WebGL vivos ao mesmo tempo. No Android de entrada — que e o
 * aparelho da maioria de quem usa isto — o navegador comeca a descartar
 * contexto por volta do decimo sexto, e a tela apaga sozinha.
 *
 * ## Ela nao sabe de nada
 *
 * Nao recebe mensagem, estado nem resposta. Quem decide se o assistente esta
 * pensando continua sendo `ChatAssistente`; a orb so e montada ou desmontada
 * por ele. Desmontar e o que libera o canvas: fora destes dois momentos nao
 * ha WebGL rodando em lugar nenhum do app.
 *
 * ## Tres saidas, da mais rica para a mais simples
 *
 * 1. WebGL disponivel e movimento permitido: o shader anima.
 * 2. Movimento reduzido: o MESMO gradiente, parado — via CSS, sem canvas.
 *    Congelar o shader gastaria GPU para desenhar sempre o mesmo quadro.
 * 3. Sem WebGL: o gradiente CSS, igual ao caso 2. A tela nunca quebra.
 */

/*
 * A paleta, em RGB normalizado — o shader nao le hexadecimal.
 *
 * Azul e verde-agua sao os dominantes (a familia da marca). O amarelo entra
 * so como brilho quente, com peso baixo: e destaque, nao terceira cor.
 */
const AZUL = [0.118, 0.533, 0.898] /* #1e88e5 */
const TEAL = [0.149, 0.651, 0.604] /* #26a69a */
const BRILHO = [0.957, 0.769, 0.188] /* #f4c430 */

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/*
 * O gradiente nasce de ruido, e nao de listras: um degrade linear numa esfera
 * lida como plastico. O ruido faz as cores se misturarem em manchas que se
 * movem devagar — e o que da a impressao de algo vivo em vez de girando.
 */
const FRAGMENT = /* glsl */ `
  uniform float uTempo;
  uniform vec3 uAzul;
  uniform vec3 uTeal;
  uniform vec3 uBrilho;

  varying vec3 vNormal;
  varying vec3 vPosition;

  /* Ruido de valor, barato: a orb e pequena e roda em celular fraco. */
  vec3 hash(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float ruido(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(mix(mix(dot(hash(i + vec3(0,0,0)), f - vec3(0,0,0)),
                       dot(hash(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }

  void main() {
    float n = ruido(vPosition * 1.6 + vec3(0.0, uTempo * 0.18, uTempo * 0.12));
    float m = ruido(vPosition * 2.4 - vec3(uTempo * 0.1, 0.0, 0.0));

    vec3 cor = mix(uAzul, uTeal, smoothstep(-0.5, 0.5, n));
    /* O amarelo so nos picos do segundo ruido: aparece de relance, como luz
       batendo, e nunca domina a esfera. */
    cor = mix(cor, uBrilho, smoothstep(0.35, 0.75, m) * 0.28);

    /* Borda mais clara: sem isso a esfera lida como circulo chapado. */
    float borda = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
    cor += pow(borda, 3.0) * 0.35;

    gl_FragColor = vec4(cor, 1.0);
  }
`

function Esfera({ girando }: { girando: boolean }) {
  const malha = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uTempo: { value: 0 },
      uAzul: { value: AZUL },
      uTeal: { value: TEAL },
      uBrilho: { value: BRILHO },
    }),
    [],
  )

  useFrame((_, delta) => {
    if (!girando) return
    /* Devagar de proposito: isto fica ao lado de texto que a pessoa esta
       lendo, e o movimento tem de sugerir presenca, nao chamar atencao. */
    if (material.current !== null) material.current.uniforms.uTempo.value += delta * 0.35
    if (malha.current !== null) malha.current.rotation.y += delta * 0.12
  })

  return (
    <mesh ref={malha}>
      {/* Poucos segmentos: a 64px na tela ninguem ve a diferenca, e cada
          segmento a mais e vertice que o celular processa por quadro. */}
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
      />
    </mesh>
  )
}

/** Uma vez por sessao: se o navegador nao da WebGL, nunca vai dar. */
let suporteWebgl: boolean | undefined

function temWebgl(): boolean {
  if (suporteWebgl !== undefined) return suporteWebgl

  try {
    const canvas = document.createElement('canvas')
    suporteWebgl = canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
  } catch {
    suporteWebgl = false
  }

  return suporteWebgl
}

const CONSULTA = '(prefers-reduced-motion: reduce)'

function assinarMovimento(aoMudar: () => void): () => void {
  const consulta = window.matchMedia(CONSULTA)
  consulta.addEventListener('change', aoMudar)
  return () => consulta.removeEventListener('change', aoMudar)
}

const noCliente = (): boolean => window.matchMedia(CONSULTA).matches
const noServidor = (): boolean => false

export default function OrbDoAssistente({ tamanho = 58 }: { tamanho?: number }) {
  const menosMovimento = useSyncExternalStore(assinarMovimento, noCliente, noServidor)

  /*
   * O canvas so entra depois da primeira pintura.
   *
   * `useState` com valor inicial calculado UMA vez: no servidor nao ha
   * `document`, e chamar `temWebgl()` no corpo do componente quebraria a
   * renderizacao. O gradiente CSS aparece primeiro e o canvas o cobre quando
   * estiver pronto — quem nao tem WebGL fica com ele, e nunca ve buraco.
   */
  const [podeWebgl] = useState(() => (typeof document === 'undefined' ? false : temWebgl()))

  const estilo = { width: tamanho, height: tamanho }

  if (!podeWebgl || menosMovimento) {
    return <span className={styles.orb} style={estilo} aria-hidden="true" />
  }

  return (
    <span className={styles.orb} style={estilo} aria-hidden="true">
      <Canvas
        className={styles.canvas}
        /* Teto de resolucao: a orb e pequena e borrada por natureza, e em
           `devicePixelRatio` 3 custaria nove vezes mais fragmento por quadro
           sem ninguem notar a diferenca. */
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 2.6], fov: 45 }}
        gl={{ antialias: false, alpha: true }}
      >
        <Esfera girando={!menosMovimento} />
      </Canvas>
    </span>
  )
}
