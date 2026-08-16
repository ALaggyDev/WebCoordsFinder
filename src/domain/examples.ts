import { readProjectBundle } from './projectBundle'

// Bundled examples are portable project files. Adding another example only
// requires a catalog entry and its .wcf asset; importing always creates an
// ordinary, independently saved local project.
export const exampleProjects = [
  {
    id: 'dark-cave',
    name: 'Dark Cave',
    description: 'A dark cave, duh.\n\nLocation: (-135, -27, -578)',
    bundleSrc: '/examples/dark-cave.wcf',
  },
  {
    id: 'bright-cavern',
    name: 'Bright Cavern',
    description: 'A cavern with fullbright.\n\nLocation: (1564, -45, -1230)',
    bundleSrc: '/examples/bright-cavern.wcf',
  },
  {
    id: 'doughnut-smp-easy-',
    name: 'Doughnut SMP (Easy)',
    description: 'DumbKid67 shared this screenshot of his base on Doughnut SMP🔥! Can you find the coordinates?\n\nLocation: (197325, -50, -219011)',
    bundleSrc: '/examples/doughnut-smp-easy-.wcf',
  },
  {
    id: 'doughnut-smp-hard-',
    name: 'Doughnut SMP (Hard)',
    description: 'Same as the easy version, but now the screenshot is more close up.\n\nHint: You may want to start with the center of the image to fit the camera and work your way outwards.\nLocation: (197325, -50, -219011)',
    bundleSrc: '/examples/doughnut-smp-hard-.wcf',
  }
] as const

export type ExampleProjectId = (typeof exampleProjects)[number]['id']

export async function loadExampleProject(id: ExampleProjectId) {
  const example = exampleProjects.find((candidate) => candidate.id === id)
  if (!example) throw new Error('Example project unavailable.')
  const response = await fetch(example.bundleSrc)
  if (!response.ok) throw new Error('Example project unavailable.')
  return readProjectBundle(await response.blob())
}
