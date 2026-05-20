import type { SectorConfig, SectorId } from './sectors'
import type { OntologyNode, OntologyEdge } from '../types'
import type { AgentRunSummary } from './agentStore'

export interface ReportInput {
  sectorId: SectorId
  sector: SectorConfig
  nodes: OntologyNode[]
  edges: OntologyEdge[]
  agentRuns: AgentRunSummary[]
  generatedAt: Date
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function fmt(v: number): string {
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v)
}

function severityIcon(s: string) {
  return s === 'critical' ? '🔴' : s === 'warning' ? '🟡' : 'ℹ️'
}

function severityColor(s: string) {
  return s === 'critical' ? '#dc2626' : s === 'warning' ? '#d97706' : '#64748b'
}

function recommendations(runs: AgentRunSummary[], sectorId: SectorId): string[] {
  const findings = runs.flatMap(r => r.findings)
  const critical = findings.filter(f => f.severity === 'critical').length
  const warning = findings.filter(f => f.severity === 'warning').length
  const recs: string[] = []

  if (runs.length === 0) {
    recs.push('Run the AI agent suite (Agents tab) to generate automated insights on data quality and business performance.')
  }
  if (critical > 0) {
    recs.push(`Resolve ${critical} critical finding${critical !== 1 ? 's' : ''} immediately — they may have direct impact on revenue or regulatory compliance.`)
  }
  if (warning > 0) {
    recs.push(`Review ${warning} warning${warning !== 1 ? 's' : ''} within this week to prevent them escalating to critical status.`)
  }
  if (sectorId === 'manufacturing') {
    recs.push('Verify that all open quotes with validUntil within 7 days have been actioned (converted or formally rejected).')
    recs.push('Cross-check supplier reliability scores against current lead times to anticipate production delays.')
  } else if (sectorId === 'retail') {
    recs.push('Activate cart-recovery automation for abandoned carts older than 2 hours — conversion uplift typically 15-25%.')
    recs.push('Reorder stock for all SKUs flagged below safety threshold before the next promotional period.')
  } else if (sectorId === 'healthcare') {
    recs.push('Follow up on all care gaps identified — patients without scheduled follow-up represent both a clinical and regulatory risk.')
    recs.push('Resolve conflicting diagnoses through clinical review before the next billing cycle.')
  } else if (sectorId === 'finance') {
    recs.push('Complete KYC for all pending applicants within the 5-day SLA to avoid regulatory penalties.')
    recs.push('High-risk profiles (score > 75) should be reviewed manually before disbursement approval.')
  }
  recs.push('Run the semantic layer pipeline weekly to maintain data freshness across all connected sources.')
  recs.push('Review ontology mappings after any ERP schema change to prevent silent field mismatches.')
  return recs
}

