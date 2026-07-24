import { useEffect, useState } from 'react'
import { loadImage } from '../domain/imageAnalysis'

export function useCanvasImage(source: string): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>()

  useEffect(() => {
    let active = true
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
