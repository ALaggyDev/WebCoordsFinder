import { useEffect, useState } from 'react'
import { loadImage } from '../domain/imageAnalysis'

/**
 * Resolves a canvas-ready image and ignores stale completions when the source
 * changes or the consuming component unmounts.
 */
export function useCanvasImage(source: string): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>()

  useEffect(() => {
    let active = true
    // Clearing first prevents the preceding project image from flashing while
    // the replacement is still decoding.
    setImage(undefined)
    loadImage(source)
      .then((loaded) => {
        if (active) setImage(loaded)
      })
      .catch(() => {
        if (active) setImage(undefined)
      })
    return () => {
      active = false
    }
  }, [source])

  return image
}
