/**
 * Conjunto de icones outline/minimalista.
 * Todos herdam a cor do texto (`currentColor`), entao a coloracao vem
 * sempre dos tokens de design aplicados no elemento pai.
 */

export type IconProps = {
  size?: number
  className?: string
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className,
  }
}

export function IconBag({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5.8 8h12.4l-1 12.2H6.8L5.8 8Z" />
      <path d="M9.4 8V6.4a2.6 2.6 0 0 1 5.2 0V8" />
    </svg>
  )
}

export function IconWallet({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <path d="M20 11h-3.4a1.6 1.6 0 0 0 0 3.2H20" />
    </svg>
  )
}

export function IconBox({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <path d="M4 8l8 4.5L20 8" />
      <path d="M12 12.5V21" />
    </svg>
  )
}

export function IconReceipt({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4v-17Z" />
      <path d="M9.5 8.5h5" />
      <path d="M9.5 12.5h5" />
    </svg>
  )
}

export function IconSparkles({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M11 4.5 12.6 9l4.4 1.6-4.4 1.6L11 16.6 9.4 12.2 5 10.6 9.4 9 11 4.5Z" />
      <path d="M18 14.5l.65 1.85L20.5 17l-1.85.65L18 19.5l-.65-1.85L15.5 17l1.85-.65L18 14.5Z" />
    </svg>
  )
}

export function IconChart({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 4.5V19h15.5" />
      <path d="M8 16v-3.5" />
      <path d="M12.5 16V8.5" />
      <path d="M17 16v-6" />
    </svg>
  )
}

export function IconTrendUp({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
      <path d="M15 7h5v5" />
    </svg>
  )
}

export function IconCheck({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </svg>
  )
}

export function IconArrowRight({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

export function IconArrowLeft({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12h14" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  )
}

export function IconMenu({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

export function IconClose({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

export function IconChevronDown({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  )
}

/** Recolher a barra lateral — NR-126. */
export function IconChevronLeft({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14.5 6l-6 6 6 6" />
    </svg>
  )
}

export function IconShield({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3.5l7 2.8v5.4c0 4-2.9 7.4-7 8.8-4.1-1.4-7-4.8-7-8.8V6.3l7-2.8Z" />
      <path d="M9.2 12.2 11 14l3.8-3.8" />
    </svg>
  )
}

export function IconBolt({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M13.2 3 6 13.6h5.1L10.8 21 18 10.4h-5.1L13.2 3Z" />
    </svg>
  )
}

export function IconUsers({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="9.2" cy="8.2" r="3.4" />
      <path d="M3.2 19.4c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2" />
      <path d="M16.4 5.2a3.4 3.4 0 0 1 0 6" />
      <path d="M17.6 14.6c1.9.6 3.2 2.2 3.2 4.4" />
    </svg>
  )
}

export function IconStore({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.2 9.6 6 4.5h12l1.8 5.1" />
      <path d="M5.4 9.6V20h13.2V9.6" />
      <path d="M4.2 9.6h15.6" />
      <path d="M9.6 20v-5.4h4.8V20" />
    </svg>
  )
}

export function IconHome({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 10.5 12 4l8 6.5V20H4v-9.5Z" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  )
}

export function IconUtensils({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M7.5 3.5v6a2 2 0 0 0 4 0v-6" />
      <path d="M9.5 11.5V20.5" />
      <path d="M16.6 20.5V3.5c1.8 1.7 2.5 4.3 2 7-.3 1.5-1 2.3-2 2.5" />
    </svg>
  )
}

export function IconHeart({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 20s-7-4.3-7-9.1A4 4 0 0 1 12 8.2a4 4 0 0 1 7 2.7C19 15.7 12 20 12 20Z" />
    </svg>
  )
}

export function IconShirt({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8.6 3.6 5 5.7l1.9 4 1.7-.9V20.4h6.8V8.8l1.7.9 1.9-4-3.6-2.1" />
      <path d="M8.6 3.6c.5 1.6 1.8 2.5 3.4 2.5s2.9-.9 3.4-2.5" />
    </svg>
  )
}

export function IconQuote({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9.5 6C7 7.5 5.8 9.6 5.8 12.3V18h5.7v-5.7H8.4c0-1.8.6-3.2 2.2-4.3L9.5 6Z" />
      <path d="M18.2 6c-2.5 1.5-3.7 3.6-3.7 6.3V18h5.7v-5.7h-3.1c0-1.8.6-3.2 2.2-4.3L18.2 6Z" />
    </svg>
  )
}

export function IconBell({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6.2 9.6a5.8 5.8 0 0 1 11.6 0c0 3.9 1.2 5.4 2 6.4H4.2c.8-1 2-2.5 2-6.4Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function IconSearch({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 20 20" />
    </svg>
  )
}

export function IconBarcode({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7V5.5h2.5" />
      <path d="M20 7V5.5h-2.5" />
      <path d="M4 17v1.5h2.5" />
      <path d="M20 17v1.5h-2.5" />
      <path d="M8 8.5v7" />
      <path d="M11 8.5v7" />
      <path d="M14 8.5v7" />
      <path d="M16.5 8.5v7" />
    </svg>
  )
}

export function IconCalendar({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M4 10h16" />
      <path d="M8.5 3.5v4" />
      <path d="M15.5 3.5v4" />
    </svg>
  )
}

export function IconBank({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3.5 9.5 12 4.5l8.5 5" />
      <path d="M5.5 9.5v8" />
      <path d="M10 9.5v8" />
      <path d="M14 9.5v8" />
      <path d="M18.5 9.5v8" />
      <path d="M3.5 20h17" />
    </svg>
  )
}

export function IconList({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 6.5h11" />
      <path d="M9 12h11" />
      <path d="M9 17.5h11" />
      <path d="M4.5 6.5h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 17.5h.01" />
    </svg>
  )
}

export function IconSettings({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1Z" />
    </svg>
  )
}

export function IconPlus({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </svg>
  )
}

export function IconFilter({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 6h16l-6.2 7.3v5.2l-3.6 1.8v-7L4 6Z" />
    </svg>
  )
}

export function IconUpload({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 15.5V4.5" />
      <path d="M8 8.5 12 4.5l4 4" />
      <path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
    </svg>
  )
}

export function IconLogout({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14.5 5.5H17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2.5" />
      <path d="M10 8.5 6.5 12l3.5 3.5" />
      <path d="M6.5 12H15" />
    </svg>
  )
}

export function IconTrash({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
    </svg>
  )
}

/** O sol: tema claro esta ATIVO, tocar troca para o escuro. */
export function IconSun({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  )
}

/** A lua: tema escuro esta ATIVO, tocar troca para o claro. */
export function IconMoon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z" />
    </svg>
  )
}

/** Som ligado: alto-falante com ondas. */
export function IconSom({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4v-5Z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
      <path d="M17.3 6.7a7.5 7.5 0 0 1 0 10.6" />
    </svg>
  )
}

/** Som desligado: alto-falante com um X. */
export function IconSomMudo({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4v-5Z" />
      <path d="M15.5 10 19 13.5" />
      <path d="M19 10 15.5 13.5" />
    </svg>
  )
}

/** Ajuda: circulo com interrogacao — abre o tutorial guiado. */
export function IconHelp({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 .8-1 1.6" />
      <path d="M12 17v.1" />
    </svg>
  )
}
