import { readProjectBundle } from './projectBundle'

// Bundled examples are portable project files. Adding another example only
// requires a catalog entry and its .wcf asset; importing always creates an
// ordinary, independently saved local project.
export const exampleProjects = [
  {
    id: 'dark-cave',
    name: 'Dark Cave',
    description: '',
    bundleSrc: '/examples/dark-cave.wcf',
  },
  {
    id: 'bright-cavern',
    name: 'Bright Cavern',
    description: '',
    bundleSrc: '/examples/bright-cavern.wcf',
  },
] as const

export type ExampleProjectId = (typeof exampleProjects)[number]['id']

export async function loadExampleProject(id: ExampleProjectId) {
  const example = exampleProjects.find((candidate) => candidate.id === id)
  if (!example) throw new Error('Example project unavailable.')
  const response = await fetch(example.bundleSrc)
  if (!response.ok) throw new Error('Example project unavailable.')
  return readProjectBundle(await response.blob())
}
