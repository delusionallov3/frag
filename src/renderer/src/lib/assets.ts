import { create } from 'zustand'
import type { AgentAsset, MapAsset, TierAsset, ValAssets, WeaponAsset } from '@shared/types'

/** Images go through the app's local cache (works offline once downloaded) */
export const assetUrl = (u?: string | null): string | null => (u ? `frag-media://asset/?u=${encodeURIComponent(u)}` : null)

interface Index {
  agents: Map<string, AgentAsset>
  maps: Map<string, MapAsset>
  weapons: Map<string, WeaponAsset>
  tiers: Map<number, TierAsset>
}

interface AssetState {
  assets: ValAssets | null
  index: Index | null
  load: () => Promise<void>
  refresh: () => Promise<string | null>
}

const key = (s?: string | null): string => (s ?? '').trim().toLowerCase()

function buildIndex(a: ValAssets): Index {
  const agents = new Map<string, AgentAsset>()
  for (const x of a.agents) {
    agents.set(key(x.uuid), x)
    agents.set(key(x.name), x)
  }
  const maps = new Map<string, MapAsset>()
  for (const x of a.maps) {
    maps.set(key(x.uuid), x)
    maps.set(key(x.name), x)
  }
  const weapons = new Map<string, WeaponAsset>()
  for (const x of a.weapons) {
    weapons.set(key(x.uuid), x)
    weapons.set(key(x.name), x)
  }
  const tiers = new Map<number, TierAsset>()
  for (const t of a.tiers) tiers.set(t.tier, t)
  return { agents, maps, weapons, tiers }
}

export const useAssets = create<AssetState>((set, get) => ({
  assets: null,
  index: null,
  load: async () => {
    if (get().assets) return
    const assets = await window.frag.assets()
    if (assets) set({ assets, index: buildIndex(assets) })
  },
  refresh: async () => {
    const { assets, error } = await window.frag.refreshAssets()
    if (assets) set({ assets, index: buildIndex(assets) })
    return error
  }
}))

export function useLookup(): {
  agent: (id?: string | null, name?: string | null) => AgentAsset | null
  map: (id?: string | null, name?: string | null) => MapAsset | null
  weapon: (id?: string | null, name?: string | null) => WeaponAsset | null
  tier: (n?: number | null, name?: string | null) => TierAsset | null
} {
  const index = useAssets((s) => s.index)
  return {
    agent: (id, name) => index?.agents.get(key(id)) ?? index?.agents.get(key(name)) ?? null,
    map: (id, name) => index?.maps.get(key(id)) ?? index?.maps.get(key(name)) ?? null,
    weapon: (id, name) => index?.weapons.get(key(id)) ?? index?.weapons.get(key(name)) ?? null,
    // By rank number, else by name ("Diamond 2") for matches linked before the number was stored
    tier: (n, name) =>
      (n ? index?.tiers.get(n) : undefined) ??
      (name ? [...(index?.tiers.values() ?? [])].find((t) => t.name.toLowerCase() === name.toLowerCase()) : undefined) ??
      null
  }
}
