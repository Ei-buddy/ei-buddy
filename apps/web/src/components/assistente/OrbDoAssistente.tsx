'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
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
 * As tres sao da familia azul-verde da marca. O amarelo do mascote NAO entra
 * como cor base: no shader original a terceira cor e misturada pelo angulo e
 * cobre metade da orb, o que faria dele cor dominante. Ele entra so na LUZ que
 * orbita (`uBrilho`), que e brilho de destaque — que era o pedido.
 */
const AZUL = new THREE.Vector3(0.118, 0.533, 0.898) /* #1e88e5 */
const TEAL = new THREE.Vector3(0.149, 0.651, 0.604) /* #26a69a */
const CLARO = new THREE.Vector3(0.498, 0.89, 0.847) /* #7fe3d8 */
const BRILHO = new THREE.Vector3(0.957, 0.769, 0.188) /* #f4c430 */

/** Passa direto em espaco de recorte: o triangulo ja nasce cobrindo a tela. */
const VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/*
 * A orb inteira e desenhada pelo shader: nao ha esfera, nao ha luz de cena.
 * O ruido mistura as tres cores, o `pulse` faz a respiracao, uma luz orbita
 * a borda e `extractAlpha` recorta tudo num circulo com as pontas
 * transparentes — e o que faz o brilho sangrar para fora sem moldura.
 */
const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uTempo;
  uniform vec3 uResolucao;
  uniform float uGiro;
  uniform vec3 uAzul;
  uniform vec3 uTeal;
  uniform vec3 uClaro;
  uniform vec3 uBrilho;

  varying vec2 vUv;

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 cor) {
    float a = max(max(cor.r, cor.g), cor.b);
    return vec4(cor.rgb / (a + 1e-5), a);
  }

  float luz1(float intensidade, float atenuacao, float d) {
    return intensidade / (1.0 + d * atenuacao);
  }

  float luz2(float intensidade, float atenuacao, float d) {
    return intensidade / (1.0 + d * d * atenuacao);
  }

  const float ESCALA_RUIDO = 0.75;
  const float RAIO_INTERNO = 0.12;

  vec4 desenhar(vec2 uv) {
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    /* A respiracao: a borda infla e desinfla devagar. */
    float pulso = sin(uTempo * 1.5) * 0.02;

    float n0 = snoise3(vec3(uv * ESCALA_RUIDO, uTempo * 0.5)) * 0.5 + 0.5;
    float r0 = mix(
      mix(RAIO_INTERNO + pulso, 1.0, 0.4),
      mix(RAIO_INTERNO + pulso, 1.0, 0.6),
      n0
    );

    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = luz1(1.0, 10.0, d0) * smoothstep(r0 * 1.05, r0, len);

    /* A luz que orbita — e ela que carrega o amarelo. */
    float a = uTempo * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = luz2(1.5, 5.0, d) * luz1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(RAIO_INTERNO, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(RAIO_INTERNO, mix(RAIO_INTERNO, 1.0, 0.5), len);

    float cl = cos(atan(uv.y, uv.x) + uTempo * 2.0) * 0.5 + 0.5;

    vec3 col = mix(uTeal, uClaro, cl);
    col = mix(col, uAzul, n0);
    col = mix(vec3(0.0), col, v0);
    col = (col + v1 * uBrilho) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  void main() {
    vec2 centro = uResolucao.xy * 0.5;
    float lado = min(uResolucao.x, uResolucao.y);
    vec2 uv = (vUv * uResolucao.xy - centro) / lado * 2.0;

    float s = sin(uGiro);
    float c = cos(uGiro);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    vec4 col = desenhar(uv);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`

/** Radianos por segundo. O padrao do componente de referencia. */
const VELOCIDADE = 0.3

function Cena() {
  const material = useRef<THREE.ShaderMaterial>(null)
  const { size, viewport } = useThree()
  const giro = useRef(0)
  const ultimo = useRef(0)

  /*
   * Um triangulo unico, maior que a tela, em vez de um plano com dois
   * triangulos: e o jeito padrao de rodar shader de tela cheia, e economiza a
   * costura diagonal no meio — onde o ruido mostraria emenda.
   */
  const geometria = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    )
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
    return geo
  }, [])

  /* Sem isto a geometria fica na memoria da GPU depois que a orb desmonta — e
     ela desmonta toda vez que o assistente termina de responder. */
  useEffect(() => () => geometria.dispose(), [geometria])

  const uniforms = useMemo(
    () => ({
      uTempo: { value: 0 },
      uResolucao: { value: new THREE.Vector3(1, 1, 1) },
      uGiro: { value: 0 },
      uAzul: { value: AZUL },
      uTeal: { value: TEAL },
      uClaro: { value: CLARO },
      uBrilho: { value: BRILHO },
    }),
    [],
  )

  useFrame((estado) => {
    const m = material.current
    if (m === null) return

    const t = estado.clock.elapsedTime
    giro.current += (t - ultimo.current) * VELOCIDADE
    ultimo.current = t

    m.uniforms.uTempo.value = t
    m.uniforms.uGiro.value = giro.current
    m.uniforms.uResolucao.value.set(
      size.width * viewport.dpr,
      size.height * viewport.dpr,
      size.width / size.height,
    )
  })

  return (
    <mesh geometry={geometria} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
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

export default function OrbDoAssistente({
  tamanho = 168,
  animada = true,
}: {
  tamanho?: number
  /**
   * Liga o shader. Falso entrega o mesmo circulo em CSS, sem canvas.
   *
   * Existe porque o efeito NAO escala para baixo: o brilho e proporcional ao
   * raio, entao abaixo de uns 100px a orb vira um anel fino e apagado — pior
   * que o circulo solido, e ainda custando um contexto WebGL. No avatar de
   * 44px quem mostra atividade sao os pontinhos de "digitando" ao lado.
   */
  animada?: boolean
}) {
  const menosMovimento = useSyncExternalStore(assinarMovimento, noCliente, noServidor)
  const [podeWebgl] = useState(() => (typeof document === 'undefined' ? false : temWebgl()))

  const estilo = { width: tamanho, height: tamanho }

  /* Sem canvas: o mesmo gradiente, parado, recortado em circulo. */
  if (!animada || !podeWebgl || menosMovimento) {
    return <span className={styles.parada} style={estilo} aria-hidden="true" />
  }

  /*
   * O contentor NAO recorta nem arredonda: quem desenha o circulo e o shader,
   * e o brilho precisa sangrar para fora dele. Um `overflow: hidden` aqui
   * cortaria o halo num anel duro.
   */
  return (
    <span className={styles.orb} style={estilo} aria-hidden="true">
      <Canvas
        className={styles.canvas}
        /* Teto de resolucao: a orb e borrada por natureza, e em
           `devicePixelRatio` 3 custaria nove vezes mais fragmento por quadro
           sem ninguem notar a diferenca. */
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
      >
        <Cena />
      </Canvas>
    </span>
  )
}
