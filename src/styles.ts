export const BRAND_COLOR = '#059669'
// Same green as BRAND_COLOR, in the form shadows need. Derived once so a brand
// change cannot leave the shadows on the old colour.
const BRAND_RGB = '5,150,105'

export function brandAlpha(alpha: number): string {
  return `rgba(${BRAND_RGB},${alpha})`
}

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const DRAW_STROKE = {
  color: 'var(--mtb-brand-primary)',
  width: '3.5',
  linecap: 'round',
  linejoin: 'round',
  filter: 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.95)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.72))',
} as const
