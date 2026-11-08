import { useState } from 'react'
import { assetUrl } from '../lib/assets'

/** Image Valorant (agent, map, arme, rang) ; disparaît proprement si elle n'est pas dispo */
export default function VImg({
  src,
  className,
  title,
  fallback = null
}: {
  src?: string | null
  className?: string
  title?: string
  fallback?: JSX.Element | null
}): JSX.Element | null {
  const [failed, setFailed] = useState<string | null>(null)
  const url = assetUrl(src)
  if (!url || failed === url) return fallback
  return <img className={className} src={url} alt="" title={title} draggable={false} onError={() => setFailed(url)} />
}
