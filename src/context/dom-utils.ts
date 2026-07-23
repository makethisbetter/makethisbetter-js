const WIDGET_HOST_ID = 'mtb-widget-host'

export function isWidgetElement(el: Element): boolean {
  const host = document.getElementById(WIDGET_HOST_ID)
  if (!host) return false
  return host === el || host.contains(el)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
