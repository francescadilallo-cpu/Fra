/**
 * Quality Rules — per-column overrides that let users mark nulls as expected
 * or set custom acceptable null-rate thresholds. Stored in localStorage.
 * Affects the effective quality score displayed in DataSourcesView.
 */
import type { TableProfile } from '../api/semantic'

export interface QualityRule {
  tableKey: string
  columnName: string
  /** 0–1. If set, overrides the 30% default high-null threshold. */
  maxNullRate: number
  /** When true this column is excluded from the quality penalty calculation. */
  ignore: boolean
  note: string
}

const RULES_KEY = 'si-quality-rules'
const HIGH_NULL_DEFAULT = 0.30

export function loadQualityRules(): QualityRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    return raw ? (JSON.parse(raw) as QualityRule[]) : []
  } catch {
    return []
  }
}

export function saveQualityRules(rules: QualityRule[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('quality-rules-updated'))
}

export function upsertRule(rules: QualityRule[], rule: QualityRule): QualityRule[] {
  const idx = rules.findIndex(r => r.tableKey === rule.tableKey && r.columnName === rule.columnName)
  if (idx === -1) return [...rules, rule]
  const next = [...rules]
  next[idx] = rule
  return next
}

export function removeRule(rules: QualityRule[], tableKey: string, columnName: string): QualityRule[] {
  return rules.filter(r => !(r.tableKey === tableKey && r.columnName === columnName))
}

export function getRuleForColumn(
  rules: QualityRule[],
  tableKey: string,
  columnName: string,
): QualityRule | undefined {
  return rules.find(r => r.tableKey === tableKey && r.columnName === columnName)
}

/** Recalculate quality score for a table, respecting user-defined column rules. */
export function effectiveQualityScore(
  profile: TableProfile,
  rules: QualityRule[],
  tableKey: string,
): number {
  const NULL_PENALTY = 12
  let penaltyCount = 0
  for (const col of profile.columns) {
    const rule = getRuleForColumn(rules, tableKey, col.name)
    if (rule?.ignore) continue
    const threshold = rule ? rule.maxNullRate : HIGH_NULL_DEFAULT
    if (col.null_rate > threshold) penaltyCount++
  }
  return Math.max(0, 100 - NULL_PENALTY * penaltyCount)
}
