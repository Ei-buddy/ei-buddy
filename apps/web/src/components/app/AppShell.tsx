'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import { BRAND } from '@/content/site'
import { MODULOS_BLOQUEADOS } from '@/lib/access'
import { carregarAvisos, type Aviso } from '@/lib/avisos-api'
import MenuDoUsuario from './MenuDoUsuario'
import { carregarPerfil, iniciaisDe, type Perfil } from '@/lib/perfil-api'
import { sairDoModoAdmin } from '@/lib/admin-api'
import { sair as encerrarSessao } from '@/lib/session-client'
import BuscaSpotlight, { type TelaBuscavel } from './BuscaSpotlight'
import PaymentOverdueBanner from '../billing/PaymentOverdueBanner'
import PaymentRequiredModal from '../billing/PaymentRequiredModal'
import { useSubscription } from '../billing/SubscriptionProvider'
import ThemeToggle from './ThemeToggle'
import SomToggle from './SomToggle'
import Tutorial from '../tutorial/Tutorial'
import { iniciarTutorial } from '@/lib/tutorial'
import {
  alternarSidebar,
  assinarSidebar,
  lerSidebarRecolhida,
  lerSidebarRecolhidaNoServidor,
} from '@/lib/sidebar-colapsada'
import { marcarSaida } from '@/lib/saida-de-pagina'
import {
  IconBag,
  IconBank,
  IconBell,
  IconBox,
  IconCalendar,
  IconChart,
  IconChevronDown,
  IconChevronLeft,
  IconClose,
  IconHeart,
  IconList,
  IconHelp,
  IconLogout,
  IconMenu,
  IconReceipt,
  IconSettings,
  IconShield,
  IconSparkles,
  IconStore,
  IconUsers,
  IconWallet,
  type IconProps,
} from '../Icons'
import styles from './AppShell.module.css'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<IconProps>
  /** Sub-itens: hoje usado apenas por Financeiro. */
  children?: { href: string; label: string }[]
}

/** Modulos do mapeamento (docs/ZapGestor_Apresentacao.pdf). */
const navItems: NavItem[] = [
  { href: '/app', label: 'Tela principal', icon: IconChart },
  { href: '/app/vendas', label: 'Vendas', icon: IconBag },
  { href: '/app/clientes', label: 'Clientes', icon: IconUsers },
  { href: '/app/produtos', label: 'Produtos', icon: IconBox },
  { href: '/app/fornecedores', label: 'Conexões', icon: IconStore },
  {
    href: '/app/financeiro',
    label: 'Financeiro',
    icon: IconWallet,
    children: [
      { href: '/app/financeiro/plano-de-contas', label: 'Plano de contas' },
      { href: '/app/financeiro/contas-a-pagar', label: 'Contas a pagar' },
      { href: '/app/financeiro/contas-a-receber', label: 'Contas a receber' },
      { href: '/app/financeiro/contas-bancarias', label: 'Contas bancárias' },
      { href: '/app/financeiro/conciliacao', label: 'Conciliação' },
      { href: '/app/financeiro/dre', label: 'DRE' },
      { href: '/app/financeiro/relatorios', label: 'Relatórios' },
    ],
  },
  { href: '/app/crm', label: 'CRM', icon: IconList },
  { href: '/app/agenda', label: 'Agenda', icon: IconCalendar },
  { href: '/app/empresa', label: 'Empresa', icon: IconSettings },
  { href: '/app/assistente-ia', label: 'Assistente IA', icon: IconSparkles },
  { href: '/app/assinatura', label: 'Assinatura', icon: IconReceipt },
  { href: '/app/suporte', label: 'Suporte', icon: IconBank },
]

/**
 * A secao da plataforma — NR-122, ADR-0007.
 *
 * Estas telas viviam num painel separado (`/admin`), com barra propria e um
 * desvio no login perguntando "para onde?". Duas casas para a mesma pessoa:
 * quem e dono E Super Admin tinha de escolher uma a cada entrada, e voltar
 * significava digitar endereco. Agora sao uma secao a mais da MESMA barra,
 * que so existe para quem tem o acesso.
 *
 * Fora desta lista, de proposito: Auditoria. Ela e por LOJA, e por isso mora
 * entre os modulos da loja — o Super Admin a ve depois de entrar numa.
 */
const itensDaPlataforma: NavItem[] = [
  { href: '/app/plataforma/cargos', label: 'Cargos e Super Admin', icon: IconShield },
  { href: '/app/plataforma/lista-vip', label: 'Lista de espera', icon: IconList },
  { href: '/app/plataforma/parceiros', label: 'Parceiros', icon: IconHeart },
]

