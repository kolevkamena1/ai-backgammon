export type BoardDesignId = 'levantine' | 'lucite' | 'bridle' | 'coastal' | 'artdeco'

export interface BoardDesign {
  readonly id: BoardDesignId
  readonly name: string
  readonly subtitle: string
  readonly swatches: readonly [string, string, string]
}

export const DEFAULT_BOARD_DESIGN: BoardDesignId = 'levantine'

export const BOARD_DESIGNS: readonly BoardDesign[] = [
  {
    id: 'levantine',
    name: 'Damascus Pearl',
    subtitle: 'Walnut marquetry & mother-of-pearl inlay',
    swatches: ['#4a2e1b', '#c89d66', '#f7f1e1'],
  },
  {
    id: 'lucite',
    name: 'Crystal Lucite',
    subtitle: 'Clear architectural acrylic & frosted glass',
    swatches: ['#e8dfd1', '#ffffff', '#52555a'],
  },
  {
    id: 'bridle',
    name: 'Savile Bridle',
    subtitle: 'Saddle-stitched cognac leather & taupe suede',
    swatches: ['#8c4a20', '#a39281', '#ede3cf'],
  },
  {
    id: 'coastal',
    name: 'Aegean Tide',
    subtitle: 'Mediterranean olive wood & ocean wave resin',
    swatches: ['#b57c3e', '#0f4c9c', '#7fd4c4'],
  },
  {
    id: 'artdeco',
    name: 'Gatsby Deco',
    subtitle: 'Black & white veined marble with brushed brass',
    swatches: ['#18191c', '#d1b46a', '#f2efe9'],
  },
]

export function isBoardDesignId(value: unknown): value is BoardDesignId {
  return (
    typeof value === 'string' && BOARD_DESIGNS.some((design) => design.id === value)
  )
}

