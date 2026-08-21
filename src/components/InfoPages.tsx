import type { ComponentType } from 'react'
import type { AppPath, InfoPath } from '../domain/appRoutes'
import Faq from '../content/info/faq.mdx'
import HowToUse from '../content/info/how-to-use.mdx'
import WhatIsThis from '../content/info/what-is-this.mdx'


interface InfoPageProps {
  path: InfoPath
  onNavigate: (path: AppPath) => void
}

const pages: Record<InfoPath, ComponentType> = {
  '/info/what-is-this': WhatIsThis,
  '/info/how-to-use': HowToUse,
  '/info/faq': Faq,
}

export function InfoPage({ path, onNavigate }: InfoPageProps) {
  const Page = pages[path]

  return (
    <main className="info-page">
      <article className="info-page-content">
        <div className="info-page-body"><Page /></div>
        <button className="secondary-button info-back-button" type="button" onClick={() => onNavigate('/')}>
          Back to editor
        </button>
      </article>
    </main>
  )
}
