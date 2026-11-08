import type { FragApi } from './index'

declare global {
  interface Window {
    frag: FragApi
  }
}

export {}
