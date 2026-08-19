import type { ReactNode } from 'react'
import type { AppPath, InfoPath } from '../domain/appRoutes'


interface InfoPageProps {
  path: InfoPath
  onNavigate: (path: AppPath) => void
}

interface InfoPageContent {
  title: string
  body: ReactNode
}

const pages: Record<InfoPath, InfoPageContent> = {
  '/info/what-is-this': {
    title: 'What is this?',
    body: (
      <>
        <p>WebCoordsFinder is a website for analyzing Minecraft&apos;s texture rotations from a screenshot and using it to find the coordinates of the screenshot.</p>
        <p>Some Minecraft blocks pick a texture rotation or mirror from their world position (colloquially called &ldquo;texture rotations&rdquo;). If enough visible block faces are labelled, those patterns can be used to search for the screenshot location.</p>
        <p>With WebCoordsFinder, you can find coordinates of a screenshot in less than 10 minutes!</p>
        <p>Check out my video for info:</p>
        <div className="info-video-placeholder">TODO: Add YouTube video embed</div>
      </>
    ),
  },
  '/info/how-to-use': {
    title: 'How to use it',
    body: (
      <>
        <p>This website is simple to use once you get the hang of it. The gist is as follows:</p>
        <ol className="info-steps">
        <li>
          <span>1</span>
          <div>
            <h2>Open a screenshot</h2>
            <p>Start a project with a Minecraft screenshot that has clear, visible block faces.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h2>Build the visible geometry</h2>
            <p>Draw the first block-aligned surface, then extrude its edges to add connected faces.</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h2>Set the orientation and anchor</h2>
            <p>Tell the editor which way is up, choose a horizontal direction, and anchor one block at zero.</p>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <h2>Confirm face variants</h2>
            <p>Choose the block type and visible texture variant for useful faces. Review automatic suggestions before using them.</p>
          </div>
        </li>
        <li>
          <span>5</span>
          <div>
            <h2>Search or export</h2>
            <p>Run the local browser search for a smaller scan, or export a CoordsFinder config for the native scanner.</p>
          </div>
        </li>
        </ol>
        <p className="info-todo">TODO: Write in more details</p>
      </>
    ),
  },
  '/info/faq': {
    title: 'FAQ',
    body: (
      <>
        <div className="info-faq-list">
          <details>
          <summary>Which blocks have texture rotations?</summary>
          <p>
            Here&apos;s a list of blocks that have &ldquo;texture rotations&rdquo;,
            as of Minecraft 1.21.11. Note that I may have missed some blocks,
            and I haven&apos;t tested all of them.
          </p>
          <ul>
            <li>Grass block</li>
            <li>Rooted dirt</li>
            <li>Dirt</li>
            <li>Dirt path</li>
            <li>Stone and infested stone, with side face variants</li>
            <li>Deepslate and infested deepslate, with side face variants</li>
            <li>Bedrock, with side face variants</li>
            <li>Sculk, with side face variants</li>
            <li>Podzol</li>
            <li>Mycelium</li>
            <li>Sand</li>
            <li>Red sand</li>
            <li>All 16 colors of concrete powder</li>
            <li>Lily pad</li>
            <li>Sea pickle?</li>
            <li>Turtle egg?</li>
            <li>Netherrack (not supported yet, since it has 16 variants)</li>
          </ul>
          <p>
            Flower random offsets are not part of the texture rotation
            algorithm (block variant model), but are instead hard-coded into
            the game. I will be looking into it in the future.
          </p>
          </details>
          <details>
          <summary>What makes a useful screenshot?</summary>
          <p>Clear, unedited screenshots with many visible faces work best. More independent faces usually give the search more useful evidence.</p>
          </details>
          <details>
          <summary>Can I come back to a project later?</summary>
          <p>Yes. Projects are saved in this browser, and you can also export a portable project bundle to keep a copy elsewhere.</p>
          </details>
          <details>
          <summary>Should I use the built-in scanner or export a CoordsFinder config?</summary>
          <p>The built-in browser scanner is convenient for smaller searches, but is slower. Exporting is better when you want to use the faster CoordsFinder CPU or CUDA scanner.</p>
          </details>
          <details>
          <summary>I don&apos;t have an Nvidia GPU and the CPU scan takes so long. What should I do?</summary>
          <p>Google Colab offers a Nvidia Tesla T4 GPU for free. You can use the notebook here once the link is added.</p>
          <p className="info-todo">TODO: Add Google Colab notebook link</p>
          </details>
          <details>
          <summary>What is the difference between WebCoordsFinder and CoordsFinder?</summary>
          <p>
            WebCoordsFinder is a web-based app. It allows users to upload a
            screenshot, draw the grid, mark the texture rotations, and either
            perform the scan on the app or download a config file to use in
            CoordsFinder. It is a convenient way to generate a config file
            without having to painstakingly mark and write it by hand.
          </p>
          <p>
            CoordsFinder is a command-line tool that performs the actual
            brute-force search. It supports CUDA and is much faster than the
            built-in WebCoordsFinder scanner.
          </p>
          <p>In short: start with WebCoordsFinder, then either use the built-in scanner or CoordsFinder.</p>
          </details>
        </div>
      </>
    ),
  },
}

export function InfoPage({ path, onNavigate }: InfoPageProps) {
  const page = pages[path]

  return (
    <main className="info-page">
      <article className="info-page-content">
        <h1>{page.title}</h1>
        <div className="info-page-body">{page.body}</div>
        <button className="secondary-button info-back-button" type="button" onClick={() => onNavigate('/')}>
          Back to editor
        </button>
      </article>
    </main>
  )
}
