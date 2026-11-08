import type { MotionOptions, MotionStyle } from './types'

/** What a motion montage looks like before the user changes anything */
export const DEFAULT_MOTION: MotionOptions = {
  style: 'broadcast',
  accent: '#ff4655',
  intro: true,
  lobby: 'outro',
  names: true,
  lowerThirds: true,
  scoreBug: true,
  wipeLabels: true,
  punch: 'soft',
  slowmo: true,
  music: null,
  musicVolume: 0.6
}

/** Accent colours offered in the recap window */
export const MOTION_ACCENTS = ['#ff4655', '#ededed', '#5cf2c0', '#e8c060', '#4f8cff'] as const

export const MOTION_STYLES: MotionStyle[] = ['clean', 'broadcast', 'kinetic']

/** Scene lengths (s), shared by the export and the live preview */
export const MOTION_TIMES = { intro: 4.6, lobby: 6, wipe: 0.9 } as const
