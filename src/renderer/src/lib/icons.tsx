/**
 * Every interface icon in Frag comes from one library, Phosphor (MIT), through this file.
 * Components keep their own names (Check, Search, Loader2...), so swapping the set again
 * only touches this file. Each icon carries the `icon` class: styles.css sizes them all.
 */
import type { CSSProperties } from 'react'
import type { Icon as PhIcon, IconWeight } from '@phosphor-icons/react'
import {
  ArrowClockwise as PhArrowClockwise,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowLineLeft as PhArrowLineLeft,
  ArrowLineRight as PhArrowLineRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUp as PhArrowUp,
  ArrowsClockwise as PhArrowsClockwise,
  ArrowsOut as PhArrowsOut,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  ChartBar as PhChartBar,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CircleNotch as PhCircleNotch,
  Clock as PhClock,
  Crosshair as PhCrosshair,
  DownloadSimple as PhDownloadSimple,
  FileVideo as PhFileVideo,
  FilmSlate as PhFilmSlate,
  FilmStrip as PhFilmStrip,
  Flag as PhFlag,
  FolderOpen as PhFolderOpen,
  GearSix as PhGearSix,
  Gift as PhGift,
  Key as PhKey,
  Keyboard as PhKeyboard,
  LinkBreak as PhLinkBreak,
  LinkSimple as PhLinkSimple,
  MagicWand as PhMagicWand,
  Magnet as PhMagnet,
  MagnifyingGlass as PhMagnifyingGlass,
  MagnifyingGlassMinus as PhMagnifyingGlassMinus,
  MagnifyingGlassPlus as PhMagnifyingGlassPlus,
  Pause as PhPause,
  Play as PhPlay,
  PlugsConnected as PhPlugsConnected,
  Plus as PhPlus,
  Prohibit as PhProhibit,
  Repeat as PhRepeat,
  Scan as PhScan,
  Scissors as PhScissors,
  ShieldCheck as PhShieldCheck,
  SkipBack as PhSkipBack,
  SkipForward as PhSkipForward,
  SpeakerHigh as PhSpeakerHigh,
  SpeakerSlash as PhSpeakerSlash,
  Square as PhSquare,
  Star as PhStar,
  Trash as PhTrash,
  UserPlus as PhUserPlus,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  X as PhX
} from '@phosphor-icons/react'

export interface IconProps {
  size?: number | string
  className?: string
  style?: CSSProperties
  /** bold weight, for the few places that drew a thicker stroke */
  strokeWidth?: number
  /** any fill other than "none" draws the filled weight (a starred favourite) */
  fill?: string
  'aria-hidden'?: boolean
}

function make(Glyph: PhIcon): (props: IconProps) => JSX.Element {
  const Wrapped = ({ className, strokeWidth, fill, ...rest }: IconProps): JSX.Element => {
    const weight: IconWeight = fill && fill !== 'none' ? 'fill' : strokeWidth && strokeWidth >= 2.5 ? 'bold' : 'regular'
    return <Glyph weight={weight} className={`icon${className ? ` ${className}` : ''}`} aria-hidden {...rest} />
  }
  return Wrapped
}

export const AlertCircle = make(PhWarningCircle)
export const AlertTriangle = make(PhWarning)
export const ArrowDown = make(PhArrowDown)
export const ArrowUp = make(PhArrowUp)
export const Ban = make(PhProhibit)
export const BarChart3 = make(PhChartBar)
export const Check = make(PhCheck)
export const CheckCircle2 = make(PhCheckCircle)
export const ChevronLeft = make(PhCaretLeft)
export const ChevronRight = make(PhCaretRight)
export const Clapperboard = make(PhFilmSlate)
export const Clock = make(PhClock)
export const Download = make(PhDownloadSimple)
export const ExternalLink = make(PhArrowSquareOut)
export const FileVideo = make(PhFileVideo)
export const Film = make(PhFilmStrip)
export const FolderOpen = make(PhFolderOpen)
export const Keyboard = make(PhKeyboard)
export const Loader2 = make(PhCircleNotch)
export const Magnet = make(PhMagnet)
export const Maximize2 = make(PhArrowsOut)
export const Pause = make(PhPause)
export const Play = make(PhPlay)
export const PlugZap = make(PhPlugsConnected)
export const Plus = make(PhPlus)
export const RefreshCw = make(PhArrowsClockwise)
export const Repeat = make(PhRepeat)
export const RotateCcw = make(PhArrowCounterClockwise)
export const Scissors = make(PhScissors)
export const Search = make(PhMagnifyingGlass)
export const Settings = make(PhGearSix)
export const ShieldCheck = make(PhShieldCheck)
/** "What's new": a gift, not sparkles */
export const Sparkles = make(PhGift)
export const Square = make(PhSquare)
export const Star = make(PhStar)
export const Trash2 = make(PhTrash)
export const UserPlus = make(PhUserPlus)
export const X = make(PhX)
export const ZoomIn = make(PhMagnifyingGlassPlus)
export const ZoomOut = make(PhMagnifyingGlassMinus)
export const ArrowLeftToLine = make(PhArrowLineLeft)
export const ArrowRightToLine = make(PhArrowLineRight)
export const ChevronDown = make(PhCaretDown)
export const Crosshair = make(PhCrosshair)
export const Flag = make(PhFlag)
export const KeyRound = make(PhKey)
export const Link2 = make(PhLinkSimple)
export const Redo2 = make(PhArrowClockwise)
export const ScanSearch = make(PhScan)
export const StepBack = make(PhSkipBack)
export const StepForward = make(PhSkipForward)
export const Undo2 = make(PhArrowCounterClockwise)
export const Unlink = make(PhLinkBreak)
export const Volume2 = make(PhSpeakerHigh)
export const VolumeX = make(PhSpeakerSlash)
export const Wand2 = make(PhMagicWand)
