import { createContext, useContext, useState, type ReactNode } from 'react'
import { SECTORS, type SectorId, type SectorConfig } from '../data/sectors'

interface Ctx {
  sectorId: SectorId
  sector: SectorConfig
  setSector: (id: SectorId) => void
}

const SectorContext = createContext<Ctx | null>(null)

export function SectorProvider({ children }: { children: ReactNode }) {
  const [sectorId, setSectorId] = useState<SectorId>('manufacturing')
  return (
    <SectorContext.Provider value={{ sectorId, sector: SECTORS[sectorId], setSector: setSectorId }}>
      {children}
    </SectorContext.Provider>
  )
}

export function useSector() {
  const ctx = useContext(SectorContext)
  if (!ctx) throw new Error('useSector must be inside SectorProvider')
  return ctx
}
