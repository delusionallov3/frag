import { useAssets } from '../lib/assets'
import VImg from './VImg'

/** Spike: official icon from valorant-api.com, with a drawn fallback */
export default function SpikeIcon({ size = 14, className }: { size?: number; className?: string }): JSX.Element {
  const spike = useAssets((s) => s.assets?.spike)
  const drawn = (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.2 12.6 4v8L8 14.8 3.4 12V4Z" fill="currentColor" opacity="0.28" />
      <path d="M8 1.2 12.6 4v8L8 14.8 3.4 12V4Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 4.6v6.8M5.6 6.2v3.6M10.4 6.2v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
  return (
    <span className={`spike-icon ${className ?? ''}`} style={{ width: size, height: size }}>
      <VImg src={spike} className="spike-img" fallback={drawn} />
    </span>
  )
}
