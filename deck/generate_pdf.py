"""Generate PDF from the sales deck HTML via WeasyPrint."""

import sys
from pathlib import Path

PDF_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');

  @page {
    size: A4 landscape;
    margin: 0;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #08101f;
    --teal:      #00c4b4;
    --teal-dim:  rgba(0,196,180,.15);
    --teal-dim2: rgba(0,196,180,.07);
    --violet:    #7c3aed;
    --violet-dim:rgba(124,58,237,.15);
    --gold:      #f59e0b;
    --red:       #ef4444;
    --green:     #22c55e;
    --text:      #e8f0fb;
    --muted:     #6b82a0;
    --border:    rgba(255,255,255,.08);
    --card:      rgba(255,255,255,.04);
    --card2:     rgba(255,255,255,.06);
  }

  body {
    font-family: 'Inter', Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
  }

  .slide {
    width: 297mm;
    height: 210mm;
    padding: 14mm 18mm;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }
  .slide:last-child { page-break-after: avoid; }

  /* BG glow approximation */
  .bg-glow {
    position: absolute; top: -50mm; right: -50mm;
    width: 130mm; height: 130mm;
    background: radial-gradient(circle, rgba(0,196,180,.10) 0%, transparent 70%);
    pointer-events: none;
  }
  .bg-glow2 {
    position: absolute; bottom: -60mm; left: -20mm;
    width: 110mm; height: 110mm;
    background: radial-gradient(circle, rgba(124,58,237,.08) 0%, transparent 70%);
    pointer-events: none;
  }

  .tag {
    display: inline-block;
    font-size: 7pt; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase;
    padding: 2pt 8pt;
    border-radius: 20pt;
    margin-bottom: 6mm;
  }
  .tag-teal  { background: rgba(0,196,180,.15); color: #00c4b4; border: 1pt solid rgba(0,196,180,.3); }
  .tag-violet{ background: rgba(124,58,237,.15); color: #a78bfa; border: 1pt solid rgba(124,58,237,.3); }
  .tag-gold  { background: rgba(245,158,11,.12); color: #f59e0b; border: 1pt solid rgba(245,158,11,.3); }
  .tag-plain { background: rgba(255,255,255,.06); color: #6b82a0; border: 1pt solid rgba(255,255,255,.08); }

  h1 { font-size: 28pt; font-weight: 900; line-height: 1.08; letter-spacing: -.02em; }
  h2 { font-size: 20pt; font-weight: 800; line-height: 1.12; letter-spacing: -.02em; }
  h3 { font-size: 10pt; font-weight: 700; }
  h4 { font-size: 7pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }

  .accent  { color: #00c4b4; }
  .accent2 { color: #a78bfa; }
  .muted   { color: #6b82a0; }

  .slide-header { margin-bottom: 6mm; }
  .slide-header p.lead {
    font-size: 9pt; color: #6b82a0; margin-top: 3mm; line-height: 1.55;
  }

  .slide-num {
    position: absolute; top: 6mm; right: 10mm;
    font-size: 7pt; color: #6b82a0; font-weight: 600;
  }

  .card {
    background: rgba(255,255,255,.04);
    border: 1pt solid rgba(255,255,255,.08);
    border-radius: 5pt;
    padding: 5mm 6mm;
  }

  ul.bullets { list-style: none; display: flex; flex-direction: column; gap: 2.5mm; }
  ul.bullets li {
    display: flex; align-items: flex-start; gap: 3mm;
    font-size: 8.5pt; line-height: 1.5; color: #c8d8ee;
  }
  ul.bullets li::before {
    content: '';
    min-width: 4pt; height: 4pt;
    border-radius: 50%;
    background: #00c4b4;
    margin-top: 4pt;
    flex-shrink: 0;
  }

  .kv { display: flex; flex-direction: column; gap: 1mm; }
  .kv .val { font-size: 16pt; font-weight: 800; color: #00c4b4; }
  .kv .lbl { font-size: 6.5pt; color: #6b82a0; font-weight: 500; letter-spacing: .04em; }

  /* ── SLIDE 1 COVER ─────────────────────────────────────── */
  #s1 { justify-content: center; }
  #s1 .logo-mark {
    display: flex; align-items: center; gap: 3mm; margin-bottom: 8mm;
  }
  #s1 .logo-mark .dot {
    width: 12mm; height: 12mm;
    background: linear-gradient(135deg, #00c4b4, #008cff);
    border-radius: 3mm;
    display: flex; align-items: center; justify-content: center;
    font-size: 14pt; font-weight: 900; color: #fff;
  }
  #s1 .logo-mark span { font-size: 13pt; font-weight: 700; }
  #s1 .tagline { font-size: 10pt; color: #6b82a0; margin-top: 4mm; margin-bottom: 10mm; line-height: 1.55; max-width: 130mm; }
  #s1 .pill-row { display: flex; flex-wrap: wrap; gap: 2mm; }
  #s1 .pill {
    padding: 2mm 4mm; border-radius: 20pt;
    border: 1pt solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.04);
    font-size: 7.5pt; color: #a0b4cc;
  }

  /* ── PAIN GRID (S2) ────────────────────────────────────── */
  .pain-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; flex: 1;
  }
  .pain-item {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 4mm 5mm;
    display: flex; align-items: flex-start; gap: 3mm;
  }
  .pain-item .ico { font-size: 14pt; min-width: 8mm; }
  .pain-item .txt strong { display: block; font-size: 8.5pt; font-weight: 700; margin-bottom: 1.5mm; }
  .pain-item .txt span { font-size: 7.5pt; color: #6b82a0; line-height: 1.45; }
  .pain-item.wide { grid-column: 1 / -1; }

  /* ── SOL GRID (S3) ─────────────────────────────────────── */
  .sol-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; flex: 1;
  }
  .sol-card {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 5pt; padding: 5mm 4mm;
    display: flex; flex-direction: column; gap: 2.5mm;
  }
  .sol-card .ico { font-size: 16pt; }
  .sol-card h3 { font-size: 9pt; }
  .sol-card p { font-size: 7.5pt; color: #6b82a0; line-height: 1.5; }
  .sol-card.highlight { border-color: rgba(0,196,180,.4); background: rgba(0,196,180,.07); }

  /* ── ARCH (S4) ─────────────────────────────────────────── */
  .arch { flex: 1; display: flex; flex-direction: column; gap: 3mm; justify-content: center; }
  .layer {
    border-radius: 5pt; padding: 4mm 6mm;
    display: flex; align-items: center; gap: 6mm;
    border: 1pt solid rgba(255,255,255,.08);
  }
  .layer.l1 { background: rgba(0,196,180,.08); border-color: rgba(0,196,180,.25); }
  .layer.l2 { background: rgba(124,58,237,.08); border-color: rgba(124,58,237,.25); }
  .layer.l3 { background: rgba(245,158,11,.07); border-color: rgba(245,158,11,.25); }
  .layer .layer-num { font-size: 7pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; min-width: 18mm; }
  .layer.l1 .layer-num { color: #00c4b4; }
  .layer.l2 .layer-num { color: #a78bfa; }
  .layer.l3 .layer-num { color: #f59e0b; }
  .layer .layer-name { font-size: 11pt; font-weight: 800; min-width: 30mm; }
  .layer .layer-desc { font-size: 7.5pt; color: #6b82a0; line-height: 1.5; }
  .arch-arrow { text-align: center; font-size: 10pt; color: #6b82a0; margin: -1mm 0; }
  .conn-row { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 5mm; }
  .conn-badge {
    padding: 1.5mm 3.5mm; border-radius: 12pt;
    font-size: 7pt; font-weight: 600;
    background: rgba(255,255,255,.06); border: 1pt solid rgba(255,255,255,.08); color: #a0b4cc;
  }

  /* ── TWO COL (S5) ──────────────────────────────────────── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; flex: 1; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; }
  .stat-card { background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08); border-radius: 4pt; padding: 3mm 4mm; }

  /* ── GOV GRID (S6) ─────────────────────────────────────── */
  .gov-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm; flex: 1; }
  .gov-card {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 5pt; padding: 4mm 5mm;
  }
  .gov-card .ico { font-size: 14pt; margin-bottom: 2mm; }
  .gov-card h3 { font-size: 9pt; margin-bottom: 2mm; }
  .gov-card p  { font-size: 7.5pt; color: #6b82a0; line-height: 1.45; }
  .gov-card.highlight { border-color: rgba(124,58,237,.4); background: rgba(124,58,237,.1); }

  /* ── QUERY DEMO (S7) ───────────────────────────────────── */
  .query-demo {
    background: #06101e; border: 1pt solid rgba(0,196,180,.3);
    border-radius: 6pt; padding: 5mm 7mm; flex: 1;
    display: flex; flex-direction: column; gap: 4mm;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    max-height: 65mm;
  }
  .q-row { display: flex; gap: 3mm; align-items: flex-start; }
  .q-label {
    font-size: 6.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    padding: 1.5pt 5pt; border-radius: 3pt; white-space: nowrap; margin-top: 1pt;
  }
  .q-label.user { background: rgba(0,196,180,.2); color: #00c4b4; }
  .q-label.ai   { background: rgba(124,58,237,.2); color: #a78bfa; }
  .q-text { font-size: 8pt; line-height: 1.55; color: #c8d8ee; }
  .provenance {
    display: flex; flex-wrap: wrap; gap: 1.5mm;
    padding-top: 3mm; border-top: 1pt solid rgba(255,255,255,.08);
  }
  .prov-tag {
    font-size: 6.5pt; padding: 1.5pt 5pt; border-radius: 3pt;
    background: rgba(255,255,255,.06); border: 1pt solid rgba(255,255,255,.08); color: #6b82a0;
  }
  .features-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; margin-top: 3mm; }
  .feat {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3mm 3.5mm; font-size: 7.5pt;
  }
  .feat strong { display: block; font-size: 7pt; color: #00c4b4; margin-bottom: 1mm; font-weight: 600; letter-spacing: .04em; }

  /* ── AGENT GRID (S8) ───────────────────────────────────── */
  .agent-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm; }
  .agent-card {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 5pt; padding: 4mm 5mm;
  }
  .a-head { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 2mm; }
  .a-head .ico { font-size: 14pt; }
  .a-head h3 { font-size: 9pt; }
  .agent-card p  { font-size: 7.5pt; color: #6b82a0; line-height: 1.45; margin-bottom: 2mm; }
  .result {
    font-size: 7pt; font-weight: 700; padding: 1.5mm 3mm; border-radius: 4pt;
    background: rgba(0,196,180,.15); color: #00c4b4; border: 1pt solid rgba(0,196,180,.3);
    font-family: 'JetBrains Mono', monospace;
  }
  .workflow {
    margin-top: 4mm; display: flex; align-items: center;
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3mm 5mm;
  }
  .wf-step { flex: 1; text-align: center; font-size: 7pt; font-weight: 600; letter-spacing: .04em; color: #00c4b4; }
  .wf-arrow { color: rgba(255,255,255,.08); font-size: 10pt; padding: 0 1mm; }

  /* ── DEMO / JOURNEY (S9) ───────────────────────────────── */
  .journey { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2mm; margin-bottom: 4mm; }
  .step {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3mm 2mm;
    text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1.5mm;
  }
  .s-num { font-size: 6.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #00c4b4; }
  .s-ico { font-size: 14pt; }
  .s-lbl { font-size: 6.5pt; color: #6b82a0; font-weight: 500; }
  .metrics-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; }
  .m-card {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3.5mm; text-align: center;
  }
  .m-card .val { font-size: 14pt; font-weight: 800; color: #00c4b4; }
  .m-card .lbl { font-size: 6.5pt; color: #6b82a0; margin-top: 1mm; }
  .pipeline-log {
    background: #06101e; border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3mm 4mm;
    font-family: 'JetBrains Mono', monospace; font-size: 7.5pt;
    display: flex; flex-direction: column; gap: 1.5mm; margin-top: 3mm;
  }
  .log-line { color: #6b82a0; }
  .log-line .ok { color: #22c55e; }
  .log-line .num { color: #00c4b4; }

  /* ── SECTOR GRID (S10) ─────────────────────────────────── */
  .sector-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm; flex: 1; }
  .sector {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 5pt; padding: 4.5mm 5mm;
  }
  .s-head { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 2.5mm; }
  .s-head .ico { font-size: 14pt; }
  .s-head h3 { font-size: 9.5pt; }
  .sources { display: flex; flex-wrap: wrap; gap: 1.5mm; margin-bottom: 2.5mm; }
  .src-tag {
    font-size: 6.5pt; padding: 1pt 5pt; border-radius: 4pt;
    background: rgba(255,255,255,.06); border: 1pt solid rgba(255,255,255,.08); color: #6b82a0;
  }
  .sector ul { list-style: none; display: flex; flex-direction: column; gap: 1.5mm; }
  .sector ul li { font-size: 7.5pt; color: #b0c4de; }
  .sector ul li::before { content: '▸ '; color: #00c4b4; font-size: 7pt; }

  /* ── VS TABLE (S11) ────────────────────────────────────── */
  .vs-table {
    flex: 1; display: flex; flex-direction: column; gap: 0;
    border: 1pt solid rgba(255,255,255,.08); border-radius: 5pt; overflow: hidden;
  }
  .vs-row {
    display: grid; grid-template-columns: 2fr 2fr 2fr 2fr; gap: 0;
    border-bottom: 1pt solid rgba(255,255,255,.08);
  }
  .vs-row:last-child { border-bottom: none; }
  .vs-cell {
    padding: 2.5mm 4mm; font-size: 7.5pt;
    border-right: 1pt solid rgba(255,255,255,.08);
    display: flex; align-items: center; gap: 2mm; line-height: 1.4;
  }
  .vs-cell:last-child { border-right: none; }
  .vs-cell.header { font-size: 6.5pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: rgba(255,255,255,.06); color: #6b82a0; }
  .vs-cell.us { background: rgba(0,196,180,.07); }
  .vs-cell .chk { color: #22c55e; font-size: 10pt; }
  .vs-cell .cross { color: #ef4444; font-size: 10pt; }
  .vs-cell .part { color: #f59e0b; font-size: 9pt; }
  .bottom-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; margin-top: 4mm; }
  .bottom-pill {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(0,196,180,.25);
    border-radius: 4pt; padding: 3mm 4mm; font-size: 8pt; text-align: center;
  }
  .bottom-pill strong { display: block; color: #00c4b4; font-size: 11pt; font-weight: 800; margin-bottom: 1mm; }

  /* ── CTA (S12) ─────────────────────────────────────────── */
  .cta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.5mm; margin-bottom: 5mm; }
  .cta-card {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 6pt; padding: 5mm;
    display: flex; flex-direction: column; gap: 2mm;
  }
  .cta-card.featured { border-color: rgba(124,58,237,.3); background: rgba(124,58,237,.1); }
  .cta-card .tier {
    font-size: 6.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    padding: 1.5pt 6pt; border-radius: 12pt; align-self: flex-start;
  }
  .tier-teal   { background: rgba(0,196,180,.15); color: #00c4b4; border: 1pt solid rgba(0,196,180,.3); }
  .tier-violet { background: rgba(124,58,237,.15); color: #a78bfa; border: 1pt solid rgba(124,58,237,.3); }
  .tier-gold   { background: rgba(245,158,11,.12); color: #f59e0b; border: 1pt solid rgba(245,158,11,.3); }
  .cta-card h3 { font-size: 11pt; }
  .cta-card .time { font-size: 7.5pt; color: #6b82a0; font-weight: 600; }
  .cta-card p { font-size: 7.5pt; color: #6b82a0; line-height: 1.5; }
  .cta-card ul { list-style: none; display: flex; flex-direction: column; gap: 1.5mm; }
  .cta-card ul li { font-size: 7.5pt; color: #b0c4de; }
  .cta-card ul li::before { content: '✓ '; color: #00c4b4; font-weight: 700; }
  .contact-bar {
    background: rgba(255,255,255,.04); border: 1pt solid rgba(255,255,255,.08);
    border-radius: 4pt; padding: 3mm 5mm;
    display: flex; align-items: center; justify-content: space-between;
  }
  .contact-bar span { font-size: 8pt; color: #6b82a0; }
  .contact-bar .email { color: #00c4b4; font-weight: 600; }
</style>
</head>
<body>

<!-- ══════ SLIDE 1 · COVER ══════ -->
<div class="slide" id="s1">
  <div class="bg-glow"></div><div class="bg-glow2"></div>
  <div class="logo-mark">
    <div class="dot">S</div>
    <span>SemanticIntelligence</span>
  </div>
  <h1>The AI that understands<br><span class="accent">your enterprise data</span></h1>
  <p class="tagline">A single platform that connects any data source, builds a live enterprise Knowledge Graph,
  answers questions in plain language, and runs autonomous agents — with full AI auditability.</p>
  <div class="pill-row">
    <div class="pill">🧠 Semantic Layer</div>
    <div class="pill">🕸️ Knowledge Graph</div>
    <div class="pill">💬 Natural Language Query</div>
    <div class="pill">🤖 Autonomous Agents</div>
    <div class="pill">🛡️ EU AI Act Ready</div>
    <div class="pill">🏭 Manufacturing · 🛒 Retail · 🏥 Healthcare · 🏦 Finance</div>
  </div>
  <div class="slide-num">01 / 12</div>
</div>

<!-- ══════ SLIDE 2 · THE PROBLEM ══════ -->
<div class="slide" id="s2">
  <div class="slide-header">
    <div class="tag tag-plain">⚠️ The Problem</div>
    <h2>Every company has the data.<br><span class="accent">Not everyone can use it.</span></h2>
  </div>
  <div class="pain-grid">
    <div class="pain-item">
      <div class="ico">🗃️</div>
      <div class="txt"><strong>Data silos everywhere</strong>
      <span>ERP, CRM, HR, PIM speak different languages. Nobody truly connects them. Every cross-source join is a project.</span></div>
    </div>
    <div class="pain-item">
      <div class="ico">⏳</div>
      <div class="txt"><strong>Weeks waiting for a report</strong>
      <span>Business teams wait days or weeks for a query that spans two systems. By the time it arrives, the decision is stale.</span></div>
    </div>
    <div class="pain-item">
      <div class="ico">💻</div>
      <div class="txt"><strong>IT answers operational questions</strong>
      <span>Data engineers write ad-hoc SQL on request instead of building infrastructure that scales.</span></div>
    </div>
    <div class="pain-item">
      <div class="ico">📊</div>
      <div class="txt"><strong>Decisions based on stale exports</strong>
      <span>The "single source of truth" is a manually updated Excel sheet. There is no real-time, trustworthy picture.</span></div>
    </div>
    <div class="pain-item wide">
      <div class="ico">🔍</div>
      <div class="txt"><strong>Compliance without traceability</strong>
      <span>GDPR, EU AI Act, and internal audits require a full explanation of every AI-driven calculation — impossible with current tools.</span></div>
    </div>
  </div>
  <div class="slide-num">02 / 12</div>
</div>

<!-- ══════ SLIDE 3 · SOLUTION ══════ -->
<div class="slide" id="s3">
  <div class="slide-header">
    <div class="tag tag-teal">✦ Our Answer</div>
    <h2>A semantic layer that <span class="accent">unifies, understands, and acts</span></h2>
    <p class="lead">Not another BI tool. Not another pipeline. A platform that brings semantic intelligence on top of the data you already have.</p>
  </div>
  <div class="sol-grid">
    <div class="sol-card highlight">
      <div class="ico">🔗</div><h3>Connect any source</h3>
      <p>SAP, Oracle, Salesforce, PostgreSQL, REST API, CSV. 12+ native connectors. Automatic schema detection. Zero custom ETL.</p>
    </div>
    <div class="sol-card highlight">
      <div class="ico">🕸️</div><h3>Enterprise Knowledge Graph</h3>
      <p>OWL/RDF ontology that models entities, relationships, and cross-system identity resolution rules. Versioned and queryable.</p>
    </div>
    <div class="sol-card highlight">
      <div class="ico">💬</div><h3>Natural language queries</h3>
      <p>Neuro-symbolic: deterministic intent detection + Claude AI fallback. SQL always templated, never arbitrary. Zero hallucinations.</p>
    </div>
    <div class="sol-card">
      <div class="ico">🤖</div><h3>Autonomous agents</h3>
      <p>Monitor, Alert, Reconciler, Validator. Running on the semantic layer with human approval and full audit before any action.</p>
    </div>
    <div class="sol-card">
      <div class="ico">🛡️</div><h3>Governance &amp; EU AI Act</h3>
      <p>Immutable audit trail, granular RBAC, EU data sovereignty, right-to-explanation on every AI output. Compliance by design.</p>
    </div>
    <div class="sol-card">
      <div class="ico">⚡</div><h3>Multi-sector, multi-tenant</h3>
      <p>Same platform for Manufacturing, Retail, Healthcare, Finance. Domain-specific ontology per customer. API-first, zero lock-in.</p>
    </div>
  </div>
  <div class="slide-num">03 / 12</div>
</div>

<!-- ══════ SLIDE 4 · ARCHITECTURE ══════ -->
<div class="slide" id="s4">
  <div class="slide-header">
    <div class="tag tag-plain">🏗️ Architecture</div>
    <h2>3 layers. One <span class="accent">semantic stack</span>.</h2>
    <p class="lead">Every layer is independent, composable, and integrates with your existing stack.</p>
  </div>
  <div class="arch">
    <div class="layer l3">
      <div class="layer-num">Layer 3</div>
      <div class="layer-name" style="color:#f59e0b">Users &amp; Apps</div>
      <div class="layer-desc">Natural Language Query · KPI Dashboard · Autonomous Agents · Audit &amp; Governance · REST API</div>
    </div>
    <div class="arch-arrow">↕</div>
    <div class="layer l2">
      <div class="layer-num">Layer 2</div>
      <div class="layer-name" style="color:#a78bfa">Semantics</div>
      <div class="layer-desc">OWL/RDF Ontology · Knowledge Graph (NetworkX) · Neuro-symbolic AI · Metadata Catalog · Redis Cache · Identity Resolution</div>
    </div>
    <div class="arch-arrow">↕</div>
    <div class="layer l1">
      <div class="layer-num">Layer 1</div>
      <div class="layer-name" style="color:#00c4b4">Data</div>
      <div class="layer-desc">PostgreSQL · SQLite · DuckDB · REST API · CSV/JSON · SAP · Oracle · Salesforce · Snowflake</div>
    </div>
  </div>
  <div class="conn-row">
    <span class="conn-badge">FastAPI + Python 3.11</span>
    <span class="conn-badge">React 18 + TypeScript</span>
    <span class="conn-badge">rdflib OWL</span>
    <span class="conn-badge">NetworkX KG</span>
    <span class="conn-badge">DuckDB</span>
    <span class="conn-badge">Redis Cache</span>
    <span class="conn-badge">JWT Auth HS256</span>
    <span class="conn-badge">Anthropic Claude</span>
    <span class="conn-badge">SlowAPI Rate Limiting</span>
  </div>
  <div class="slide-num">04 / 12</div>
</div>

<!-- ══════ SLIDE 5 · FOR IT: SEMANTIC LAYER ══════ -->
<div class="slide" id="s5">
  <div class="slide-header">
    <div class="tag tag-teal">💻 For IT</div>
    <h2>Semantic Layer &amp; <span class="accent">Knowledge Graph</span></h2>
    <p class="lead">Give IT a real tool — not another pipeline to maintain by hand.</p>
  </div>
  <div class="two-col">
    <div>
      <ul class="bullets">
        <li>Build the enterprise ontology visually: entities, relationships, and typed data properties (XSD)</li>
        <li>Define <strong>identity resolution</strong> rules across systems — e.g. ERP.customer_ref ↔ CRM.accountId</li>
        <li>The Knowledge Graph builds automatically from the ETL pipeline (Connect → Extract → Map → Enrich → Index)</li>
        <li>Versioned semantic mappings: synonyms, aliases, certified metrics (revenue, margin, conversion rate)</li>
        <li>Every mapping change invalidates the Redis cache and updates lineage — <strong>zero semantic drift</strong></li>
        <li>Neuro-symbolic intent detection: deterministic rules + Claude fallback for ambiguous queries</li>
        <li>SQL is always <strong>templated and signed off</strong> — no arbitrary LLM-generated queries</li>
      </ul>
    </div>
    <div style="display:flex;flex-direction:column;gap:3mm">
      <div class="card">
        <h4 style="margin-bottom:3mm">Manufacturing Demo · AdventureWorks</h4>
        <div class="stat-grid">
          <div class="stat-card"><div class="kv"><span class="val">193K</span><span class="lbl">KG Nodes</span></div></div>
          <div class="stat-card"><div class="kv"><span class="val">313K</span><span class="lbl">KG Edges</span></div></div>
          <div class="stat-card"><div class="kv"><span class="val">8</span><span class="lbl">Ontology Entities</span></div></div>
          <div class="stat-card"><div class="kv"><span class="val">47</span><span class="lbl">Semantic Definitions</span></div></div>
          <div class="stat-card"><div class="kv"><span class="val">3</span><span class="lbl">Cross-source Bridges</span></div></div>
          <div class="stat-card"><div class="kv"><span class="val">12+</span><span class="lbl">Native Connectors</span></div></div>
        </div>
      </div>
      <div class="card" style="font-size:7.5pt;color:#6b82a0;line-height:1.6">
        <strong style="color:#e8f0fb;display:block;margin-bottom:2mm">Modeled Entities</strong>
        Customer · SalesOrder · OrderLineItem · Product · Employee · Quote · QuoteLineItem · Territory
      </div>
    </div>
  </div>
  <div class="slide-num">05 / 12</div>
</div>

<!-- ══════ SLIDE 6 · FOR IT: GOVERNANCE ══════ -->
<div class="slide" id="s6">
  <div class="slide-header">
    <div class="tag tag-violet">🛡️ For IT · Governance</div>
    <h2>No black boxes. <span class="accent2">Every decision traced.</span></h2>
  </div>
  <div class="gov-grid">
    <div class="gov-card highlight">
      <div class="ico">📋</div><h3>Immutable Audit Trail</h3>
      <p>Who asked what, which SQL was executed, from which sources, with what latency. Every record locked, every change logged — always.</p>
    </div>
    <div class="gov-card highlight">
      <div class="ico">⚖️</div><h3>EU AI Act Ready</h3>
      <p>Right-to-explanation on every AI output. Configurable EU data sovereignty. Human-in-the-loop mandatory for actions below confidence threshold (&lt;80%).</p>
    </div>
    <div class="gov-card">
      <div class="ico">🔐</div><h3>Granular RBAC</h3>
      <p>User / admin / manager roles with distinct permissions. Every high-risk write-back action requires explicit manager approval before execution.</p>
    </div>
    <div class="gov-card">
      <div class="ico">🔒</div><h3>Security by Design</h3>
      <p>Rate limiting (60 queries/min), SQL injection blocking, keyword filtering (DROP/ALTER/DELETE), system table access prevention. JWT HS256.</p>
    </div>
    <div class="gov-card">
      <div class="ico">🔗</div><h3>End-to-End Data Lineage</h3>
      <p>Every answer includes: tables touched, connectors used, semantic bridges traversed, latency. Traceable all the way back to the raw source.</p>
    </div>
    <div class="gov-card">
      <div class="ico">🏛️</div><h3>Certified Enterprise Connectors</h3>
      <p>SAP S/4HANA · Oracle ERP · Salesforce · Epic EHR (HL7 FHIR) · Snowflake · Anthropic Claude · PostgreSQL · REST/CSV</p>
    </div>
  </div>
  <div class="slide-num">06 / 12</div>
</div>

<!-- ══════ SLIDE 7 · FOR BUSINESS: NL QUERY ══════ -->
<div class="slide" id="s7">
  <div class="slide-header">
    <div class="tag tag-gold">💼 For Business</div>
    <h2>Ask. <span class="accent">Get answers.</span> Decide.</h2>
    <p class="lead">Business users query their data like talking to a senior analyst — no SQL, no waiting, no tickets.</p>
  </div>
  <div class="query-demo">
    <div class="q-row">
      <span class="q-label user">User</span>
      <span class="q-text">"Who is the top salesperson in Q4 by net revenue?"</span>
    </div>
    <div class="q-row">
      <span class="q-label ai">SI</span>
      <span class="q-text"><strong style="color:#00c4b4">Linda Mitchell</strong> — $4,251,368 YTD · +12% vs Q3 · Territory: Northwest<br>
      <span style="color:#6b82a0;font-size:7pt">Automatic JOIN: ERP.salesperson × ERP.sales_order_header × HR.employees via bridge salesperson_ref ↔ EmployeeId</span></span>
    </div>
    <div class="provenance">
      <span class="prov-tag">⏱ 145ms</span>
      <span class="prov-tag">📂 ERP salesperson</span>
      <span class="prov-tag">📂 ERP sales_order_header</span>
      <span class="prov-tag">📂 HR employees</span>
      <span class="prov-tag">🔗 bridge: salesperson_ref ↔ EmployeeId</span>
      <span class="prov-tag">✓ intent: ERP_SALES_TOP</span>
      <span class="prov-tag">SQL available</span>
    </div>
  </div>
  <div class="features-row">
    <div class="feat"><strong>Ambiguity handled</strong>If "revenue" maps to two metrics, the system surfaces both candidates and documents the resolution in the semantic layer.</div>
    <div class="feat"><strong>Automatic cross-source joins</strong>Joins across ERP, CRM, HR follow the Knowledge Graph — no SQL written by hand, ever.</div>
    <div class="feat"><strong>Provenance always included</strong>Every answer ships with SQL, sources, latency, lineage, and semantic notes. No black box.</div>
  </div>
  <div class="slide-num">07 / 12</div>
</div>

<!-- ══════ SLIDE 8 · FOR BUSINESS: AGENTS ══════ -->
<div class="slide" id="s8">
  <div class="slide-header">
    <div class="tag tag-teal">🤖 For Business · Automation</div>
    <h2>Doesn't just answer. <span class="accent">Acts.</span> With oversight.</h2>
  </div>
  <div class="agent-grid">
    <div class="agent-card">
      <div class="a-head"><span class="ico">📡</span><h3>Monitor Agent</h3></div>
      <p>Continuously scans KPIs, thresholds, and anomalies across enterprise data. Triggers on schedule or on event.</p>
      <div class="result">▶ Sales Performance Monitor active · YTD report delivered</div>
    </div>
    <div class="agent-card">
      <div class="a-head"><span class="ico">🔔</span><h3>Alert Agent</h3></div>
      <p>Notifies teams when data deviates from semantic parameters defined in the ontology.</p>
      <div class="result">▶ 3 reps below threshold · alert dispatched to manager</div>
    </div>
    <div class="agent-card">
      <div class="a-head"><span class="ico">🔁</span><h3>Reconciler Agent</h3></div>
      <p>Deduplicates CRM accounts, validates ERP↔CRM bridges, heals inconsistencies across sources.</p>
      <div class="result">▶ 372 duplicate accounts removed · 18,484/19,829 customers matched</div>
    </div>
    <div class="agent-card">
      <div class="a-head"><span class="ico">✅</span><h3>Validator Agent</h3></div>
      <p>Checks referential integrity, semantic constraints, cardinalities, and entity ownership across the ontology.</p>
      <div class="result">▶ ERP↔CRM bridge validated · accuracy 99.7%</div>
    </div>
  </div>
  <div class="workflow">
    <div class="wf-step">PROPOSAL</div>
    <div class="wf-arrow">→</div>
    <div class="wf-step">VALIDATION<br><span style="font-size:6pt;color:#6b82a0">semantic layer</span></div>
    <div class="wf-arrow">→</div>
    <div class="wf-step">APPROVAL<br><span style="font-size:6pt;color:#6b82a0">manager</span></div>
    <div class="wf-arrow">→</div>
    <div class="wf-step">EXECUTION</div>
    <div class="wf-arrow">→</div>
    <div class="wf-step">AUDIT LOG<br><span style="font-size:6pt;color:#6b82a0">immutable</span></div>
  </div>
  <div class="slide-num">08 / 12</div>
</div>

<!-- ══════ SLIDE 9 · DEMO ══════ -->
<div class="slide" id="s9">
  <div class="slide-header">
    <div class="tag tag-teal">🏭 Live Demo</div>
    <h2>Manufacturing with <span class="accent">AdventureWorks</span> — ready today</h2>
  </div>
  <div class="journey">
    <div class="step"><span class="s-num">01</span><span class="s-ico">🔌</span><span class="s-lbl">Connect<br>3 sources</span></div>
    <div class="step"><span class="s-num">02</span><span class="s-ico">🧩</span><span class="s-lbl">Ontology<br>8 entities</span></div>
    <div class="step"><span class="s-num">03</span><span class="s-ico">🕸️</span><span class="s-lbl">Knowledge<br>Graph</span></div>
    <div class="step"><span class="s-num">04</span><span class="s-ico">📖</span><span class="s-lbl">Semantic<br>Layer</span></div>
    <div class="step"><span class="s-num">05</span><span class="s-ico">💬</span><span class="s-lbl">NL<br>Query</span></div>
    <div class="step"><span class="s-num">06</span><span class="s-ico">🤖</span><span class="s-lbl">Autonomous<br>Agents</span></div>
  </div>
  <div class="metrics-row">
    <div class="m-card"><div class="val">152K</div><div class="lbl">ERP rows</div></div>
    <div class="m-card"><div class="val">59K</div><div class="lbl">CRM rows</div></div>
    <div class="m-card"><div class="val">8.8s</div><div class="lbl">Full pipeline</div></div>
    <div class="m-card"><div class="val">145ms</div><div class="lbl">Avg NL query</div></div>
  </div>
  <div class="pipeline-log">
    <div class="log-line"><span class="ok">✓</span> [CONNECT] PostgreSQL ERP — connected in <span class="num">18ms</span></div>
    <div class="log-line"><span class="ok">✓</span> [EXTRACT] ERP · <span class="num">152,825</span> rows extracted · SQLite loaded in <span class="num">42ms</span></div>
    <div class="log-line"><span class="ok">✓</span> [MAP] Identity resolution: <span class="num">18,484 / 19,829</span> customers matched across ERP ↔ CRM</div>
    <div class="log-line"><span class="ok">✓</span> [ENRICH] <span class="num">372</span> duplicate CRM accounts removed · <span class="num">2</span> semantic ambiguities documented</div>
    <div class="log-line"><span class="ok">✓</span> [INDEX] DuckDB materialized · KG: <span class="num">193,062</span> nodes · <span class="num">313,218</span> edges in <span class="num">2.1s</span></div>
  </div>
  <div class="slide-num">09 / 12</div>
</div>

<!-- ══════ SLIDE 10 · SECTORS ══════ -->
<div class="slide" id="s10">
  <div class="slide-header">
    <div class="tag tag-plain">🌐 Verticals</div>
    <h2>One platform. <span class="accent">Four sectors.</span> Same semantic engine.</h2>
  </div>
  <div class="sector-grid">
    <div class="sector">
      <div class="s-head"><span class="ico">🏭</span><h3>Manufacturing</h3></div>
      <div class="sources">
        <span class="src-tag">ERP</span><span class="src-tag">CRM</span><span class="src-tag">HR</span><span class="src-tag">PIM</span><span class="src-tag">MES</span>
      </div>
      <ul>
        <li>Cross-source sales performance (ERP × HR)</li>
        <li>CRM deduplication &amp; bridge validation</li>
        <li>Supply chain visibility &amp; anomaly detection</li>
        <li style="color:#00c4b4;font-style:italic">Live demo available today with AdventureWorks</li>
      </ul>
    </div>
    <div class="sector">
      <div class="s-head"><span class="ico">🛒</span><h3>Retail</h3></div>
      <div class="sources">
        <span class="src-tag">POS</span><span class="src-tag">eCommerce</span><span class="src-tag">Inventory</span><span class="src-tag">CRM</span><span class="src-tag">Workforce</span>
      </div>
      <ul>
        <li>Unified Customer 360 across all touchpoints</li>
        <li>Inventory anomaly &amp; stockout prediction</li>
        <li>Cross-channel promotion effectiveness</li>
        <li>Workforce scheduling optimized to demand</li>
      </ul>
    </div>
    <div class="sector">
      <div class="s-head"><span class="ico">🏥</span><h3>Healthcare</h3></div>
      <div class="sources">
        <span class="src-tag">EHR Epic</span><span class="src-tag">HL7 FHIR</span><span class="src-tag">Claims</span><span class="src-tag">Lab</span><span class="src-tag">Scheduling</span>
      </div>
      <ul>
        <li>Patient pathway tracking across systems</li>
        <li>Clinical KPIs &amp; care pathway compliance</li>
        <li>Claims reconciliation &amp; billing anomaly detection</li>
        <li>Automated regulatory reporting</li>
      </ul>
    </div>
    <div class="sector">
      <div class="s-head"><span class="ico">🏦</span><h3>Finance</h3></div>
      <div class="sources">
        <span class="src-tag">Core Banking</span><span class="src-tag">Risk</span><span class="src-tag">AML</span><span class="src-tag">KYC</span><span class="src-tag">Loan</span>
      </div>
      <ul>
        <li>Fraud detection across KYC × transactional data</li>
        <li>AML pattern recognition with AI audit trail</li>
        <li>Regulatory reporting (EBA, Basel IV)</li>
        <li>Loan performance &amp; cross-portfolio risk</li>
      </ul>
    </div>
  </div>
  <div class="slide-num">10 / 12</div>
</div>

<!-- ══════ SLIDE 11 · WHY US ══════ -->
<div class="slide" id="s11">
  <div class="slide-header">
    <div class="tag tag-teal">🏆 Differentiators</div>
    <h2>Why <span class="accent">SemanticIntelligence</span></h2>
  </div>
  <div class="vs-table">
    <div class="vs-row">
      <div class="vs-cell header">Capability</div>
      <div class="vs-cell header us">SemanticIntelligence</div>
      <div class="vs-cell header">Traditional BI</div>
      <div class="vs-cell header">Generic GPT</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Natural language query</div>
      <div class="vs-cell us"><span class="chk">✓</span> Neuro-symbolic native</div>
      <div class="vs-cell"><span class="cross">✗</span> Requires SQL</div>
      <div class="vs-cell"><span class="part">◐</span> Generates arbitrary SQL</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Automatic cross-source joins</div>
      <div class="vs-cell us"><span class="chk">✓</span> Via Knowledge Graph</div>
      <div class="vs-cell"><span class="cross">✗</span> Manual, expensive</div>
      <div class="vs-cell"><span class="cross">✗</span> No ontology</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Full AI audit trail</div>
      <div class="vs-cell us"><span class="chk">✓</span> EU AI Act ready</div>
      <div class="vs-cell"><span class="cross">✗</span> Not applicable</div>
      <div class="vs-cell"><span class="cross">✗</span> No traceability</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Autonomous agents on data</div>
      <div class="vs-cell us"><span class="chk">✓</span> Monitor/Alert/Reconciler</div>
      <div class="vs-cell"><span class="cross">✗</span> Static dashboards only</div>
      <div class="vs-cell"><span class="part">◐</span> No governance</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Deterministic SQL (no hallucination)</div>
      <div class="vs-cell us"><span class="chk">✓</span> Signed templates</div>
      <div class="vs-cell"><span class="chk">✓</span> Direct SQL</div>
      <div class="vs-cell"><span class="cross">✗</span> Unverifiable output</div>
    </div>
    <div class="vs-row">
      <div class="vs-cell">Zero vendor lock-in</div>
      <div class="vs-cell us"><span class="chk">✓</span> Any DB, API-first</div>
      <div class="vs-cell"><span class="cross">✗</span> Often proprietary</div>
      <div class="vs-cell"><span class="part">◐</span> Depends on API</div>
    </div>
  </div>
  <div class="bottom-row">
    <div class="bottom-pill"><strong>1 day</strong>Live demo on your use cases</div>
    <div class="bottom-pill"><strong>2 weeks</strong>POC on real customer data</div>
    <div class="bottom-pill"><strong>60 days</strong>In production with active agents</div>
  </div>
  <div class="slide-num">11 / 12</div>
</div>

<!-- ══════ SLIDE 12 · NEXT STEPS ══════ -->
<div class="slide" id="s12">
  <div class="slide-header">
    <div class="tag tag-teal">🚀 Next Steps</div>
    <h2>Three ways to <span class="accent">start right now</span></h2>
  </div>
  <div class="cta-grid">
    <div class="cta-card">
      <div class="tier tier-teal">Live Demo</div>
      <h3>See it in action</h3>
      <div class="time">⏱ 45 minutes</div>
      <p>Personalized session for your sector. We show AdventureWorks or build a scenario around your specific business questions.</p>
      <ul>
        <li>Manufacturing / Retail / Healthcare / Finance</li>
        <li>Real questions from your business</li>
        <li>Full technical architecture walkthrough</li>
      </ul>
    </div>
    <div class="cta-card featured">
      <div class="tier tier-violet">POC</div>
      <h3>Try it on your data</h3>
      <div class="time">⏱ 2 weeks</div>
      <p>We connect one real source, build the domain ontology, and run 10 business queries. Measurable, documented results.</p>
      <ul>
        <li>1 customer data source (DB or API)</li>
        <li>Domain ontology from scratch</li>
        <li>Value report with full lineage</li>
      </ul>
    </div>
    <div class="cta-card">
      <div class="tier tier-gold">Pilot</div>
      <h3>Value in production</h3>
      <div class="time">⏱ 60 days</div>
      <p>One key domain fully live: semantic layer, active agents, governance configured, and KPIs measured and reported.</p>
      <ul>
        <li>Autonomous agents configured</li>
        <li>RBAC &amp; live audit trail</li>
        <li>Documented ROI at pilot close</li>
      </ul>
    </div>
  </div>
  <div class="contact-bar">
    <span>What you need for the POC: <strong>access to one data source</strong> · <strong>2–3 business questions</strong> · <strong>an IT contact</strong></span>
    <span class="email">demo@semanticintelligence.ai</span>
  </div>
  <div class="slide-num">12 / 12</div>
</div>

</body>
</html>
"""

out = Path(__file__).parent / "SemanticIntelligence_SalesDeck.pdf"
html_path = Path(__file__).parent / "_pdf_source.html"
html_path.write_text(PDF_HTML, encoding="utf-8")

try:
    from weasyprint import HTML, CSS
    HTML(filename=str(html_path)).write_pdf(str(out))
    print(f"PDF generated: {out}")
    html_path.unlink()
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
