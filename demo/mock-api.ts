const MOCK_API_PATH = '/__mtb_mock/api/v1/'

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
}

export function isDemoApiRequest(input: RequestInfo | URL, pageUrl = window.location.href): boolean {
  const url = new URL(requestUrl(input), pageUrl)
  const mockApiUrl = new URL(MOCK_API_PATH, pageUrl)

  return url.origin === mockApiUrl.origin && url.pathname.startsWith(mockApiUrl.pathname)
}
