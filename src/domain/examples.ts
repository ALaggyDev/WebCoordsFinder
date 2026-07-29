// Examples are catalog entries rather than startup state: importing one
// creates an ordinary, independently saved local project.
export const exampleProjects = [
  {
    id: 'cavern',
    name: 'Example cavern',
    description:
      'A calibrated 6 × 4 floor plane in a large deepslate cavern.',
    imageSrc: '/demo/demo.png',
    imageName: 'Example cavern screenshot',
    imageMime: 'image/png',
  },
] as const

export type ExampleProjectId = (typeof exampleProjects)[number]['id']
