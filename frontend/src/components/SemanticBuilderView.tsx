import { useState } from 'react'

// ── Color palette (matching the HTML prototype) ───────────────────────────────
const C = {
  obsidian:      '#0d0d0f',
  charcoal:      '#151518',
  panel:         '#1a1a1f',
  panelLight:    '#22222a',
  border:        '#2a2a35',
  borderBright:  '#3d3d50',
  cream:         '#f0ead8',
  creamDim:      '#c8bfa8',
  creamFaint:    '#6b6358',
  burgundy:      '#8b1a2e',
  burgundyBright:'#c42840',
  burgundyGlow:  'rgba(139,26,46,0.15)',
  gold:          '#b8962e',
  goldLight:     '#d4aa42',
  goldFaint:     'rgba(184,150,46,0.12)',
  mint:          '#2a8b6a',
  mintLight:     '#3ab882',
  violet:        '#5a3a8b',
  violetLight:   '#7a5ab8',
  textDim:       '#a09890',
  textFaint:     '#5a5450',
  blue:          '#82aaff',
  green:         '#c3e88d',
}

const ff = { serif: "'Cormorant Garamond', serif", mono: "'DM Mono', monospace", sans: "'Outfit', sans-serif" }

// ── AdventureWorks dataset constants ─────────────────────────────────────────
const AW = {
  company: 'AdventureWorks Distribution',
  tag: 'ADVENTUREWORKS · B2B + B2C · MULTI-SOURCE',
  sources: [
    { label: 'Products (PIM)', value: '504 SKUs', meta: 'GlobalPIM Legacy · JSON · USD' },
    { label: 'Customers (CRM)', value: '20,201', meta: 'ClientHub SQLite · B2C 19,491 · B2B 710' },
    { label: 'Sales Orders (ERP)', value: '31,465', meta: 'OrionSales PostgreSQL · 2011–2014' },
    { label: 'Employees (HR)', value: '290', meta: 'HR CSV · Italian fields · Mixed dates' },
    { label: 'Revenue (ERP)', value: '$9.8M ⚠', meta: '2 conflicting definitions!' },
    { label: 'Territories', value: '10 regions', meta: 'US · EU · AU · CA · Pacific' },
  ],
  stackLayers: [
    { name: 'Taxonomy', tech: '5 categories · 40+ nodes', tag: 'v1', tagColor: C.burgundyBright },
    { name: 'Ontology', tech: 'OWL · 12 classes · SHACL', tag: 'v1', tagColor: C.burgundyBright },
    { name: 'Knowledge Graph', tech: 'Neo4j · ~55K nodes', tag: 'LIVE', tagColor: C.mintLight },
    { name: 'Semantic Layer', tech: 'dbt MetricFlow · 8 metrics', tag: '8 metrics', tagColor: C.goldLight },
    { name: 'Metadata Layer', tech: 'DataHub · 3 stewards', tag: 'active', tagColor: C.textDim },
  ],
}

// ── Shared mini-components ────────────────────────────────────────────────────
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ background: C.panelLight, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '.08em', color: C.textDim, textTransform: 'uppercase', fontWeight: 500, fontFamily: ff.sans }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  )
}

function Tag({ children, color = C.textFaint, bg = 'transparent', borderColor = C.border }: { children: React.ReactNode; color?: string; bg?: string; borderColor?: string }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 9, fontFamily: ff.mono, letterSpacing: '.08em', padding: '2px 7px', borderRadius: 2, border: `1px solid ${borderColor}`, color, background: bg, margin: '0 2px' }}>
      {children}
    </span>
  )
}

