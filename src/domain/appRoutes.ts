export type InfoPath = '/info/what-is-this' | '/info/how-to-use' | '/info/faq'

export type AppPath = '/' | InfoPath

const infoPaths = new Set<InfoPath>([
  '/info/what-is-this',
  '/info/how-to-use',
  '/info/faq',
])

export function appPathFromLocation(pathname: string): AppPath {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return infoPaths.has(normalized as InfoPath) ? (normalized as InfoPath) : '/'
}