export function generateHtmlReport(input: ReportInput): string {
  const { sector, sectorId, nodes, edges, agentRuns, generatedAt } = input

  const entityCount = nodes.length
  const propCount = nodes.reduce((a, n) => a + n.data.properties.length, 0)
  const relCount = edges.length

  const allFindings = agentRuns.flatMap(r => r.findings)
  const critical = allFindings.filter(f => f.severity === 'critical')
  const warnings = allFindings.filter(f => f.severity === 'warning')
  const info = allFindings.filter(f => f.severity === 'info')

  const funnel = sector.funnel
  const totalFirst = funnel[0]?.count ?? 0
  const totalLast = funnel[funnel.length - 1]?.count ?? 0
  const conversion = totalFirst > 0 ? Math.round((totalLast / totalFirst) * 100) : 0
  const totalValue = funnel.reduce((s, f) => s + f.value, 0)
  const hasMonetary = funnel.some(f => f.value > 0)

  const recs = recommendations(agentRuns, sectorId)
  const dateStr = generatedAt.toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' })
  const timeStr = generatedAt.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })

  // Simple bar chart via div widths
  const maxFunnel = funnel[0]?.count ?? 1
  const funnelBars = funnel.map(s => {
    const pct = Math.round((s.count / maxFunnel) * 100)
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="width:180px;font-size:12px;color:#475569;text-align:right;flex-shrink:0;">${esc(s.stage)}</div>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#0d9488,#14b8a6);border-radius:6px;display:flex;align-items:center;padding:0 8px;">
            <span style="font-size:11px;font-weight:700;color:white;">${s.count}</span>
          </div>
        </div>
        <div style="width:100px;font-size:12px;color:#64748b;text-align:right;flex-shrink:0;">${s.value > 0 ? fmt(s.value) : '—'}</div>
      </div>`
  }).join('')

  const findingsHtml = allFindings.length === 0
    ? '<p style="color:#64748b;font-style:italic;">No agent runs recorded for this session. Visit the Agents tab to run an analysis.</p>'
    : agentRuns.map(run => {
        if (run.findings.length === 0) return ''
        return `
          <div style="margin-bottom:20px;">
            <h4 style="font-size:13px;color:#334155;margin-bottom:8px;">
              ${esc(run.agentName)} <span style="font-weight:400;color:#94a3b8;font-size:11px;">· ${new Date(run.ranAt).toLocaleTimeString('it-IT')}</span>
            </h4>
            ${run.findings.map(f => `
              <div style="display:flex;gap:10px;padding:8px 12px;border-radius:8px;margin-bottom:6px;background:${f.severity==='critical'?'#fef2f2':f.severity==='warning'?'#fffbeb':'#f8fafc'};border:1px solid ${f.severity==='critical'?'#fecaca':f.severity==='warning'?'#fde68a':'#e2e8f0'};">
                <span>${severityIcon(f.severity)}</span>
                <span style="font-size:12px;color:${severityColor(f.severity)};line-height:1.5;">${esc(f.text)}</span>
              </div>`).join('')}
          </div>`
      }).join('')

  const metricsHtml = (run: AgentRunSummary) => run.metrics.map(m =>
    `<div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;margin:4px;">
      <div style="font-size:18px;font-weight:700;color:#0d9488;">${esc(String(m.value))}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">${esc(m.label)}</div>
    </div>`
  ).join('')

  const agentMetricsHtml = agentRuns.map(run => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:8px;">${esc(run.agentName)}</div>
      ${metricsHtml(run)}
    </div>`
  ).join('')

  const nodeTableRows = nodes.map(n =>
    `<tr>
      <td style="padding:8px 12px;font-weight:600;font-size:12px;">${esc(n.data.label)}</td>
      <td style="padding:8px 12px;font-size:11px;color:#64748b;font-family:monospace;">${esc(n.data.db_table ?? '—')}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:center;">${n.data.properties.length}</td>
      <td style="padding:8px 12px;font-size:11px;color:#64748b;font-family:monospace;">${esc(n.data.uri)}</td>
    </tr>`
  ).join('')

  const recsHtml = recs.map((r, i) =>
    `<div style="display:flex;gap:12px;padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:8px;">
      <span style="font-size:12px;font-weight:700;color:#0d9488;flex-shrink:0;">${i+1}.</span>
      <span style="font-size:12px;color:#065f46;line-height:1.6;">${esc(r)}</span>
    </div>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>SemanticIntelligence — ${esc(sector.name)} Report — ${dateStr}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; background:#f8fafc; color:#1e293b; }
  .page { max-width:860px; margin:0 auto; padding:0; }
  .cover { background:linear-gradient(135deg,#0f172a 0%,#134e4a 100%); color:white; padding:56px 48px; }
  .cover h1 { font-size:32px; font-weight:800; color:#5eead4; margin-bottom:4px; }
  .cover .subtitle { font-size:15px; color:#94a3b8; margin-bottom:32px; }
  .cover .meta { display:flex; gap:32px; flex-wrap:wrap; }
  .cover .meta-item { }
  .cover .meta-item .label { font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:#64748b; }
  .cover .meta-item .value { font-size:14px; font-weight:600; color:#e2e8f0; margin-top:2px; }
  .section { background:white; margin:0; padding:40px 48px; border-bottom:1px solid #e2e8f0; }
  .section:last-child { border-bottom:none; }
  .section h2 { font-size:18px; font-weight:700; color:#0d9488; margin-bottom:4px; padding-bottom:8px; border-bottom:2px solid #f0fdf4; }
  .section .section-sub { font-size:12px; color:#94a3b8; margin-bottom:24px; margin-top:4px; }
  .kpi-row { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
  .kpi { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px 20px; min-width:160px; }
  .kpi .val { font-size:24px; font-weight:800; color:#0d9488; }
  .kpi .lbl { font-size:11px; color:#64748b; margin-top:4px; text-transform:uppercase; letter-spacing:0.05em; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  thead th { background:#f1f5f9; padding:8px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#64748b; font-weight:600; }
  tbody tr:nth-child(even) { background:#f8fafc; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; }
  .badge-critical { background:#fef2f2; color:#dc2626; border:1px solid #fecaca; }
  .badge-warning  { background:#fffbeb; color:#d97706; border:1px solid #fde68a; }
  .badge-ok       { background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; }
  .footer { background:#0f172a; color:#475569; padding:24px 48px; font-size:11px; display:flex; justify-content:space-between; align-items:center; }
  .footer strong { color:#94a3b8; }
  @media print {
    body { background:white; }
    .page { max-width:100%; }
    .section { padding:24px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Cover -->
  <div class="cover">
    <h1>SemanticIntelligence</h1>
    <p class="subtitle">AI Platform — Executive Report</p>
    <div class="meta">
      <div class="meta-item">
        <div class="label">Sector</div>
        <div class="value">${esc(sector.icon)} ${esc(sector.name)}</div>
      </div>
      <div class="meta-item">
        <div class="label">Domain</div>
        <div class="value">${esc(sector.domain)}</div>
      </div>
      <div class="meta-item">
        <div class="label">Generated</div>
        <div class="value">${dateStr} · ${timeStr}</div>
      </div>
      <div class="meta-item">
        <div class="label">Status</div>
        <div class="value">${critical.length > 0 ? '🔴 ' + critical.length + ' Critical' : warnings.length > 0 ? '🟡 ' + warnings.length + ' Warnings' : '🟢 All Clear'}</div>
      </div>
    </div>
  </div>

  <!-- 1. Semantic Layer -->
  <div class="section">
    <h2>1. Semantic Layer Overview</h2>
    <p class="section-sub">Ontology statistics for the ${esc(sector.name)} sector</p>
    <div class="kpi-row">
      <div class="kpi"><div class="val">${entityCount}</div><div class="lbl">Entities</div></div>
      <div class="kpi"><div class="val">${relCount}</div><div class="lbl">Relations</div></div>
      <div class="kpi"><div class="val">${propCount}</div><div class="lbl">Properties</div></div>
      <div class="kpi"><div class="val">${nodes.filter(n=>n.data.db_table).length}</div><div class="lbl">DB Tables mapped</div></div>
    </div>
    <table>
      <thead><tr><th>Entity</th><th>DB Table</th><th>Properties</th><th>URI</th></tr></thead>
      <tbody>${nodeTableRows}</tbody>
    </table>
  </div>

  <!-- 2. KPIs -->
  <div class="section">
    <h2>2. Key Performance Indicators</h2>
    <p class="section-sub">Derived from the semantic layer — ${esc(sector.kpiLabels.quotes)} → ${esc(sector.kpiLabels.orders)}</p>
    <div class="kpi-row">
      <div class="kpi"><div class="val">${totalFirst}</div><div class="lbl">${esc(sector.kpiLabels.quotes)}</div></div>
      <div class="kpi"><div class="val">${totalLast}</div><div class="lbl">${esc(sector.kpiLabels.orders)}</div></div>
      <div class="kpi"><div class="val">${conversion}%</div><div class="lbl">${esc(sector.kpiLabels.conversion)}</div></div>
      ${hasMonetary ? `<div class="kpi"><div class="val">${fmt(totalValue)}</div><div class="lbl">${esc(sector.kpiLabels.openValue)}</div></div>` : ''}
    </div>
    <h3 style="font-size:14px;font-weight:600;color:#334155;margin-bottom:12px;margin-top:8px;">Process Funnel</h3>
    ${funnelBars}
  </div>

  <!-- 3. Agent Findings -->
  <div class="section">
    <h2>3. AI Agent Findings</h2>
    <p class="section-sub">${agentRuns.length} agent run${agentRuns.length !== 1 ? 's' : ''} · ${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} total</p>
    <div style="display:flex;gap:12px;margin-bottom:24px;">
      <span class="badge badge-critical">${critical.length} Critical</span>
      <span class="badge badge-warning">${warnings.length} Warning</span>
      <span class="badge" style="background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;">${info.length} Info</span>
    </div>
    ${findingsHtml}
  </div>

  <!-- 4. Agent Metrics -->
  ${agentRuns.length > 0 ? `
  <div class="section">
    <h2>4. Agent Metrics</h2>
    <p class="section-sub">Quantitative outputs from the last agent run</p>
    ${agentMetricsHtml}
  </div>` : ''}

  <!-- 5. Recommendations -->
  <div class="section">
    <h2>${agentRuns.length > 0 ? '5' : '4'}. AI Recommendations</h2>
    <p class="section-sub">Automatically generated based on current state of the semantic layer and agent findings</p>
    ${recsHtml}
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>Generated by <strong>SemanticIntelligence Platform</strong> · ${dateStr} ${timeStr}</span>
    <span>Sector: <strong>${esc(sector.name)}</strong> · Entities: <strong>${entityCount}</strong> · Findings: <strong>${allFindings.length}</strong></span>
  </div>

</div>
</body>
</html>`
}

export function downloadReport(html: string, sectorId: string, date: Date): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `semantic-intelligence-report-${sectorId}-${date.toISOString().slice(0,10)}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