function Check({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) {
  const bg = ok ? 'rgba(42,139,106,0.1)' : warn ? 'rgba(184,150,46,0.1)' : 'rgba(139,26,46,0.1)'
  const border = ok ? 'rgba(42,139,106,0.25)' : warn ? 'rgba(184,150,46,0.25)' : 'rgba(139,26,46,0.25)'
  const color = ok ? C.mintLight : warn ? C.goldLight : '#e05070'
  const icon = ok ? '✓' : warn ? '⚠' : '✗'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 13px', borderRadius: 4, marginBottom: 6, fontSize: 12, background: bg, border: `1px solid ${border}`, color, fontFamily: ff.sans }}>
      <span style={{ flexShrink: 0, fontSize: 13 }}>{icon}</span>
      <span style={{ lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function RelRow({ from, verb, to, card }: { from: string; verb: string; to: string; card?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}`, fontFamily: ff.mono, fontSize: 11 }}>
      <span style={{ color: C.cream, fontWeight: 500 }}>{from}</span>
      <span style={{ color: C.textFaint }}>──</span>
      <span style={{ color: C.violetLight }}>{verb}</span>
      <span style={{ color: C.textFaint }}>──▶</span>
      <span style={{ color: C.mintLight }}>{to}</span>
      {card && <span style={{ color: C.textFaint, fontSize: 9, marginLeft: 'auto' }}>{card}</span>}
    </div>
  )
}

function CodeBlock({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.obsidian, border: `1px solid ${C.border}`, borderRadius: 4, padding: '13px 15px', fontFamily: ff.mono, fontSize: 11, lineHeight: 1.75, overflowX: 'auto', color: C.textDim, ...style }}>
      {children}
    </div>
  )
}

function CQ({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panelLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: '9px 13px', marginBottom: 7, fontSize: 12, color: C.creamDim, display: 'flex', alignItems: 'flex-start', gap: 10, lineHeight: 1.5, fontFamily: ff.sans }}>
      <span style={{ fontFamily: ff.mono, fontSize: 10, color: C.goldLight, flexShrink: 0, marginTop: 2 }}>{num}</span>
      <span>{children}</span>
    </div>
  )
}

function GuideCallout({ section, children }: { section: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, borderLeft: `2px solid ${C.gold}`, padding: '11px 15px', marginBottom: 26, borderRadius: '0 4px 4px 0' }}>
      <div style={{ fontFamily: ff.mono, fontSize: 9, letterSpacing: '.12em', color: C.goldLight, textTransform: 'uppercase', marginBottom: 4 }}>📖 {section}</div>
      <div style={{ fontSize: 12, color: C.creamDim, lineHeight: 1.55, fontStyle: 'italic', fontFamily: ff.sans }}>{children}</div>
    </div>
  )
}

function Kw({ c, children }: { c: string; children: React.ReactNode }) {
  return <span style={{ color: c }}>{children}</span>
}

// ── Step 1: Taxonomy ──────────────────────────────────────────────────────────
const TAXONOMY_TREE = [
  { id: 'bikes', label: 'Bikes', count: 97, children: [
    { id: 'road', label: 'Road Bikes', count: 43, children: [] },
    { id: 'mountain', label: 'Mountain Bikes', count: 36, children: [] },
    { id: 'touring', label: 'Touring Bikes', count: 18, children: [] },
  ]},
  { id: 'components', label: 'Components', count: 134, children: [
    { id: 'brakes', label: 'Brakes', count: 11, children: [] },
    { id: 'chainrings', label: 'Chainrings', count: 9, children: [] },
    { id: 'derailleurs', label: 'Derailleurs', count: 13, children: [] },
    { id: 'forks', label: 'Forks', count: 7, children: [] },
    { id: 'handlebars', label: 'Handlebars', count: 14, children: [] },
    { id: 'wheels', label: 'Wheels / Tires', count: 42, isNew: true, children: [] },
  ]},
  { id: 'clothing', label: 'Clothing', count: 35, children: [
    { id: 'jerseys', label: 'Jerseys', count: 10, children: [] },
    { id: 'shorts', label: 'Shorts / Bib-Shorts', count: 9, children: [] },
    { id: 'gloves', label: 'Gloves', count: 6, children: [] },
    { id: 'caps', label: 'Caps & Helmets', count: 10, children: [] },
  ]},
  { id: 'accessories', label: 'Accessories', count: 29, children: [
    { id: 'bottles', label: 'Bottles & Hydration', count: 8, children: [] },
    { id: 'lights', label: 'Lights & Safety', count: 7, children: [] },
    { id: 'pumps', label: 'Pumps & Repair', count: 8, children: [] },
    { id: 'racks', label: 'Racks & Stands', count: 6, children: [] },
  ]},
  { id: 'uncategorized', label: 'Uncategorized (legacy)', count: 209, children: [] },
]

const ATTR_TABLE = [
  { category: 'Bikes', own: 'frame_size, gender, speed_count, material', inherited: 'sku, name, listPrice, standardCost', products: 97, source: 'PIM' },
  { category: 'Road Bikes', own: 'road_type (race/sport/fitness)', inherited: 'frame_size, gender, sku', products: 43, source: 'PIM' },
  { category: 'Mountain Bikes', own: 'suspension (hard/full/none), trail_rating', inherited: 'frame_size, gender, sku', products: 36, source: 'PIM' },
  { category: 'Clothing', own: 'gender, size (XS-XXL), material_pct', inherited: 'sku, name, listPrice', products: 35, source: 'PIM' },
  { category: 'Components', own: 'compatibility_std (ISO/JTIS), weight_g', inherited: 'sku, name, standardCost', products: 134, source: 'PIM' },
]

function TaxNode({ node, depth = 0 }: { node: typeof TAXONOMY_TREE[0]; depth?: number }) {
  const [open, setOpen] = useState(depth === 0)
  const [sel, setSel] = useState(false)
  return (
    <div>
      <div
        onClick={() => { setOpen(!open); setSel(!sel) }}
        style={{ padding: '4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: sel ? C.goldLight : C.textDim, paddingLeft: depth * 16, fontFamily: ff.mono, fontSize: 12 }}
        onMouseEnter={e => { if (!sel) (e.target as HTMLElement).style.color = C.cream }}
        onMouseLeave={e => { if (!sel) (e.target as HTMLElement).style.color = C.textDim }}
      >
        {node.children.length > 0 && (
          <span style={{ fontSize: 9, color: C.textFaint, transition: 'transform .2s', display: 'inline-block', transform: open ? 'rotate(90deg)' : '' }}>▶</span>
        )}
        {node.children.length === 0 && <span style={{ color: C.textFaint }}>·</span>}
        <span>{node.label}</span>
        {'isNew' in node && (node as { isNew?: boolean }).isNew && <span style={{ color: C.mintLight, fontSize: 9, marginLeft: 4 }}>NEW</span>}
        <span style={{ fontSize: 9, color: C.textFaint, marginLeft: 'auto' }}>{node.count}</span>
      </div>
      {open && node.children.length > 0 && (
        <div style={{ paddingLeft: 20, borderLeft: `1px solid ${C.border}`, marginLeft: 6 }}>
          {node.children.map(c => <TaxNode key={c.id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

function Step1Taxonomy() {
  const [newNodes, setNewNodes] = useState<string[]>([])
  const [nodeName, setNodeName] = useState('')
  return (
    <div>
      <GuideCallout section="Guide Reference — Chapter 1.4 + Part 5">
        "Una tassonomia è solo una gerarchia di categorie. Un'ontologia ha gerarchia + proprietà + relazioni + regole logiche. La tassonomia è un sottoinsieme dell'ontologia." AdventureWorks products span Bikes, Components, Clothing, and Accessories — each with distinct attribute schemas.
      </GuideCallout>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel title="Taxonomy Tree — AdventureWorks PIM" action={<Tag color={C.mintLight} borderColor={C.mint} bg="rgba(42,139,106,0.1)">5 categories</Tag>}>
          <div>{TAXONOMY_TREE.map(n => <TaxNode key={n.id} node={n} />)}</div>
          {newNodes.map(n => <div key={n} style={{ padding: '4px 0', fontFamily: ff.mono, fontSize: 12, color: C.mintLight }}>· {n}</div>)}
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Add New Category">
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, fontFamily: ff.mono, display: 'block', marginBottom: 5 }}>Parent Category</label>
              <select style={{ width: '100%', background: C.obsidian, border: `1px solid ${C.border}`, borderRadius: 3, padding: '7px 11px', color: C.textDim, fontSize: 12, fontFamily: ff.sans, outline: 'none' }}>
                <option>Bikes</option><option>Components</option><option>Clothing</option><option>Accessories</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, fontFamily: ff.mono, display: 'block', marginBottom: 5 }}>Category Name</label>
              <input
                value={nodeName}
                onChange={e => setNodeName(e.target.value)}
                placeholder="e.g. E-Bikes"
                style={{ width: '100%', background: C.obsidian, border: `1px solid ${C.border}`, borderRadius: 3, padding: '7px 11px', color: C.cream, fontSize: 12, fontFamily: ff.sans, outline: 'none' }}
              />
            </div>
            <button
              onClick={() => { if (nodeName.trim()) { setNewNodes(p => [...p, nodeName.trim()]); setNodeName('') } }}
              style={{ width: '100%', background: C.burgundyGlow, border: `1px solid ${C.burgundy}`, borderRadius: 3, padding: '8px 0', color: C.cream, fontSize: 11, letterSpacing: '.06em', cursor: 'pointer', fontFamily: ff.sans, textTransform: 'uppercase' }}
            >
              Add to Taxonomy
            </button>
          </Panel>
          <Panel title="Validation Status">
            <Check ok>4-level hierarchy consistent (root → cat → subcat → sku)</Check>
            <Check ok>No circular parents detected</Check>
            <Check warn>209 products uncategorized (legacy PIM — no categoryPath)</Check>
            <Check ok>All 295 categorized nodes have sku + listPrice</Check>
            <Check warn>standardCost = 0 for 12% of products</Check>
          </Panel>
        </div>
      </div>
      <Panel title="Category-Level Attribute Schema" action={<span style={{ fontFamily: ff.mono, fontSize: 10, color: C.textFaint }}>inherited attrs in grey</span>}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: ff.mono }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Category', 'Attrs (own)', 'Attrs (inherited)', 'Products', 'Source'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 9px', color: C.textFaint, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ATTR_TABLE.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 9px', color: C.cream }}>{r.category}</td>
                  <td style={{ padding: '6px 9px', color: C.goldLight }}>{r.own}</td>
                  <td style={{ padding: '6px 9px', color: C.textFaint }}>{r.inherited}</td>
                  <td style={{ padding: '6px 9px', color: C.mintLight }}>{r.products}</td>
                  <td style={{ padding: '6px 9px', color: C.textDim }}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

// ── Step 2: Ontology ──────────────────────────────────────────────────────────
const ONT_TABS = ['1. Use Case & CQ', '2. Stakeholders', '3. Reuse', '4. Classes', '5. Relations', '6. Constraints', '7. Validate']

function Step2Ontology() {
  const [tab, setTab] = useState(0)
  return (
    <div>
      <GuideCallout section='Guide Reference — Section 3.1 "Il metodo in 7 passi"'>
        "Definire il caso d'uso operativo. L'ontologia serve a fare cosa? [...] Scrivi 2-3 'competency questions': domande concrete che l'ontologia deve permettere di rispondere."
      </GuideCallout>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {ONT_TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{ padding: '7px 14px', fontSize: 11, color: tab === i ? C.goldLight : C.textDim, cursor: 'pointer', background: 'none', border: 'none', borderBottom: tab === i ? `2px solid ${C.gold}` : '2px solid transparent', transition: 'all .15s', fontFamily: ff.sans, letterSpacing: '.04em', marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <Panel title="Operational Use Case" action={undefined}>
              <p style={{ fontSize: 13, color: C.cream, lineHeight: 1.6, marginBottom: 12, fontFamily: ff.sans }}><strong>AdventureWorks Sales Intelligence Agent</strong><br />The agent must answer cross-source business questions: revenue by territory, salesperson performance, customer retention, margin by product category — joining ERP orders with HR employees, CRM customers, and PIM products.</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['OrionSales ERP', 'ClientHub CRM', 'GlobalPIM', 'HR CSV'].map(s => <Tag key={s} color={C.blue} borderColor="rgba(130,170,255,0.3)" bg="rgba(130,170,255,0.06)">{s}</Tag>)}
              </div>
            </Panel>
            <div style={{ marginTop: 16 }}>
              <Panel title="Competency Questions (CQ)">
                <CQ num="CQ1">What is the total revenue by territory for 2014 vs sales quotas per rep?</CQ>
                <CQ num="CQ2">Which salesperson had the highest margin per order in Q4 2013?</CQ>
                <CQ num="CQ3">Which B2C customers spent &gt;$5,000 and have not ordered in 180 days?</CQ>
                <CQ num="CQ4">What is the gross margin for Mountain Bikes, using standardCost from PIM?</CQ>
                <CQ num="CQ5">Are there customers with duplicate accounts in the CRM (ID &lt; 0 pattern)?</CQ>
                <button style={{ marginTop: 10, background: 'rgba(42,139,106,0.1)', border: `1px solid rgba(42,139,106,0.2)`, borderRadius: 3, padding: '6px 13px', color: C.mintLight, fontSize: 11, cursor: 'pointer', fontFamily: ff.sans }}>+ Add CQ</button>
              </Panel>
            </div>
          </div>
          <Panel title="OWL Ontology Preview">
            <CodeBlock style={{ fontSize: 10.5, lineHeight: 1.8 }}>
              <Kw c={C.textFaint}># AdventureWorks Business Ontology v1.0</Kw>{'\n'}
              <Kw c={C.textFaint}># Sources: ERP + CRM + HR + PIM</Kw>{'\n\n'}
              <Kw c="#c792ea">@prefix</Kw>{' aw: <https://adventureworks.io/ontology#> .\n'}
              <Kw c="#c792ea">@prefix</Kw>{' schema: <https://schema.org/> .\n\n'}
              <Kw c={C.textFaint}># === CLASSES ===</Kw>{'\n'}
              {'aw:'}<Kw c={C.mintLight}>Customer</Kw>{' '}<Kw c="#c792ea">a</Kw>{' owl:Class ;\n'}
              {'  rdfs:subClassOf schema:Person ;\n'}
              {'  '}<Kw c={C.textFaint}># B2C: nomeContatto; B2B: ragioneSociale</Kw>{'\n\n'}
              {'aw:'}<Kw c={C.mintLight}>SalesOrder</Kw>{' '}<Kw c="#c792ea">a</Kw>{' owl:Class ;\n'}
              {'  rdfs:subClassOf schema:Order .\n\n'}
              {'aw:'}<Kw c={C.mintLight}>Employee</Kw>{' '}<Kw c="#c792ea">a</Kw>{' owl:Class ;\n'}
              {'  rdfs:comment '}<Kw c={C.green}>"Also a Salesperson via ERP join"</Kw>{' .\n\n'}
              {'aw:'}<Kw c={C.mintLight}>Product</Kw>{' '}<Kw c="#c792ea">a</Kw>{' owl:Class ;\n'}
              {'  rdfs:subClassOf schema:Product .\n\n'}
              <Kw c={C.textFaint}># === KEY PROPERTIES ===</Kw>{'\n'}
              {'aw:'}<Kw c={C.goldLight}>revenue</Kw>{' '}<Kw c="#c792ea">a</Kw>{' owl:DatatypeProperty ;\n'}
              {'  '}<Kw c={C.textFaint}># ⚠ AMBIGUOUS: subtotal_amount vs total_due</Kw>{'\n'}
              {'  rdfs:domain aw:SalesOrder .\n'}
            </CodeBlock>
          </Panel>
        </div>
      )}
      {tab === 1 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            {[
              { icon: '📊', name: 'Sarah Chen', role: 'Senior Data Architect', org: 'ex-Palantir · OWL + SPARQL', tags: ['SalesOrder', 'Revenue', 'Territory'], tagColor: C.burgundyBright },
              { icon: '⚙️', name: 'Marco Rossi', role: 'Data Engineering Lead', org: 'dbt + Snowflake + Fivetran', tags: ['dbt', 'PostgreSQL', 'SQLite'], tagColor: C.mintLight },
              { icon: '🚴', name: 'Andrea Müller', role: 'Domain Expert — Sales', org: 'Head of Sales Analytics, 8 yrs', tags: ['Revenue', 'Territory', 'Quota'], tagColor: C.goldLight },
            ].map(s => (
              <Panel key={s.name} title={s.role}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 13, color: C.cream, fontWeight: 500, marginBottom: 4, fontFamily: ff.sans }}>{s.name}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontFamily: ff.sans }}>{s.org}</div>
                <div>{s.tags.map(t => <Tag key={t} color={s.tagColor}>{t}</Tag>)}</div>
              </Panel>
            ))}
          </div>
          <Panel title="Business Sponsor">
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontSize: 28 }}>💼</span>
              <div>
                <div style={{ fontSize: 14, color: C.cream, fontWeight: 500, fontFamily: ff.sans }}>James Wilson — VP Analytics</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, fontFamily: ff.sans }}>KPIs: single revenue definition by Q2, agent answers 25 golden questions at ≥90% accuracy, no manual Excel joins for territory reports.</div>
              </div>
              <Check ok>Sponsor confirmed</Check>
            </div>
          </Panel>
        </div>
      )}
      {tab === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Existing Ontologies — Reuse Analysis">
            {[
              { name: 'Schema.org/Organization', desc: 'Business entity, contact points, addresses', reuse: '60% reuse', adopted: true },
              { name: 'Schema.org/Order', desc: 'Order model: items, price, status', reuse: '75% reuse', adopted: true },
              { name: 'GoodRelations (gr:)', desc: 'Pricing, offerings, business entities', reuse: '30% reuse', adopted: true },
              { name: 'FIBO (Finance)', desc: 'Not relevant for distribution company', reuse: 'N/A', adopted: false },
            ].map(r => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.cream, fontSize: 12, fontWeight: 500, fontFamily: ff.sans }}>{r.name}</div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: ff.sans }}>{r.desc}</div>
                </div>
                {r.adopted
                  ? <><Tag color={C.goldLight} bg={C.goldFaint} borderColor={C.gold}>{r.reuse}</Tag><Tag color={C.mintLight} borderColor="rgba(42,139,106,0.3)" bg="rgba(42,139,106,0.08)">✓ Adopted</Tag></>
                  : <Tag>✗ Skip</Tag>}
              </div>
            ))}
          </Panel>
          <Panel title="Custom Classes (not in existing ontologies)">
            <Check warn><strong>aw:Territory</strong> — Sales territory with quota assignment. No standard equivalent.</Check>
            <Check warn><strong>aw:SalesQuota</strong> — Rep-level sales quota per period. Finance-specific concept.</Check>
            <Check warn><strong>aw:SpecialOffer</strong> — Discount offers tied to order lines. Schema.org Offer too broad.</Check>
            <Check ok>All other 9 classes covered by Schema.org + GoodRelations reuse</Check>
          </Panel>
        </div>
      )}
      {tab === 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Core Classes (12 total — guide max 20)" action={<button style={{ padding: '3px 9px', fontSize: 10, background: 'rgba(42,139,106,0.1)', border: `1px solid rgba(42,139,106,0.2)`, borderRadius: 3, color: C.mintLight, cursor: 'pointer', fontFamily: ff.sans }}>+ Class</button>}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: C.textFaint, fontFamily: ff.mono, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Commerce Domain</div>
              {['Customer', 'SalesOrder', 'OrderLine', 'SpecialOffer', 'Territory', 'SalesQuota'].map(c => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.burgundyGlow, border: `1px solid ${C.burgundy}`, borderRadius: 3, padding: '4px 9px', margin: 2, fontSize: 11, fontFamily: ff.mono, color: C.cream, cursor: 'pointer' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.cream, display: 'inline-block' }} />{c}
                </span>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textFaint, fontFamily: ff.mono, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>People & Products</div>
              {['Employee', 'Salesperson', 'Product', 'Category', 'Address', 'Contact'].map(c => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.burgundyGlow, border: `1px solid ${C.burgundy}`, borderRadius: 3, padding: '4px 9px', margin: 2, fontSize: 11, fontFamily: ff.mono, color: C.cream, cursor: 'pointer' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.cream, display: 'inline-block' }} />{c}
                </span>
              ))}
            </div>
          </Panel>
          <Panel title="Class Properties — SalesOrder">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: ff.mono }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Property', 'Type', 'Req', 'Source'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 7px', color: C.textFaint, fontSize: 9 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  ['order_id', 'xsd:integer', '✓', 'ERP'],
                  ['order_date', 'xsd:date', '✓', 'ERP'],
                  ['subtotal_amount', 'xsd:decimal', '✓', 'ERP'],
                  ['total_due', 'xsd:decimal', '✓', 'ERP'],
                  ['customer_ref', 'aw:Customer', '✓', 'ERP→CRM'],
                  ['salesperson_ref', 'aw:Employee', '✓', 'ERP→HR'],
                  ['territory_ref', 'aw:Territory', '○', 'ERP'],
                ].map(([p, t, r, s]) => (
                  <tr key={p as string} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '4px 7px', color: C.cream }}>{p}</td>
                    <td style={{ padding: '4px 7px', color: C.violetLight }}>{t}</td>
                    <td style={{ padding: '4px 7px', color: r === '✓' ? C.mintLight : C.textFaint }}>{r}</td>
                    <td style={{ padding: '4px 7px', color: C.textDim }}>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
      {tab === 4 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Object Properties (Relations)">
            <RelRow from="Customer" verb="placed" to="SalesOrder" card="[0..*]" />
            <RelRow from="SalesOrder" verb="contains" to="OrderLine" card="[1..*]" />
            <RelRow from="OrderLine" verb="refersTo" to="Product" card="[1..1]" />
            <RelRow from="OrderLine" verb="usesOffer" to="SpecialOffer" card="[0..1]" />
            <RelRow from="SalesOrder" verb="managedBy" to="Employee" card="[1..1]" />
            <RelRow from="Employee" verb="coversTerr" to="Territory" card="[1..*]" />
            <RelRow from="Employee" verb="hasQuota" to="SalesQuota" card="[0..*]" />
            <RelRow from="Customer" verb="hasAddress" to="Address" card="[1..*]" />
            <RelRow from="Product" verb="belongsTo" to="Category" card="[1..1]" />
            <div style={{ height: 8 }} />
            <button style={{ background: C.burgundyGlow, border: `1px solid ${C.burgundy}`, borderRadius: 3, padding: '7px 14px', color: C.cream, fontSize: 11, cursor: 'pointer', fontFamily: ff.sans }}>Add Relation</button>
          </Panel>
          <Panel title="Cross-Source Key Bridges">
            <div style={{ fontFamily: ff.mono, fontSize: 11, marginBottom: 12 }}>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, color: C.textDim }}>
                <span style={{ color: C.goldLight }}>customer_ref</span> (ERP) → <span style={{ color: C.mintLight }}>accountId</span> (CRM)
              </div>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, color: C.textDim }}>
                <span style={{ color: C.goldLight }}>salesperson_ref</span> (ERP) → <span style={{ color: C.mintLight }}>MatricolaDip</span> (HR)
              </div>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, color: C.textDim }}>
                <span style={{ color: C.goldLight }}>product_ref</span> (ERP) → <span style={{ color: C.mintLight }}>internal_id</span> (PIM)
              </div>
              <div style={{ padding: '6px 0', color: C.textDim }}>
                <span style={{ color: C.goldLight }}>territory_ref</span> (ERP) → <span style={{ color: C.mintLight }}>territoryHint</span> (CRM)
              </div>
            </div>
            <Check warn>Key names differ across all 4 sources — ontology resolves via mapping</Check>
          </Panel>
        </div>
      )}
      {tab === 5 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Logical Constraints & Business Rules">
            <Check ok>SalesOrder.subtotal_amount ≥ 0 (SHACL sh:minInclusive 0)</Check>
            <Check ok>Customer.accountId unique in CRM — deduplicate by email + name</Check>
            <Check ok>Employee.MatricolaDip = SalesOrder.salesperson_ref (aw:sameAs)</Check>
            <Check ok>Product.listPrice &gt; 0 (sh:minExclusive 0)</Check>
            <Check warn>Customer with accountId &lt; 0 → flagged as duplicate (1.9% of CRM)</Check>
            <Check warn>HR date format DD/MM/YYYY → must normalize to ISO before join</Check>
            <Check warn>SpecialOffer.offer_ref = 1 means "no offer" — exclude from discount analysis</Check>
          </Panel>
          <Panel title="SHACL Shape — CustomerShape">
            <CodeBlock style={{ fontSize: 10 }}>
              <Kw c="#c792ea">aw:CustomerShape</Kw>{'\n'}
              {'  '}<Kw c={C.blue}>a</Kw>{' sh:NodeShape ;\n'}
              {'  sh:targetClass aw:'}<Kw c={C.mintLight}>Customer</Kw>{' ;\n\n'}
              {'  sh:property [\n'}
              {'    sh:path aw:'}<Kw c={C.goldLight}>accountId</Kw>{' ;\n'}
              {'    sh:minCount '}<Kw c="#f78c6c">1</Kw>{' ;\n'}
              {'    sh:maxCount '}<Kw c="#f78c6c">1</Kw>{' ;\n'}
              {'    sh:datatype xsd:integer ;\n'}
              {'    '}<Kw c={C.textFaint}># ⚠ Negative IDs = duplicates</Kw>{'\n'}
              {'    sh:minInclusive '}<Kw c="#f78c6c">1</Kw>{' ;\n'}
              {'  ] ;\n'}
              {'  sh:property [\n'}
              {'    sh:path aw:'}<Kw c={C.goldLight}>emailContatto</Kw>{' ;\n'}
              {'    sh:pattern '}<Kw c={C.green}>"^[^@]+@[^@]+$"</Kw>{' ;\n'}
              {'  ] .'}
            </CodeBlock>
          </Panel>
        </div>
      )}
      {tab === 6 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Real Records Validation — 50 AdventureWorks rows">
            <div style={{ fontFamily: ff.mono, fontSize: 11, marginBottom: 12, color: C.textDim }}>Instantiating ERP+PIM+CRM data against ontology constraints...</div>
            {[
              { ok: true, text: '31,465 SalesOrder nodes instantiated — all required fields present' },
              { ok: true, text: '20,201 Customer nodes — 19,828 with valid email (98.2%)' },
              { ok: false, text: '384 Customer accounts have negative accountId (1.9%) — flagged as duplicates' },
              { ok: true, text: '504 Product nodes — all have sku + internal_id' },
              { ok: false, text: '209 products have empty categoryPath — mapped to aw:Uncategorized' },
              { ok: true, text: '290 Employee nodes — all have MatricolaDip key' },
              { warn: true, text: '~3% RetribuzioneOraria null in HR CSV — non-critical field' },
            ].map((c, i) => <Check key={i} ok={c.ok} warn={c.warn}>{c.text}</Check>)}
          </Panel>
          <Panel title="CQ Answerable Check">
            {[
              { status: '✓', ok: true, num: 'CQ1', text: 'Revenue by territory: SalesOrder→territory_ref→Territory ✓' },
              { status: '✓', ok: true, num: 'CQ2', text: 'Margin per salesperson: SalesOrder→Employee + OrderLine→Product.standardCost ✓' },
              { status: '✓', ok: true, num: 'CQ3', text: 'Inactive customers: Customer→SalesOrder with date filter ✓' },
              { status: '⚠', ok: false, num: 'CQ4', text: 'Mountain Bike margin: needs categoryPath fix — 209 uncategorized products block' },
              { status: '✓', ok: true, num: 'CQ5', text: 'CRM dedup: Customer WHERE accountId < 0 → 384 duplicates identified ✓' },
            ].map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 4, marginBottom: 6, background: c.ok ? 'rgba(42,139,106,0.06)' : 'rgba(184,150,46,0.08)', border: `1px solid ${c.ok ? 'rgba(42,139,106,0.2)' : 'rgba(184,150,46,0.25)'}`, fontSize: 12, fontFamily: ff.sans, color: C.creamDim }}>
                <span style={{ fontFamily: ff.mono, fontSize: 10, color: c.ok ? C.mintLight : C.goldLight, flexShrink: 0 }}>{c.num} {c.status}</span>
                <span>{c.text}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Knowledge Graph ───────────────────────────────────────────────────
const KG_TABS = ['1. Scope', '2. Modeling', '3. Ingestion', '4. Enrichment', '5. Query', '6. Governance']

function Step3KG() {
  const [tab, setTab] = useState(0)
  const [ran, setRan] = useState(false)
  return (
    <div>
      <GuideCallout section='Guide Reference — Section 3.2 + 6.2.2'>
        "Il knowledge graph è il livello operativo: prende l'ontologia e la popola con dati reali, integra dati da molteplici fonti aziendali. È un progetto di data engineering tanto quanto di data modeling."
      </GuideCallout>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {KG_TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{ padding: '7px 14px', fontSize: 11, color: tab === i ? C.goldLight : C.textDim, cursor: 'pointer', background: 'none', border: 'none', borderBottom: tab === i ? `2px solid ${C.gold}` : '2px solid transparent', transition: 'all .15s', fontFamily: ff.sans, letterSpacing: '.04em', marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="Domain — Sales Intelligence 360">
            {[
              { type: 'Focus Domain', id: 'Cross-Source Sales KG', props: ['31,465 orders', '3 sources', '4+ key types'], ok: true },
              { type: 'Primary Sources', id: 'OrionSales ERP + ClientHub CRM + HR + PIM', props: ['Orders', 'Customers', 'Employees', 'Products'], ok: false },
              { type: 'Use Cases Supported', id: 'AI Analytics Agent + Report Agent + Dedup Alert', props: ['Revenue Analysis', 'Territory Perf.', 'Customer 360'], ok: true },
            ].map(n => (
              <div key={n.id} style={{ background: C.panelLight, border: `1px solid ${n.ok ? C.mint : C.border}`, borderRadius: 6, padding: 12, marginBottom: 8, position: 'relative' }}>
                <div style={{ fontSize: 9, fontFamily: ff.mono, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, marginBottom: 4 }}>{n.type}</div>
                <div style={{ fontSize: 14, color: C.cream, fontWeight: 500, fontFamily: ff.sans }}>{n.id}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {n.props.map(p => <span key={p} style={{ fontFamily: ff.mono, fontSize: 9, background: n.ok ? 'rgba(42,139,106,0.08)' : C.panel, border: `1px solid ${n.ok ? C.mint : C.border}`, padding: '2px 6px', borderRadius: 2, color: n.ok ? C.mintLight : C.textDim }}>{p}</span>)}
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="KG Statistics (Live)">
            <table style={{ width: '100%', fontFamily: ff.mono, fontSize: 12, borderCollapse: 'collapse' }}>
              {[
                ['Nodes total', '~55,460'],
                ['Relationships total', '~180,000'],
                ['(:Customer) nodes', '20,201'],
                ['(:SalesOrder) nodes', '31,465'],
                ['(:Product) nodes', '504'],
                ['(:Employee) nodes', '290'],
                ['[:PLACED] edges', '31,465'],
                ['Last full refresh', '4h 22min ago'],
              ].map(([k, v], i) => (
                <tr key={k} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '7px 0', color: C.textDim }}>{k}</td>
                  <td style={{ padding: '7px 0', textAlign: 'right', color: i < 7 ? C.mintLight : C.cream }}>{v}</td>
                </tr>
              ))}
            </table>
          </Panel>
        </div>
      )}
      {tab === 1 && (
        <Panel title="Graph Schema — Cypher LPG">
          <CodeBlock style={{ fontSize: 11 }}>
            <Kw c={C.textFaint}>// AdventureWorks KG Schema — Neo4j LPG{'\n'}</Kw>
            <Kw c={C.textFaint}>// 4 source systems resolved into single graph{'\n\n'}</Kw>
            <Kw c={C.textFaint}>// CUSTOMER SUBGRAPH (from ClientHub CRM){'\n'}</Kw>
            {'('}<Kw c={C.mintLight}>:Customer</Kw>{' {accountId, displayName, accountType:'}<Kw c={C.green}>'B2C'</Kw>{'|'}<Kw c={C.green}>'B2B'</Kw>{', email, territory})\n'}
            {'  -['}<Kw c="#f78c6c">:PLACED</Kw>{' {channel}]->\n'}
            {'('}<Kw c={C.mintLight}>:SalesOrder</Kw>{' {orderId, orderDate, subtotalAmount, totalDue})\n'}
            {'  -['}<Kw c="#f78c6c">:CONTAINS</Kw>{' {qty, lineTotal, unitPrice}]->\n'}
            {'('}<Kw c={C.mintLight}>:Product</Kw>{' {sku, displayName, listPrice, standardCost})\n\n'}
            <Kw c={C.textFaint}>// SALES SUBGRAPH (from OrionSales ERP + HR CSV){'\n'}</Kw>
            {'('}<Kw c={C.mintLight}>:Employee</Kw>{' {matricola, fullName, department, role})\n'}
            {'  -['}<Kw c="#f78c6c">:MANAGES</Kw>{']->\n'}
            {'('}<Kw c={C.mintLight}>:SalesOrder</Kw>{')\n\n'}
            {'('}<Kw c={C.mintLight}>:Employee</Kw>{')\n'}
            {'  -['}<Kw c="#f78c6c">:COVERS</Kw>{' {since, quota_usd}]->\n'}
            {'('}<Kw c={C.mintLight}>:Territory</Kw>{' {name, region, country})\n\n'}
            <Kw c={C.textFaint}>// PRODUCT HIERARCHY (from GlobalPIM){'\n'}</Kw>
            {'('}<Kw c={C.mintLight}>:Product</Kw>{')-['}<Kw c="#f78c6c">:BELONGS_TO</Kw>{']->('},
            <Kw c={C.mintLight}>:Category</Kw>{' {name, level})\n'}
          </CodeBlock>
        </Panel>
      )}
      {tab === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <Panel title="Extract — 3 Sources">
            <Check ok>OrionSales ERP → 31,465 orders (PostgreSQL dump → batch load)</Check>
            <Check ok>ClientHub CRM → 20,201 accounts (SQLite → daily CDC)</Check>
            <Check ok>GlobalPIM JSON → 504 products (file watch → nightly)</Check>
            <Check warn>HR CSV → 290 employees (manual upload · date format: DD/MM/YYYY)</Check>
          </Panel>
          <Panel title="Transform — Identity Resolution">
            <div style={{ fontFamily: ff.mono, fontSize: 11, marginBottom: 12, color: C.textDim }}>Cross-source key bridges:</div>
            <Check warn>customer_ref (ERP) ≡ accountId (CRM) — confirmed via sample match</Check>
            <Check ok>salesperson_ref (ERP) ≡ MatricolaDip (HR) — same BusinessEntityID</Check>
            <Check ok>product_ref (ERP) ≡ internal_id (PIM) — verified 504/504</Check>
            <Check ok>384 CRM duplicate accounts deduplicated (email + name normalization)</Check>
          </Panel>
          <Panel title="Load — ETL Pipeline">
            <CodeBlock style={{ fontSize: 10 }}>
              <Kw c="#c792ea">LOAD CSV WITH</Kw>{' HEADERS\n'}
              {'FROM '}<Kw c={C.green}>'s3://aw-lake/crm_accounts.csv'</Kw>{'\n'}
              {'AS row\n'}
              <Kw c="#c792ea">WHERE</Kw>{' toInteger(row.accountId) > '}<Kw c="#f78c6c">0</Kw>{'\n'}
              <Kw c={C.textFaint}>// skip duplicate accounts (ID &lt; 0)</Kw>{'\n'}
              <Kw c="#c792ea">MERGE</Kw>{' ('}<Kw c={C.mintLight}>c:Customer</Kw>{' {accountId: toInteger(row.accountId)})\n'}
              <Kw c="#c792ea">SET</Kw>{'\n'}
              {'  c.displayName = CASE row.accountType\n'}
              {'    WHEN '}<Kw c={C.green}>'B2B'</Kw>{' THEN row.ragioneSociale\n'}
              {'    ELSE row.nomeContatto END,\n'}
              {'  c.email = row.emailContatto'}
            </CodeBlock>
          </Panel>
        </div>
      )}
      {tab === 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Panel title="ML-Computed Relations">
            {[
              { badge: 'ML', color: C.violetLight, bc: C.violet, type: 'SIMILAR_TO', title: 'Product similarity', desc: 'Cosine similarity on product name + category + price range. Threshold: 0.70. 3,200 edges. Supports "alternative product" queries.' },
              { badge: 'RULE', color: C.goldLight, bc: C.gold, type: 'CO_PURCHASED', title: 'Frequent co-purchase', desc: 'Support threshold: 0.01. "Customers who bought A also bought B." 18,400 pairs. Powers cross-sell agent.' },
            ].map(n => (
              <div key={n.type} style={{ background: C.panelLight, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, marginBottom: 8, position: 'relative' }}>
                <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 9, fontFamily: ff.mono, color: n.color, border: `1px solid ${n.bc}`, padding: '2px 6px', borderRadius: 2 }}>{n.badge}</span>
                <div style={{ fontSize: 9, fontFamily: ff.mono, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, marginBottom: 4 }}>{n.type}</div>
                <div style={{ fontSize: 13, color: C.cream, fontFamily: ff.sans, fontWeight: 500 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, fontFamily: ff.sans, lineHeight: 1.5 }}>{n.desc}</div>
              </div>
            ))}
          </Panel>
          <Panel title="External Enrichment">
            {[
              { name: 'Cerved Business Registry', desc: 'B2B customer credit scores', tag: 'Weekly' },
              { name: 'Currency rates (ECB)', desc: 'USD→EUR conversion for analysis', tag: 'Daily', live: true },
              { name: 'ZIP/postcode geocoding', desc: 'Address → lat/lng for territory mapping', tag: 'Static' },
            ].map(r => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.cream, fontSize: 12, fontFamily: ff.sans }}>{r.name}</div>
                  <div style={{ color: C.textDim, fontSize: 11, fontFamily: ff.sans }}>{r.desc}</div>
                </div>
                <Tag color={r.live ? C.mintLight : C.textDim} borderColor={r.live ? 'rgba(42,139,106,0.3)' : C.border} bg={r.live ? 'rgba(42,139,106,0.06)' : 'transparent'}>{r.live ? 'LIVE' : r.tag}</Tag>
              </div>
            ))}
          </Panel>
        </div>
      )}
      {tab === 4 && (
        <div>
          <Panel title="Live Query — Top Salespeople by Revenue 2014 (Golden Question Q6+Q7)">
            <CodeBlock>
              <Kw c={C.textFaint}>// Q6: Top salesperson by order count{'\n'}</Kw>
              <Kw c={C.textFaint}>// Q7: Revenue by territory (subtotal_amount){'\n\n'}</Kw>
              <Kw c="#c792ea">MATCH</Kw>{' ('}<Kw c={C.mintLight}>e:Employee</Kw>{')-['}<Kw c="#f78c6c">:MANAGES</Kw>{']->(o:'}<Kw c={C.mintLight}>SalesOrder</Kw>{')\n'}
              <Kw c="#c792ea">WHERE</Kw>{' o.orderDate >= '}<Kw c={C.green}>'2014-01-01'</Kw>{' AND o.orderDate < '}<Kw c={C.green}>'2015-01-01'</Kw>{'\n'}
              <Kw c="#c792ea">OPTIONAL MATCH</Kw>{' (e)-['}<Kw c="#f78c6c">:COVERS</Kw>{']->(t:'}<Kw c={C.mintLight}>Territory</Kw>{')\n'}
              <Kw c="#c792ea">WITH</Kw>{' e, t, COUNT(o) AS orderCount,\n'}
              {'     SUM(o.subtotalAmount) AS revenue_pure\n'}
              <Kw c="#c792ea">RETURN</Kw>{'\n'}
              {'  e.fullName AS salesperson,\n'}
              {'  t.name AS territory,\n'}
              {'  orderCount,\n'}
              {'  '}<Kw c="#82aaff">round</Kw>{'(revenue_pure, '}<Kw c="#f78c6c">2</Kw>{') AS revenue_usd\n'}
              <Kw c="#c792ea">ORDER BY</Kw>{' revenue_usd '}<Kw c="#c792ea">DESC</Kw>{'\n'}
              <Kw c="#c792ea">LIMIT</Kw>{' '}<Kw c="#f78c6c">10</Kw>
            </CodeBlock>
          </Panel>
          <div style={{ marginTop: 16 }}>
            <Panel title="Query Result" action={
              <button onClick={() => setRan(true)} style={{ padding: '4px 12px', fontSize: 10, background: 'rgba(42,139,106,0.1)', border: `1px solid rgba(42,139,106,0.2)`, borderRadius: 3, color: C.mintLight, cursor: 'pointer', fontFamily: ff.sans }}>▶ Run</button>
            }>
              {!ran ? <div style={{ fontFamily: ff.mono, fontSize: 11, color: C.textFaint }}>Run query to see results...</div> : (
                <table style={{ width: '100%', fontFamily: ff.mono, fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Salesperson', 'Territory', 'Orders', 'Revenue (USD)'].map(h => <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: C.textFaint, fontSize: 9 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[
                      ['Linda Mitchell', 'Southwest', 418, '$5,247,382'],
                      ['Jillian Carson', 'Central', 473, '$3,189,418'],
                      ['Michael Blythe', 'Northeast', 390, '$3,763,178'],
                      ['Jae Pak', 'Northwest', 275, '$5,015,682'],
                      ['Ranjit Varkey', 'Canada', 251, '$3,827,950'],
                    ].map(([s, t, o, r]) => (
                      <tr key={s as string} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '6px 8px', color: C.cream }}>{s}</td>
                        <td style={{ padding: '6px 8px', color: C.textDim }}>{t}</td>
                        <td style={{ padding: '6px 8px', color: C.mintLight }}>{o}</td>
                        <td style={{ padding: '6px 8px', color: C.goldLight }}>{r}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </div>
      )}
      {tab === 5 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <Panel title="Schema Versioning">
            <div style={{ fontFamily: ff.mono, fontSize: 11 }}>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, color: C.mintLight }}>v1.2 — 2026-05-24</div>
              <div style={{ padding: '4px 0', color: C.textDim }}>+ CO_PURCHASED edges (ML)</div>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`, marginTop: 4, color: C.cream }}>v1.1 — 2026-04-10</div>
              <div style={{ padding: '4px 0', color: C.textDim }}>+ Territory nodes + COVERS rel</div>
              <div style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`, marginTop: 4, color: C.cream }}>v1.0 — 2026-03-01</div>
              <div style={{ padding: '4px 0', color: C.textDim }}>Initial: Customer + Order + Product</div>
            </div>
          </Panel>
          <Panel title="Data Quality Monitoring">
            <Check ok>Orders with Customer link: 100% (ERP-CRM bridge verified)</Check>
            <Check ok>Products with internal_id: 100% (504/504)</Check>
            <Check warn>CRM accounts deduplicated: 98.1% (384 flagged)</Check>
            <Check warn>Employee HR records with salary: 97.2% (~3% null)</Check>
            <Check ok>Date normalization (HR Italian format): 100%</Check>
          </Panel>
          <Panel title="Access Policy">
            {[['AI Agents', 'READ all', C.mintLight], ['Analytics Team', 'READ (no PII)', C.mintLight], ['Data Engineers', 'WRITE', C.goldLight], ['External APIs', 'Product READ only', C.textDim]].map(([role, perm, c]) => (
              <div key={role as string} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ flex: 1, fontSize: 11, color: C.cream, fontFamily: ff.sans }}>{role}</span>
                <Tag color={c as string} borderColor={`${c as string}44`} bg={`${c as string}11`}>{perm}</Tag>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}

// ── Step 4: Semantic Layer ────────────────────────────────────────────────────
const METRICS = [
  { name: 'revenue_subtotal', label: 'Revenue (Subtotal)', formula: 'SUM(subtotal_amount)', owner: 'Finance', status: 'defined', contestedBy: null, value: '$8.1M' },
  { name: 'revenue_gross', label: 'Revenue (Total Due)', formula: 'SUM(total_due)', owner: 'Sales', status: 'contested', contestedBy: ['Finance', 'Sales', 'Marketing'], value: '$9.8M' },
  { name: 'gross_margin', label: 'Gross Margin', formula: 'SUM(lineTotal - qty * standardCost)', owner: 'Finance', status: 'defined', contestedBy: null, value: '$3.2M' },
  { name: 'active_customers', label: 'Active Customers', formula: 'COUNT(DISTINCT Customer WHERE isActive=1) — deduped', owner: 'CRM', status: 'contested', contestedBy: ['CRM', 'Marketing'], value: '19,828 / 20,201' },
  { name: 'avg_order_value', label: 'Avg Order Value', formula: 'SUM(subtotal_amount) / COUNT(order_id)', owner: 'Sales', status: 'defined', contestedBy: null, value: '$926' },
]

function Step4SemanticLayer() {
  const [sel, setSel] = useState(1)
  return (
    <div>
      <GuideCallout section='Guide Reference — Section 3.3 "Mini-caso: semantic layer per un e-commerce"'>
        "Il CFO si lamenta che ogni report mostra un fatturato diverso. Il team data introduce un semantic layer come single source of truth. Ora, ovunque qualcuno chieda 'revenue Q4 Southwest', la risposta arriva dallo stesso calcolo." — AdventureWorks has this exact problem: subtotal_amount vs total_due.
      </GuideCallout>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Panel title="Contested Metrics — AdventureWorks" action={<button style={{ padding: '3px 9px', fontSize: 10, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textDim, cursor: 'pointer', fontFamily: ff.sans }}>+ Metric</button>}>
          {METRICS.map((m, i) => (
            <div key={m.name} onClick={() => setSel(i)} style={{ background: sel === i ? C.panelLight : 'transparent', border: `1px solid ${sel === i ? C.borderBright : C.border}`, borderLeft: `3px solid ${m.status === 'contested' ? C.burgundyBright : C.mintLight}`, borderRadius: 6, padding: 13, marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: C.cream, fontWeight: 500, fontFamily: ff.sans }}>{m.label}</span>
                <span style={{ fontSize: 9, fontFamily: ff.mono, padding: '2px 7px', borderRadius: 2, background: m.status === 'contested' ? 'rgba(196,40,64,0.15)' : 'rgba(42,139,106,0.12)', border: `1px solid ${m.status === 'contested' ? 'rgba(196,40,64,0.3)' : 'rgba(42,139,106,0.3)'}`, color: m.status === 'contested' ? C.burgundyBright : C.mintLight }}>
                  {m.status}
                </span>
              </div>
              <div style={{ fontFamily: ff.mono, fontSize: 10, color: C.goldLight, marginBottom: 5 }}>{m.formula}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textFaint, fontFamily: ff.sans }}>
                <span>Owner: {m.owner}</span>
                <span style={{ color: C.creamDim, fontWeight: 500 }}>{m.value}</span>
              </div>
            </div>
          ))}
        </Panel>
        <div>
          <Panel title="dbt Semantic Model — SalesOrder">
            <CodeBlock style={{ fontSize: 10, lineHeight: 1.9 }}>
              <Kw c={C.textFaint}># models/semantic/sales_orders.yml{'\n\n'}</Kw>
              {'semantic_models:\n- name: '}<Kw c={C.mintLight}>sales_order</Kw>{'\n'}
              {'  model: ref('}<Kw c={C.green}>"'fct_orders_unified'"</Kw>{')\n'}
              {'  description: '}<Kw c={C.green}>"Orders from OrionSales ERP"{'\n'}</Kw>
              {'  entities:\n    - name: order_id\n      type: primary\n'}
              {'    - name: customer_id\n      type: foreign\n'}
              {'  measures:\n'}
              {'    - name: '}<Kw c={C.goldLight}>subtotal_amount</Kw>{'\n'}
              {'      agg: sum\n'}
              {'      '}<Kw c={C.textFaint}># ← "pure revenue" (excl. tax+freight)</Kw>{'\n'}
              {'    - name: '}<Kw c={C.goldLight}>total_due</Kw>{'\n'}
              {'      agg: sum\n'}
              {'      '}<Kw c={C.textFaint}># ← "gross receipt" (incl. tax+freight)</Kw>{'\n\n'}
              {'metrics:\n  - name: '}<Kw c={C.mintLight}>revenue</Kw>{'\n'}
              {'    description: |\n'}
              {'      Official revenue. CFO-validated 2026-05-24.\n'}
              {'      = subtotal_amount only.\n'}
              {'      Excludes tax_amount + freight_amount.\n'}
              {'    type: '}<Kw c={C.green}>"simple"</Kw>{'\n'}
              {'    type_params: {measure: subtotal_amount}'}
            </CodeBlock>
          </Panel>
          <div style={{ marginTop: 16 }}>
            <Panel title="Metric Validation — Before vs After Semantic Layer">
              <table style={{ width: '100%', fontSize: 11, fontFamily: ff.mono, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Metric', 'Finance (ERP raw)', 'Sales (Salesforce)', 'Sem Layer ✓'].map(h => (
                    <th key={h} style={{ padding: '5px 7px', textAlign: h === 'Metric' ? 'left' : 'right', color: C.textFaint, fontSize: 9 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {[
                    ['Revenue 2014', '$8.1M', '$9.8M', '$8.1M subtotal ✓'],
                    ['Active Customers', '19,817', '20,201', '19,828 (deduped) ✓'],
                    ['Avg Order Value', '$924', '$957', '$926 (subtotal) ✓'],
                    ['Gross Margin', '—', '$4.2M', '$3.2M (w/ std cost) ✓'],
                  ].map(([m, f, s, sl]) => (
                    <tr key={m as string} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '6px 7px', color: C.textDim }}>{m}</td>
                      <td style={{ padding: '6px 7px', textAlign: 'right', color: C.burgundyBright }}>{f}</td>
                      <td style={{ padding: '6px 7px', textAlign: 'right', color: C.burgundyBright }}>{s}</td>
                      <td style={{ padding: '6px 7px', textAlign: 'right', color: C.mintLight }}>{sl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <Panel title="MCP Server Integration — AI Agent Query Flow (Guide Section 3.3)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr 40px 1fr', gap: 0, alignItems: 'start' }}>
            {[
              { label: 'User / Analytics Agent', title: 'Natural Language Query', action: '"What was the revenue for the Southwest territory in Q3 2014?"' },
              null,
              { label: 'MCP Tool Call', title: 'query_semantic_layer', action: '{ metric: "revenue",\n  filter: {territory:"Southwest",\n  quarter:"2014-Q3"},\n  group_by: ["salesperson"] }' },
              null,
              { label: 'Semantic Layer Response', title: 'Governed Result', action: 'Linda Mitchell: $1.28M\nJae Pak: $1.12M\nDefinition: subtotal_amount only\nConfidence: 1.0' },
            ].map((box, i) => box === null
              ? <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.borderBright, fontSize: 18, paddingTop: 30 }}>→</div>
              : <div key={i} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 13 }}>
                  <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, fontFamily: ff.mono, marginBottom: 4 }}>{box.label}</div>
                  <div style={{ fontSize: 14, color: C.cream, fontWeight: 500, marginBottom: 8, fontFamily: ff.sans }}>{box.title}</div>
                  <div style={{ fontSize: 11, fontFamily: ff.mono, color: C.mintLight, background: 'rgba(42,139,106,0.08)', border: '1px solid rgba(42,139,106,0.2)', padding: '6px 9px', borderRadius: 3, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{box.action}</div>
                </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ── Step 5: Metadata Layer ────────────────────────────────────────────────────
const LINEAGE = [
  { entity: 'Customer', source: 'ClientHub CRM', lineage: 'clienthub.account → ETL → kg.Customer → fct_customers', steward: 'sara.chen@aw.io', fresh: 'fresh' as const },
  { entity: 'SalesOrder', source: 'OrionSales ERP', lineage: 'orion_sales.sales_order_header → ETL → kg.SalesOrder → fct_orders', steward: 'marco.rossi@aw.io', fresh: 'fresh' as const },
  { entity: 'OrderLine', source: 'OrionSales ERP', lineage: 'orion_sales.sales_order_line → ETL → kg.OrderLine', steward: 'marco.rossi@aw.io', fresh: 'fresh' as const },
  { entity: 'Employee', source: 'HR CSV', lineage: 'dipendenti_hr.csv → date-norm → kg.Employee', steward: 'hr.team@aw.io', fresh: 'stale' as const },
  { entity: 'Product', source: 'GlobalPIM JSON', lineage: 'product_catalog_pim.json → ETL → kg.Product → fct_products', steward: 'andrea.mueller@aw.io', fresh: 'fresh' as const },
  { entity: 'Address', source: 'ClientHub CRM', lineage: 'clienthub.account_address + address → kg.Address', steward: 'sara.chen@aw.io', fresh: 'fresh' as const },
]

function Step5Metadata() {
  return (
    <div>
      <GuideCallout section='Guide Reference — Section 4.3 "Semantic layer e metadata layer"'>
        "Un metadata layer è uno strato di sistema che cattura e gestisce questi metadati. Senza sapere dove vivono i dati, chi li possiede, e com'è la loro qualità, non si può costruire niente di affidabile sopra."
      </GuideCallout>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Panel title="Entity Lineage — AdventureWorks">
          <div style={{ display: 'grid', gridTemplateColumns: '110px 100px 1fr 70px', gap: 12, padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 9, fontFamily: ff.mono, textTransform: 'uppercase', letterSpacing: '.08em', color: C.textFaint }}>
            <div>Entity</div><div>Source</div><div>Lineage</div><div>Freshness</div>
          </div>
          {LINEAGE.map(r => (
            <div key={r.entity} style={{ display: 'grid', gridTemplateColumns: '110px 100px 1fr 70px', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 12 }}>
              <span style={{ fontFamily: ff.mono, color: C.cream, fontSize: 11 }}>{r.entity}</span>
              <span style={{ color: C.textDim, fontFamily: ff.sans, fontSize: 11 }}>{r.source}</span>
              <span style={{ color: C.textFaint, fontFamily: ff.mono, fontSize: 10 }}>{r.lineage}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: r.fresh === 'fresh' ? C.mintLight : C.gold }} />
                <span style={{ fontSize: 10, fontFamily: ff.mono, color: r.fresh === 'fresh' ? C.mintLight : C.gold }}>{r.fresh === 'fresh' ? '< 4h' : '> 12h'}</span>
              </span>
            </div>
          ))}
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Data Stewards">
            {[
              { entity: 'Customer + Address', owner: 'sara.chen@aw.io', tag: 'Customer' },
              { entity: 'Orders + OrderLines', owner: 'marco.rossi@aw.io', tag: 'SalesOrder' },
              { entity: 'Products + Categories', owner: 'andrea.mueller@aw.io', tag: 'Product' },
              { entity: 'Employees + HR', owner: 'hr.team@aw.io', tag: 'Employee' },
              { entity: 'ML Edges', owner: 'ml-ops@aw.io', tag: 'KG Edges' },
            ].map(s => (
              <div key={s.entity} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.cream, fontFamily: ff.sans }}>{s.entity}</div>
                  <div style={{ fontSize: 11, color: C.goldLight, fontFamily: ff.mono }}>{s.owner}</div>
                </div>
                <Tag color={C.burgundyBright} bg={C.burgundyGlow} borderColor={C.burgundyGlow}>{s.tag}</Tag>
              </div>
            ))}
          </Panel>
          <Panel title="Quality Scores">
            <div style={{ fontFamily: ff.mono, fontSize: 11 }}>
              {[
                ['Overall DQ score', '84.1 / 100', C.mintLight],
                ['Completeness', '89%', C.mintLight],
                ['Consistency', '92%', C.mintLight],
                ['Timeliness', '71%', C.goldLight],
                ['Uniqueness', '98.1%', C.mintLight],
              ].map(([k, v, c]) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.textDim }}>{k}</span>
                  <span style={{ color: c as string }}>{v}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Catalog Entry — SalesOrder">
            <CodeBlock style={{ fontSize: 10 }}>
              {'{\n'}
              {'  '}<Kw c={C.blue}>"entity_type"</Kw>{': '}<Kw c={C.green}>"aw:SalesOrder"</Kw>{',\n'}
              {'  '}<Kw c={C.blue}>"source_system"</Kw>{': '}<Kw c={C.green}>"OrionSales ERP (PostgreSQL)"</Kw>{',\n'}
              {'  '}<Kw c={C.blue}>"owner"</Kw>{': '}<Kw c={C.green}>"marco.rossi@aw.io"</Kw>{',\n'}
              {'  '}<Kw c={C.blue}>"last_updated"</Kw>{': '}<Kw c={C.green}>"2026-05-24T06:00Z"</Kw>{',\n'}
              {'  '}<Kw c={C.blue}>"quality_score"</Kw>{': '}<Kw c="#f78c6c">92</Kw>{',\n'}
              {'  '}<Kw c={C.blue}>"known_issues"</Kw>{': ['}<Kw c={C.green}>"revenue_ambiguity"</Kw>{'],\n'}
              {'  '}<Kw c={C.blue}>"pii_fields"</Kw>{': ['}<Kw c={C.green}>"customer_ref"</Kw>{'],\n'}
              {'  '}<Kw c={C.blue}>"upstream"</Kw>{': ['}<Kw c={C.green}>"orion_sales.sales_order_header"</Kw>{'],\n'}
              {'  '}<Kw c={C.blue}>"downstream"</Kw>{': ['}<Kw c={C.green}>"kg.SalesOrder"</Kw>{', '}<Kw c={C.green}>"fct_orders"</Kw>{']\n}'}
            </CodeBlock>
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ── Step 6: Agentic Result ────────────────────────────────────────────────────
const GOLDEN_Q_SAMPLE = [
  { level: 1, id: 'Q1', q: 'How many employees work in the Engineering department?', answer: '28 employees', sources: ['HR'] },
  { level: 2, id: 'Q6', q: 'Who is the salesperson with the most orders in 2014?', answer: 'Jillian Carson (473 orders)', sources: ['ERP', 'HR'] },
  { level: 3, id: 'Q15', q: 'What is the gross margin per salesperson in 2014?', answer: 'Cross-source: ERP × PIM standardCost', sources: ['ERP', 'PIM'] },
  { level: 4, id: 'Q21', q: 'What is the "revenue" of 2014?', answer: '⚠ Ambiguous — ask which: subtotal ($8.1M) or total_due ($9.8M)?', sources: ['ERP'] },
]

function Step6AgenticResult() {
  const [chat, setChat] = useState<Array<{ role: 'user' | 'agent'; msg: string; meta?: string }>>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)

  const RESPONSES: Record<string, { msg: string; meta: string }> = {
    default: {
      msg: 'I can answer questions about AdventureWorks sales, employees, customers, and products. Try: "What was the revenue in Southwest in 2014?" or "Who are the top 3 salespeople by revenue?"',
      meta: 'ontology → semantic layer → metadata',
    },
    revenue: {
      msg: '⚠ Revenue is an ambiguous term in AdventureWorks. Two definitions exist:\n• subtotal_amount = $8.1M (excludes tax & freight — CFO definition)\n• total_due = $9.8M (includes tax & freight — Sales definition)\n\nThe Semantic Layer uses subtotal_amount as the canonical "revenue" metric. Using that: 2014 total revenue = $8,135,842.',
      meta: 'semantic layer → metric disambiguation → ontology.known_ambiguities',
    },
    top: {
      msg: 'Top 3 salespeople by revenue (2014, subtotal_amount):\n1. Linda Mitchell — Southwest — $5.25M\n2. Jae Pak — Northwest — $5.02M\n3. Michael Blythe — Northeast — $3.76M\n\nData: OrionSales ERP + HR CSV (for names).',
      meta: 'KG Cypher → Employee[:MANAGES]→SalesOrder → GROUP BY → ORDER BY revenue DESC',
    },
  }

  const send = () => {
    if (!input.trim()) return
    const q = input
    setChat(p => [...p, { role: 'user', msg: q }])
    setInput('')
    setTyping(true)
    setTimeout(() => {
      const key = q.toLowerCase().includes('revenue') ? 'revenue' : q.toLowerCase().includes('top') || q.toLowerCase().includes('best') ? 'top' : 'default'
      const r = RESPONSES[key]
      setChat(p => [...p, { role: 'agent', msg: r.msg, meta: r.meta }])
      setTyping(false)
    }, 900)
  }

  return (
    <div>
      <GuideCallout section='Guide Reference — Section 3.4 + 5.7 + 6.2'>
        "Lo stack enterprise: ogni layer serve un layer superiore. L'ontologia definisce i concetti, il KG popola le istanze, il semantic layer espone le metriche, il metadata layer governa il tutto. Sopra, gli agenti AI orchestrano azioni concrete con effetti misurabili."
      </GuideCallout>

      {/* Stack visual */}
      <Panel title="The Full Semantic Stack — AdventureWorks 2026">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8 }}>
          {[
            { layer: 'Layer 1', name: 'Taxonomy', detail: '504 products · 5 top cats', color: C.gold, bg: C.goldFaint, border: 'rgba(184,150,46,0.3)' },
            { layer: 'Layer 2', name: 'Ontology', detail: 'OWL · 12 classes · SHACL', color: C.burgundyBright, bg: C.burgundyGlow, border: 'rgba(139,26,46,0.3)' },
            { layer: 'Layer 3', name: 'Knowledge Graph', detail: 'Neo4j · ~55K nodes', color: C.mintLight, bg: 'rgba(42,139,106,0.08)', border: 'rgba(42,139,106,0.25)' },
            { layer: 'Layer 4', name: 'Semantic Layer', detail: 'dbt · 8 metrics', color: C.goldLight, bg: C.goldFaint, border: 'rgba(184,150,46,0.3)' },
            { layer: 'Layer 5', name: 'Metadata', detail: 'DataHub · 3 stewards', color: C.blue, bg: 'rgba(130,170,255,0.06)', border: 'rgba(130,170,255,0.2)' },
          ].map(l => (
            <div key={l.name} style={{ background: l.bg, border: `1px solid ${l.border}`, borderRadius: 4, padding: 11, textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontFamily: ff.mono, letterSpacing: '.1em', color: l.color, textTransform: 'uppercase', marginBottom: 5 }}>{l.layer}</div>
              <div style={{ fontSize: 13, color: C.cream, fontWeight: 500, marginBottom: 3, fontFamily: ff.sans }}>{l.name}</div>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: ff.sans }}>{l.detail}</div>
              <div style={{ fontSize: 10, color: C.mintLight, marginTop: 4 }}>✓ Active</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Agents */}
      <div style={{ marginTop: 20, marginBottom: 8, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textFaint, fontFamily: ff.mono }}>Active AI Agents — Powered by This Stack</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
        {[
          { color: C.burgundyBright, title: 'Sales Analytics Agent', sub: 'Natural Language → Governed Metrics', desc: 'CFO asks "net revenue Southwest Q3 2014" in Slack. Agent calls MCP → Semantic Layer → returns CFO-validated subtotal_amount with definition and confidence=1.0.', layers: ['Semantic Layer', 'MCP Server', 'Metadata'], metrics: [['Metric disputes', '0 this month'], ['Report prep time', '-78%'], ['Source of truth', '8 metrics']], mc: 'rgba(90,58,139,0.1)', mbc: 'rgba(120,90,184,0.25)', mtc: C.violetLight },
          { color: C.gold, title: 'Territory Performance Agent', sub: 'Cross-Source Revenue Intelligence', desc: 'Runs nightly on KG. Joins ERP orders + HR employee names + territory metadata. Generates territory scorecards with quota attainment and trend signals.', layers: ['KG Cypher', 'Semantic Layer', 'HR data'], metrics: [['Quota attainment accuracy', '100%'], ['Manual joins eliminated', '12/week'], ['Territories covered', '10']], mc: 'rgba(184,150,46,0.08)', mbc: 'rgba(184,150,46,0.2)', mtc: C.goldLight },
          { color: C.mintLight, title: 'Data Quality Agent', sub: 'CRM Dedup + Ambiguity Guard', desc: 'Scans for CRM duplicates (accountId < 0), flags when agents are asked ambiguous questions like "revenue" without specifying subtotal vs total_due, and blocks incorrect joins.', layers: ['Ontology', 'Metadata', 'SHACL'], metrics: [['Duplicates detected', '384 accounts'], ['Ambiguity interceptions', '3/week'], ['False answers prevented', '100%']], mc: 'rgba(42,139,106,0.08)', mbc: 'rgba(42,139,106,0.2)', mtc: C.mintLight },
        ].map(a => (
          <div key={a.title} style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: `2px solid ${a.color}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: C.panelLight, borderBottom: `1px solid ${C.border}`, padding: '9px 15px' }}>
              <span style={{ fontSize: 11, letterSpacing: '.08em', color: C.textDim, textTransform: 'uppercase', fontFamily: ff.sans }}>{a.title}</span>
            </div>
            <div style={{ padding: 15 }}>
              <div style={{ fontSize: 12, color: C.cream, fontWeight: 500, marginBottom: 7, fontFamily: ff.sans }}>{a.sub}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12, lineHeight: 1.6, fontFamily: ff.sans }}>{a.desc}</div>
              <div style={{ fontSize: 10, fontFamily: ff.mono, color: C.textFaint, marginBottom: 7 }}>Layers used:</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                {a.layers.map(l => <Tag key={l} color={a.color} bg={`${a.color}11`} borderColor={`${a.color}44`}>{l}</Tag>)}
              </div>
              <div style={{ background: a.mc, border: `1px solid ${a.mbc}`, borderRadius: 4, padding: 9, fontFamily: ff.mono, fontSize: 10, color: a.mtc }}>
                {a.metrics.map(([k, v]) => <div key={k as string}>{k}: <strong>{v}</strong></div>)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Golden Questions test set */}
      <Panel title="Golden Questions — Test Set (25 questions, 4 difficulty levels)">
        <div style={{ marginBottom: 12, fontSize: 11, color: C.textDim, fontFamily: ff.sans }}>Sample from the AdventureWorks test scenario. Run these against the semantic layer to measure accuracy per level (target: L1=100%, L2≥90%, L3≥75%, L4≥60%).</div>
        <table style={{ width: '100%', fontFamily: ff.mono, fontSize: 11, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {['Level', 'ID', 'Question', 'Expected', 'Sources'].map(h => <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: C.textFaint, fontSize: 9 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {GOLDEN_Q_SAMPLE.map(q => (
              <tr key={q.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '7px 8px' }}>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 2, background: q.level === 1 ? 'rgba(42,139,106,0.1)' : q.level === 2 ? 'rgba(184,150,46,0.1)' : q.level === 3 ? 'rgba(130,170,255,0.1)' : 'rgba(196,40,64,0.1)', border: `1px solid ${q.level === 1 ? C.mintLight : q.level === 2 ? C.gold : q.level === 3 ? C.blue : C.burgundyBright}11`, color: q.level === 1 ? C.mintLight : q.level === 2 ? C.gold : q.level === 3 ? C.blue : C.burgundyBright }}>L{q.level}</span>
                </td>
                <td style={{ padding: '7px 8px', color: C.goldLight }}>{q.id}</td>
                <td style={{ padding: '7px 8px', color: C.creamDim, maxWidth: 300 }}>{q.q}</td>
                <td style={{ padding: '7px 8px', color: C.textDim, fontSize: 10 }}>{q.answer}</td>
                <td style={{ padding: '7px 8px' }}>{q.sources.map(s => <Tag key={s} color={C.blue} bg="rgba(130,170,255,0.06)" borderColor="rgba(130,170,255,0.3)">{s}</Tag>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Live chat demo */}
      <div style={{ marginTop: 20 }}>
        <Panel title="Live Agent Demo — Ask the Semantic Layer">
          <div style={{ minHeight: 160, maxHeight: 220, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chat.length === 0 && <div style={{ color: C.textFaint, fontSize: 12, fontFamily: ff.sans, fontStyle: 'italic' }}>Ask anything about AdventureWorks data — try "What was the revenue in 2014?" or "Who are the top salespeople?"</div>}
            {chat.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row' : 'row-reverse', alignItems: 'flex-start' }}>
                <div style={{ background: m.role === 'user' ? '#25D366' : C.burgundy, color: 'white', borderRadius: '50%', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{m.role === 'user' ? '👤' : 'AI'}</div>
                <div style={{ background: m.role === 'user' ? C.panelLight : 'rgba(139,26,46,0.1)', border: `1px solid ${m.role === 'user' ? C.border : C.burgundyGlow}`, borderRadius: m.role === 'user' ? '4px 12px 12px 12px' : '12px 4px 12px 12px', padding: '9px 13px', maxWidth: 420 }}>
                  {m.meta && <div style={{ fontSize: 9, fontFamily: ff.mono, color: C.textFaint, marginBottom: 5 }}>{m.meta}</div>}
                  <div style={{ fontSize: 12, color: C.cream, fontFamily: ff.sans, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{m.msg}</div>
                </div>
              </div>
            ))}
            {typing && <div style={{ display: 'flex', gap: 10, flexDirection: 'row-reverse', alignItems: 'center' }}><div style={{ background: C.burgundy, color: 'white', borderRadius: '50%', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>AI</div><div style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', fontFamily: ff.sans }}>Querying semantic layer…</div></div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder="Ask about revenue, salespeople, customers, products…"
              style={{ flex: 1, background: C.obsidian, border: `1px solid ${C.border}`, borderRadius: 3, padding: '8px 11px', color: C.cream, fontSize: 12, fontFamily: ff.sans, outline: 'none' }}
            />
            <button onClick={send} style={{ background: C.burgundyGlow, border: `1px solid ${C.burgundy}`, borderRadius: 3, padding: '8px 16px', color: C.cream, fontSize: 11, cursor: 'pointer', fontFamily: ff.sans }}>Send</button>
          </div>
        </Panel>
      </div>

      {/* Impact metrics */}
      <div style={{ marginTop: 20 }}>
        <Panel title="Business Impact — 90 days post-launch">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {[
              { val: '-78%', label: 'Report prep time', sub: 'analytics agent', color: C.mintLight },
              { val: '0', label: 'Metric disputes', sub: 'this month', color: C.goldLight },
              { val: '384', label: 'CRM dupes found', sub: 'auto-flagged', color: C.burgundyBright },
              { val: '100%', label: 'L4 ambiguity handling', sub: 'ask instead of guess', color: C.violetLight },
            ].map(m => (
              <div key={m.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: ff.serif, fontSize: 36, color: m.color, fontWeight: 300, lineHeight: 1 }}>{m.val}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, fontFamily: ff.sans }}>{m.label}<br /><span style={{ fontSize: 10, color: C.textFaint }}>{m.sub}</span></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
const STEPS = [
  { label: 'Taxonomy', dots: 3 },
  { label: 'Ontology (7 Steps)', dots: 7 },
  { label: 'Knowledge Graph', dots: 6 },
  { label: 'Semantic Layer', dots: 3 },
  { label: 'Metadata Layer', dots: 3 },
  { label: 'Agentic Result', dots: 3, special: true },
]

export default function SemanticBuilderView() {
  const [step, setStep] = useState(0)

  const stepContent = [
    <Step1Taxonomy key={0} />,
    <Step2Ontology key={1} />,
    <Step3KG key={2} />,
    <Step4SemanticLayer key={3} />,
    <Step5Metadata key={4} />,
    <Step6AgenticResult key={5} />,
  ]

  const stepTags = [
    'Step 1 of 6 — Taxonomy Builder',
    'Step 2 of 6 — Ontology Builder · 7-Step Method',
    'Step 3 of 6 — Knowledge Graph Builder · 6 Phases',
    'Step 4 of 6 — Semantic Layer · Metric Governance',
    'Step 5 of 6 — Metadata Layer · Lineage & Stewardship',
    'Step 6 of 6 — Agentic Organization · Final Result',
  ]

  const stepTitles = [
    <>Product <em style={{ fontStyle: 'italic', color: C.goldLight }}>Classification</em> Hierarchy</>,
    <>Formal <em style={{ fontStyle: 'italic', color: C.goldLight }}>Ontology</em> Design</>,
    <>Operational <em style={{ fontStyle: 'italic', color: C.goldLight }}>Knowledge Graph</em></>,
    <>Contested Metrics <em style={{ fontStyle: 'italic', color: C.goldLight }}>Resolved</em></>,
    <>Data <em style={{ fontStyle: 'italic', color: C.goldLight }}>Lineage</em> & Stewardship</>,
    <>AdventureWorks <em style={{ fontStyle: 'italic', color: C.goldLight }}>Agentic</em> Platform</>,
  ]

  const stepSubtitles = [
    '504 AdventureWorks SKUs across Bikes, Components, Clothing, and Accessories. The taxonomy is the hierarchical backbone — the "spine" of the ontology that drives filtering, search, and agent context.',
    'Following the 7-step method: use case → stakeholders → reuse → classes → relations → constraints → validation. Applied to AdventureWorks multi-source data (ERP + CRM + HR + PIM).',
    'The KG populates the ontology with real data: 20,201 customers, 504 products, 31,465 orders, 290 employees. Built on Neo4j with identity resolution across 4 heterogeneous sources.',
    'AdventureWorks has two "revenue" definitions: subtotal_amount ($8.1M) vs total_due ($9.8M). The Semantic Layer creates a single source of truth and forces disambiguation.',
    'Documents where every entity comes from, who owns it, and its quality score. Without this, you cannot govern the KG or prevent the semantic layer from returning wrong answers.',
    'All 5 layers working together. Three AI agents now run on this semantic foundation: Sales Analytics, Territory Performance, and Data Quality — each solving a real AdventureWorks problem.',
  ]

  return (
    <div style={{ background: C.obsidian, minHeight: '100%', fontFamily: ff.sans, color: C.cream, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: C.charcoal, borderBottom: `1px solid ${C.border}`, padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, flexShrink: 0 }}>
        <div style={{ fontFamily: ff.serif, fontSize: 20, fontWeight: 600, letterSpacing: '.05em', color: C.cream }}>
          Semantic<span style={{ color: C.goldLight }}>AI</span> — Builder
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: ff.mono, fontSize: 10, color: C.textDim, background: C.panel, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: 2, letterSpacing: '.08em' }}>
            {AW.tag}
          </span>
          <span style={{ fontSize: 10, color: C.goldLight, border: `1px solid ${C.goldFaint}`, padding: '2px 9px', borderRadius: 2, letterSpacing: '.1em', textTransform: 'uppercase', background: C.goldFaint }}>
            Multi-Source Test Scenario
          </span>
        </div>
      </header>

      {/* Progress rail */}
      <nav style={{ background: C.charcoal, borderBottom: `1px solid ${C.border}`, padding: '0 32px', display: 'flex', alignItems: 'stretch', overflowX: 'auto', flexShrink: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'stretch' }}>
            <div
              onClick={() => setStep(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', cursor: 'pointer', borderBottom: `2px solid ${step === i ? C.burgundyBright : 'transparent'}`, background: step === i ? C.panel : 'transparent', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all .2s' }}
              onMouseEnter={e => { if (step !== i) (e.currentTarget as HTMLElement).style.background = C.panel }}
              onMouseLeave={e => { if (step !== i) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${step === i ? C.burgundyBright : i < step ? C.mintLight : C.borderBright}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: ff.mono, fontSize: 10, color: step === i ? C.burgundyBright : i < step ? C.mintLight : C.textDim, background: i < step ? 'rgba(42,139,106,0.15)' : step === i ? C.burgundyGlow : 'transparent', flexShrink: 0 }}>
                {i < step ? '✓' : s.special ? '✦' : i + 1}
              </div>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '.04em', color: step === i ? C.cream : C.textDim, fontWeight: step === i ? 500 : 400 }}>{s.label}</div>
                <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                  {Array.from({ length: s.dots }, (_, j) => (
                    <span key={j} style={{ width: 4, height: 4, borderRadius: '50%', background: j === 0 && step === i ? C.gold : C.borderBright }} />
                  ))}
                </div>
              </div>
            </div>
            {i < STEPS.length - 1 && <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', color: C.borderBright, fontSize: 13 }}>›</div>}
          </div>
        ))}
      </nav>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside style={{ width: 240, flexShrink: 0, background: C.charcoal, borderRight: `1px solid ${C.border}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
          <div style={{ fontFamily: ff.mono, fontSize: 10, letterSpacing: '.15em', textTransform: 'uppercase', color: C.textFaint, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
            AdventureWorks Dataset
          </div>
          {AW.sources.map((s, i) => (
            <div key={s.label} onClick={() => {}} style={{ background: i === 0 ? C.goldFaint : C.panel, border: `1px solid ${i === 0 ? C.gold : C.border}`, borderRadius: 4, padding: 10, cursor: 'pointer' }}>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: ff.mono, letterSpacing: '.06em' }}>{s.label}</div>
              <div style={{ fontSize: 13, color: C.cream, marginTop: 2, fontWeight: 500, fontFamily: ff.sans }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.textFaint, marginTop: 1, fontFamily: ff.mono }}>{s.meta}</div>
            </div>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: ff.mono, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: C.textFaint, marginBottom: 8 }}>Semantic AI Stack</div>
            {AW.stackLayers.map((l, i) => (
              <div key={l.name} onClick={() => setStep(i)} style={{ border: `1px solid ${step === i ? C.gold : C.border}`, borderRadius: 3, padding: '9px 11px', marginBottom: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: step === i ? C.goldFaint : 'transparent', transition: 'all .15s' }}>
                <div>
                  <div style={{ fontSize: 11, color: C.cream, fontWeight: step === i ? 500 : 400, fontFamily: ff.sans }}>{l.name}</div>
                  <div style={{ fontSize: 10, color: C.textFaint, fontFamily: ff.mono }}>{l.tech}</div>
                </div>
                <Tag color={l.tagColor}>{l.tag}</Tag>
              </div>
            ))}
          </div>
        </aside>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>
          {/* Step header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: ff.mono, fontSize: 10, letterSpacing: '.15em', textTransform: 'uppercase', color: C.burgundyBright, marginBottom: 7 }}>{stepTags[step]}</div>
            <h1 style={{ fontFamily: ff.serif, fontSize: 34, fontWeight: 300, color: C.cream, lineHeight: 1.1, marginBottom: 9 }}>{stepTitles[step]}</h1>
            <p style={{ fontSize: 13, color: C.textDim, maxWidth: 600, lineHeight: 1.6, fontFamily: ff.sans }}>{stepSubtitles[step]}</p>
          </div>

          {stepContent[step]}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 28 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} style={{ padding: '7px 15px', fontSize: 11, letterSpacing: '.06em', cursor: 'pointer', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textDim, fontFamily: ff.sans, textTransform: 'uppercase' }}>
                ← {STEPS[step - 1].label}
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button onClick={() => setStep(s => s + 1)} style={{ padding: '7px 15px', fontSize: 11, letterSpacing: '.06em', cursor: 'pointer', background: C.goldFaint, border: `1px solid ${C.gold}`, borderRadius: 3, color: C.goldLight, fontFamily: ff.sans, textTransform: 'uppercase' }}>
                Next: {STEPS[step + 1].label} →
              </button>
            )}
            {step === STEPS.length - 1 && (
              <button onClick={() => setStep(0)} style={{ padding: '7px 15px', fontSize: 11, letterSpacing: '.06em', cursor: 'pointer', background: C.goldFaint, border: `1px solid ${C.gold}`, borderRadius: 3, color: C.goldLight, fontFamily: ff.sans, textTransform: 'uppercase' }}>
                Start Over →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
