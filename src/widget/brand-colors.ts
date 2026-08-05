import type { MakeThisBetterConfig, WidgetBrandColors } from '../types'

export type { WidgetBrandColors } from '../types'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function resolveBrandColors(
  colors: MakeThisBetterConfig['brandColors'],
): WidgetBrandColors | undefined {
  if (colors === undefined) return undefined

  if (typeof colors !== 'object' || colors === null) return rejectBrandColors()

  const values = [colors.primary, colors.hover, colors.active, colors.onPrimary]
  if (!values.every((color) => typeof color === 'string' && HEX_COLOR.test(color))) {
    return rejectBrandColors()
  }

  return {
    primary: colors.primary.toLowerCase(),
    hover: colors.hover.toLowerCase(),
    active: colors.active.toLowerCase(),
    onPrimary: colors.onPrimary.toLowerCase(),
  }
}

function rejectBrandColors(): undefined {
  console.warn(
    '[MakeThisBetter] brandColors requires primary, hover, active, and onPrimary as six-digit hex colors.',
  )
  return undefined
}