/** Cadeado exibido ao lado dos modulos restritos. */
function IconLockSmall() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </svg>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  /* Recolhida so vale no desktop; no celular a barra ja e um painel que
     sobrepoe e some ao navegar. Ver `lib/sidebar-colapsada.ts`. */
  const recolhida = useSyncExternalStore(
    assinarSidebar,
    lerSidebarRecolhida,
    lerSidebarRecolhidaNoServidor,
  )
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [avisosAbertos, setAvisosAbertos] = useState(false)
  /* O sino balanca quando CHEGA aviso — nao quando some. Ver o efeito abaixo. */
  const sino = useRef<HTMLSpanElement>(null)
  const quantosAvisosAntes = useRef(0)
  const { bloqueado, pedirRegularizacao } = useSubscription()

  /* SUBSTITUIR POR: GET /suporte/chamados (ou contador dedicado) — hoje
     le do mock uma vez, no primeiro render. */
  /*
   * O badge do Suporte sai da MESMA lista do sino.
   *
   * Antes ele vinha de `totalNaoLidas(listarChamados())` com dados de mentira,
   * e agora sairia de uma segunda consulta — duas fontes para o mesmo numero
   * divergem no dia em que uma delas atrasar, e o lojista veria "2" na
   * navegacao e "3" no sino.
   */
  const naoLidas = avisos.find((a) => a.href === '/app/suporte')?.contagem ?? 0

  /* Financeiro comeca aberto quando a rota atual esta dentro dele. */
  const [financeiroAberto, setFinanceiroAberto] = useState(pathname.startsWith('/app/financeiro'))

  /* Fecha a navegacao ao trocar de rota no mobile. Ajuste durante o render
     (padrao recomendado do React) em vez de setState em efeito. */
  const [rotaAnterior, setRotaAnterior] = useState(pathname)
  if (rotaAnterior !== pathname) {
    setRotaAnterior(pathname)
    setNavOpen(false)
    /* O painel de avisos fecha junto: e um menu, e menu aberto sobre outra
       pagina e lixo visual que ninguem pediu. Aqui e nao num efeito — o
       arquivo ja trata troca de rota durante o render, que e o padrao
       recomendado do React e o que o lint cobra. */
    setAvisosAbertos(false)
    if (pathname.startsWith('/app/financeiro')) setFinanceiroAberto(true)
  }

  /*
   * Esc fecha o painel de navegacao no celular — NR-126.
   *
   * Ele cobre a tela inteira; sem isto a unica saida e acertar a faixa
   * estreita de fundo ao lado. Toda camada que sobrepoe o conteudo deve
   * fechar com Esc, e esta era a unica do painel que nao fechava.
   */
  useEffect(() => {
    if (!navOpen) return

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false)
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [navOpen])

  /*
   * O perfil e os avisos, uma vez na montagem.
   *
   * `async` explicito dentro do efeito: os `setState` vem todos DEPOIS do
   * await, nunca sincronos no corpo — e o que o compilador do React cobra.
   *
   * Os dois em paralelo e com falha silenciosa: nenhum deles e a razao de a
   * pessoa ter aberto a tela, e um erro de rede aqui nao pode impedir de vender.
   * O perfil que nao carrega deixa o esqueleto no lugar; o aviso que nao carrega
   * simplesmente nao aparece.
   */
  useEffect(() => {
    void (async () => {
      const [p, a] = await Promise.all([carregarPerfil(), carregarAvisos()])
      if (p.ok) setPerfil(p.dados)
      setAvisos(a)
    })()
  }, [])

  /*
   * O balanco do sino — NR-136.
   *
   * So para cima: de 2 para 3 avisos ele chama atencao, de 3 para 2 nao ha
   * novidade nenhuma para anunciar. Animado pela api do navegador, e nao por
   * estado, porque isto nao muda nada do que a tela mostra — e um gesto.
   *
   * Hoje os avisos chegam uma vez, na montagem: o balanco acontece quando eles
   * chegam. No dia em que houver busca periodica ou tempo real, ele passa a
   * acontecer a cada aviso novo, sem precisar mudar nada aqui.
   */
  useEffect(() => {
    const agora = avisos.length
    const subiu = agora > quantosAvisosAntes.current
    quantosAvisosAntes.current = agora

    if (!subiu || !sino.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    sino.current.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-15deg)' },
        { transform: 'rotate(15deg)' },
        { transform: 'rotate(-9deg)' },
        { transform: 'rotate(6deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 520, easing: 'ease-in-out' },
    )
  }, [avisos.length])

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

  /*
   * Auditoria so aparece para o dono — a mesma regra de `core`, repetida aqui
   * so para nao oferecer um item que responderia 403. Quem barra de verdade e
   * a api. O Super Admin dentro da loja entra como dono, e ve o item.
   */
  const itensDoMenu: NavItem[] =
    perfil?.role === 'owner'
      ? [
          ...navItems.slice(0, -2),
          { href: '/app/auditoria', label: 'Auditoria', icon: IconShield },
          ...navItems.slice(-2),
        ]
      : navItems

  const isActive = (href: string) =>
    href === '/app' ? pathname === href : pathname.startsWith(href)

  const isRestrito = (href: string) =>
    bloqueado &&
    (MODULOS_BLOQUEADOS as readonly string[]).some(
      (rota) => rota === href || rota.startsWith(`${href}/`),
    )

  function sair() {
    /* Nao espera a resposta: sair sempre "da certo" para quem clicou, e travar
       o botao numa rede ruim faria a pessoa clicar de novo achando que falhou.
       O cookie e httpOnly, entao quem o apaga e o servidor. */
    void encerrarSessao()
    router.push('/login')
  }

  /**
   * Sai do modo Super Admin — ADR-0007.
   *
   * Ao contrario de `sair`, ESPERA a resposta E confere se deu certo: aqui o
   * token continua o mesmo, e navegar antes de a sessao no servidor voltar ao
   * estado "sem empresa" levaria a `/admin` com a empresa anterior ainda
   * ativa. Numa falha o banner so continua na tela — a pessoa tenta de novo.
   */
  async function sairDoAdmin() {
    const r = await sairDoModoAdmin()
    if (r.ok) router.push('/app/plataforma/cargos')
  }

  /*
   * As telas que a busca oferece — NR-126.
   *
   * Sai do MESMO menu que a barra monta, ja filtrado por papel: `itensDoMenu`
   * so traz Auditoria para o dono, e a secao da plataforma so existe para
   * Super Admin. Uma lista propria aqui divergiria no dia em que um item
   * mudasse de lugar — e, pior, poderia revelar uma tela que a pessoa nao
   * abre, contando o que existe do outro lado da porta.
   */
  const telasParaBusca: TelaBuscavel[] = [
    ...itensDoMenu.flatMap<TelaBuscavel>((item) =>
      item.children === undefined
        ? [{ href: item.href, titulo: item.label }]
        : [
            { href: item.href, titulo: item.label },
            ...item.children.map((sub) => ({
              href: sub.href,
              titulo: sub.label,
              secao: item.label,
            })),
          ],
    ),
    ...(perfil?.isPlatformAdmin === true
      ? itensDaPlataforma.map<TelaBuscavel>((item) => ({
          href: item.href,
          titulo: item.label,
          secao: 'Plataforma',
        }))
      : []),
  ]

  return (
    <div className={`appTheme ${styles.shell} ${recolhida ? styles.shellRecolhido : ''}`}>
      {navOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          onClick={() => setNavOpen(false)}
          aria-label="Fechar navegação"
        />
      ) : null}

      <aside
        className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''} ${
          recolhida ? styles.sidebarRecolhida : ''
        }`}
        id="navegacao-painel"
      >
        {/*
          NAO e link para "/" — isso levaria pro site institucional, a unica
          saida do app que deveria existir e o botao de Sair. Clicar aqui so
          atualiza a tela atual, como um botao de refresh.
        */}
        <div className={styles.topoDaBarra}>
          <button type="button" className={styles.brand} onClick={() => router.refresh()}>
            <span className={styles.brandName}>{BRAND}</span>
          </button>

          {/*
            Recolher e so do desktop — o CSS o esconde no celular, onde a barra
            ja e um painel que sobrepoe e some ao navegar. `aria-expanded` diz
            o estado, e nao o rotulo: quem usa leitor de tela ouve "barra
            lateral, expandida" em vez de adivinhar o que a seta faz.
          */}
          <button
            type="button"
            className={styles.recolher}
            onClick={alternarSidebar}
            aria-expanded={!recolhida}
            aria-controls="navegacao-painel"
            aria-label={recolhida ? 'Expandir a barra lateral' : 'Recolher a barra lateral'}
            title={recolhida ? 'Expandir' : 'Recolher'}
          >
            <IconChevronLeft size={18} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Módulos do sistema">
          {itensDoMenu.map((item) => {
            const Icon = item.icon

            /* --- Item com submenu (Financeiro) --- */
            if (item.children) {
              return (
                /* Aberto, o grupo vira uma peca so — o botao e a lista dentro
                   da mesma moldura. Fechado, e um item como os outros. */
                <div
                  key={item.href}
                  className={`${styles.navGroup} ${financeiroAberto ? styles.navGroupAberto : ''}`}
                >
                  <button
                    type="button"
                    className={`${styles.navItem} ${styles.navToggle} ${
                      isActive(item.href) ? styles.navActive : ''
                    }`}
                    onClick={() => setFinanceiroAberto((v) => !v)}
                    aria-expanded={financeiroAberto}
                    data-tutorial={item.href}
                  >
                    <Icon size={18} />
                    <span className={styles.navLabel}>{item.label}</span>
                    <span
                      className={`${styles.navChevron} ${
                        financeiroAberto ? styles.navChevronOpen : ''
                      }`}
                    >
                      <IconChevronDown size={16} />
                    </span>
                  </button>

                  {financeiroAberto ? (
                    <div className={styles.subNav}>
                      {item.children.map((sub) =>
                        isRestrito(sub.href) ? (
                          <button
                            key={sub.href}
                            type="button"
                            className={`${styles.subItem} ${styles.navLocked}`}
                            onClick={pedirRegularizacao}
                          >
                            {sub.label}
                            <span className={styles.navLockIcon}>
                              <IconLockSmall />
                            </span>
                          </button>
                        ) : (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            className={`${styles.subItem} ${
                              pathname === sub.href ? styles.subActive : ''
                            }`}
                            onClick={() => marcarSaida(sub.href, pathname)}
                          >
                            {sub.label}
                          </Link>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              )
            }

            /* --- Modulo restrito: continua visivel, com cadeado --- */
            if (isRestrito(item.href)) {
              return (
                <button
                  key={item.href}
                  type="button"
                  className={`${styles.navItem} ${styles.navLocked}`}
                  onClick={pedirRegularizacao}
                >
                  <Icon size={18} />
                  <span className={styles.navLabel}>{item.label}</span>
                  <span className={styles.navLockIcon}>
                    <IconLockSmall />
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive(item.href) ? styles.navActive : ''}`}
                aria-current={isActive(item.href) ? 'page' : undefined}
                /* Avisa que a tela atual esta saindo — NR-133. O realce do
                   item nao espera nada disso: ele e do `isActive`, que muda no
                   mesmo quadro do clique. */
                onClick={() => marcarSaida(item.href, pathname)}
                data-tutorial={item.href}
                /* Recolhida, so o icone aparece: sem o `title` o hover nao
                   diria o nome de nada. O rotulo continua no DOM, escondido
                   por CSS, entao o leitor de tela segue lendo normalmente. */
                title={item.label}
              >
                <Icon size={18} />
                <span className={styles.navLabel}>{item.label}</span>
                {/* Respostas de suporte que a pessoa ainda nao viu */}
                {item.href === '/app/suporte' && naoLidas > 0 ? (
                  <span className={styles.navBadge} aria-label={`${naoLidas} resposta(s) nova(s)`}>
                    {naoLidas}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>

        {/* So aparece para quem tem o acesso — a api recusa de qualquer
            forma, mas um item que sempre responde 403 e ruido. */}
        {perfil?.isPlatformAdmin === true ? (
          <nav className={styles.nav} aria-label="Plataforma">
            <span className={styles.navSecao}>Plataforma</span>
            {itensDaPlataforma.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${isActive(item.href) ? styles.navActive : ''}`}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  onClick={() => marcarSaida(item.href, pathname)}
                >
                  <Icon size={18} />
                  <span className={styles.navLabel}>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        ) : null}

        {/*
          Ponto fixo de acesso aos documentos legais — RF-01.

          No rodape da barra, e nao como item de menu: a navegacao ja tem doze
          modulos, e um decimo terceiro item com o mesmo peso de "Vendas"
          diria que isto e um lugar onde se trabalha. Aqui fica sempre
          alcancavel e nunca no caminho.
        */}
        <Link href="/app/privacidade-e-termos" className={styles.navLegal}>
          Privacidade e Termos
        </Link>
      </aside>

      <div className={styles.main}>
        {/* Banner de "entrar como" Super Admin — some assim que a sessao
            volta ao estado normal, sem precisar de reload. */}
        {perfil?.isImpersonating === true ? (
          <div className={styles.adminBanner} role="status">
            <span className={styles.adminBannerText}>
              Você está vendo como Super Admin —{' '}
              <strong>{perfil.companyName ?? 'esta loja'}</strong>.
            </span>
            <button
              type="button"
              className={styles.adminBannerExit}
              onClick={() => void sairDoAdmin()}
            >
              Sair do modo Super Admin
            </button>
          </div>
        ) : null}

        {/* Aviso persistente de pagamento pendente. Fica no layout de /app,
            portanto aparece em qualquer sub-rota. */}
        {bloqueado ? <PaymentOverdueBanner /> : null}

        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-controls="navegacao-painel"
            aria-label={navOpen ? 'Fechar navegação' : 'Abrir navegação'}
          >
            {navOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
          </button>

          {/* O campo virou gatilho: a busca agora abre no centro da tela, e
              acha TELA alem de cliente, produto e venda. Ver BuscaSpotlight. */}
          <BuscaSpotlight telas={telasParaBusca} />

          <div className={styles.topActions}>
            <div className={styles.topActionsGroup} data-tutorial="tema-som">
              <ThemeToggle />
              <SomToggle />
            </div>

            <button
              type="button"
              className={styles.iconButton}
              onClick={iniciarTutorial}
              aria-label="Rever o tutorial guiado"
              title="Tutorial"
              data-tutorial="ajuda"
            >
              <IconHelp size={19} />
            </button>

            {/*
              O ponto so acende quando HA aviso.
              Antes ele era um <span> fixo no HTML: sempre aceso, em toda loja,
              desde o primeiro segundo. Aviso que nunca apaga deixa de ser
              aviso — quem o ve todo dia para de olhar.
            */}
            <div className={styles.avisosWrap} data-tutorial="notificacoes">
              <button
                type="button"
                className={styles.iconButton}
                aria-label={
                  avisos.length === 0
                    ? 'Notificações — nada pendente'
                    : `Notificações — ${avisos.length} pendente(s)`
                }
                aria-expanded={avisosAbertos}
                onClick={() => setAvisosAbertos((v) => !v)}
              >
                <span className={styles.sinoIcone} ref={sino}>
                  <IconBell size={19} />
                </span>
                {/* O numero, e nao so um ponto: "tem coisa" e menos util que
                    "tem tres coisas". A `key` faz o contador nascer de novo a
                    cada mudanca, e com ele a animacao de entrada. */}
                {avisos.length > 0 ? (
                  <span key={avisos.length} className={styles.contadorDeAvisos}>
                    {avisos.length}
                  </span>
                ) : null}
              </button>

              {avisosAbertos ? (
                <div className={styles.avisosPainel} role="dialog" aria-label="Notificações">
                  {avisos.length === 0 ? (
                    <p className={styles.avisoVazio}>Nada pendente por aqui.</p>
                  ) : (
                    <ul className={styles.avisosLista}>
                      {avisos.map((a) => (
                        <li key={a.href + a.texto}>
                          <Link
                            href={a.href}
                            className={styles.aviso}
                            onClick={() => setAvisosAbertos(false)}
                          >
                            <span
                              className={`${styles.avisoPonto} ${
                                a.tom === 'perigo' ? styles.avisoPerigo : styles.avisoAtencao
                              }`}
                              aria-hidden="true"
                            />
                            {a.texto}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>

            {/*
              Quem entrou, e nao um nome inventado.
              Enquanto o perfil nao chega, o espaco fica reservado com um
              esqueleto: trocar um nome por outro depois que a tela ja pintou
              faz o cabecalho pular, e um nome provisorio seria a mesma mentira
              de antes, so que por menos tempo.
            */}
            {perfil === null ? (
              <div className={styles.user}>
                <span className={`${styles.avatar} ${styles.avatarVazio}`} aria-hidden="true" />
                <span className={styles.userText} aria-hidden="true">
                  <span className={styles.esqueletoLinha} />
                  <span className={`${styles.esqueletoLinha} ${styles.esqueletoCurta}`} />
                </span>
              </div>
            ) : (
              <MenuDoUsuario
                nome={perfil.userName}
                empresa={perfil.companyName ?? 'Nenhuma loja selecionada'}
                iniciais={iniciaisDe(perfil.userName)}
                aoSair={sair}
              />
            )}

            <button type="button" className={styles.iconButton} onClick={sair} aria-label="Sair">
              <IconLogout size={19} />
            </button>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>

      <PaymentRequiredModal />

      <Tutorial
        navAberto={navOpen}
        abrirNav={() => setNavOpen(true)}
        fecharNav={() => setNavOpen(false)}
      />
    </div>
  )
}
