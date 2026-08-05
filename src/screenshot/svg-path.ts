// The draw layer only ever emits M/L polyline commands (see buildPathD in
// annotate/draw.ts); anything else in the string is ignored.
export function parsePathPolylines(drawPath: string): Array<Array<[number, number]>> {
  const polylines: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> | null = null
  const tokens = drawPath.match(/[ML]\s*[-\d.]+\s+[-\d.]+/g) ?? []
  for (const token of tokens) {
    const [x, y] = token.slice(1).trim().split(/\s+/).map(Number)
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    if (token[0] === 'M') {
      current = [[x, y]]
      polylines.push(current)
    } else if (current) {
      current.push([x, y])
    }
  }
  return polylines
}

// Rebuilt from the parsed polylines so this module stays the single reader of
// the path grammar. Tokens the parser ignores are dropped, which is safe
// because every consumer reads the translated path through that same parser.
export function translatePathD(drawPath: string, dx: number, dy: number): string {
  return parsePathPolylines(drawPath)
    .map(points =>
      points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x + dx} ${y + dy}`).join(' '),
    )
    .join(' ')
}
