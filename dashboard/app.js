// Token Launch Radar — the page. Renders window.RADAR (written beside this page by main.ts)
// with no network: a sortable, filterable board, a detail view per protocol, and a method
// panel that states the model the board runs. Views are hash routes so any state of the
// page can be linked — and screenshotted — directly:
//   #/board?q=&cat=&chain=&min=&wl=&sort=&dir=     the board, filtered
//   #/p/<slug>                                     one protocol's detail view

'use strict';

const D = window.RADAR;
const app = document.getElementById('app');
const bySlug = new Map(D.rows.map((r) => [r.slug, r]));

/* ————— formatting ————— */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

function fmtFull(n) {
  return n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return '<span class="flat">n/a</span>';
  const cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${n.toFixed(1)}%</span>`;
}

function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 90) return `${days} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

function fmtMult(n) {
  return `${Number(n).toFixed(2)}×`;
}

/* ————— routing ————— */

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const [path, query] = h.split('?');
  const params = new URLSearchParams(query || '');
  if (path.startsWith('/p/')) return { view: 'detail', slug: decodeURIComponent(path.slice(3)) };
  return {
    view: 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    min: Number(params.get('min') || 0),
    wl: params.get('wl') === '1',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') || 'asc',
  };
}

function boardHash(s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.cat) p.set('cat', s.cat);
  if (s.chain) p.set('chain', s.chain);
  if (s.min) p.set('min', String(s.min));
  if (s.wl) p.set('wl', '1');
  if (s.sort && s.sort !== 'rank') p.set('sort', s.sort);
  if (s.dir && s.dir !== 'asc') p.set('dir', s.dir);
  const q = p.toString();
  return `#/board${q ? `?${q}` : ''}`;
}

/* ————— the board ————— */

const SORTS = {
  rank: { label: 'Rank', get: (r) => r.rank },
  value: { label: 'Implied value', get: (r) => r.implied_value_usd },
  tvl: { label: 'TVL', get: (r) => r.tvl_usd },
  growth: { label: '7d change', get: (r) => (r.change_7d === null ? -Infinity : r.change_7d) },
  age: { label: 'Time tokenless', get: (r) => (r.age_days === null ? -1 : r.age_days) },
  name: { label: 'Name', get: (r) => r.name.toLowerCase() },
};

function filteredRows(s) {
  const q = s.q.trim().toLowerCase();
  let rows = D.rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !(r.category || '').toLowerCase().includes(q)) return false;
    if (s.cat && (r.category || 'Uncategorized') !== s.cat) return false;
    if (s.chain && !r.chains.includes(s.chain)) return false;
    if (s.min && r.tvl_usd < s.min) return false;
    if (s.wl && !r.watchlist) return false;
    return true;
  });
  const get = SORTS[s.sort] ? SORTS[s.sort].get : SORTS.rank.get;
  const dir = s.dir === 'desc' ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x < y) return -1 * dir;
    if (x > y) return 1 * dir;
    return a.rank - b.rank;
  });
  return rows;
}

function statsHtml() {
  const c = D.counts;
  const totalTvl = D.rows.reduce((sum, r) => sum + r.tvl_usd, 0);
  const top = D.rows[0];
  return `<section class="stats">
    <div class="stat"><span>Protocols scanned</span><b>${c.protocols}</b><small>every DefiLlama record ≥ $5M TVL</small></div>
    <div class="stat"><span>Ranked pre-token</span><b>${c.board}</b><small>${c.products_set_aside} products of live tokens set aside</small></div>
    <div class="stat"><span>Watchlist covered</span><b>${c.watchlist} / ${c.watchlist}</b><small>plus ${c.early} early rows below the $50M floor</small></div>
    <div class="stat"><span>TVL under watch</span><b>${fmtUsd(totalTvl)}</b><small>across the ranked board</small></div>
    <div class="stat"><span>Top of the board</span><b>${fmtUsd(top.implied_value_usd)}</b><small>${esc(top.name)}, implied launch value</small></div>
  </section>`;
}

function methodHtml() {
  const m = D.model;
  const multRows = D.multiples
    .map((x) => `<tr><td>${esc(x.category)}</td><td class="n">${fmtMult(x.multiple)}</td><td class="n">${x.samples}</td></tr>`)
    .join('');
  return `<details class="method">
    <summary>How the implied value is computed — model ${esc(D.model_version)}, no names, only the snapshot's figures</summary>
    <div class="body">
      <p><code>implied = TVL × category multiple × growth × maturity × breadth × delegated</code></p>
      <p>The <b>category multiple</b> is the snapshot pricing its own launches: for each category, the median market-cap / TVL of the protocols in it whose token already trades (global median ${fmtMult(D.global_multiple)} where a category has fewer than ${m.min_category_samples} trading protocols; multiples clamped to ${m.multiple_floor}–${m.multiple_cap}×).</p>
      <p><b>Growth</b> damps one week of TVL momentum: 1 + clamp(7d change, ${m.growth_floor_pct}%…+${m.growth_cap_pct}%) × ${m.growth_weight}. <b>Maturity</b> runs ${m.maturity_floor}–${(m.maturity_floor + m.maturity_range).toFixed(2)} over ${m.maturity_days} days tokenless: capital held for years is worth more of its anchor. <b>Breadth</b> adds ${(m.breadth_per_chain * 100).toFixed(1)}% per extra chain, up to ${m.breadth_max_chains}. <b>Delegated</b> halves capital allocators and risk curators, whose TVL is routed into other protocols and counted again there.</p>
      <p>Off the board: any protocol whose token already trades, and any pre-token entry that is a product of one — wrapped, staked or bridged representations, liquid staking and restaking receipts, canonical bridges, exchange products and versioned pools of an earlier protocol.</p>
      <table><thead><tr><th>Category</th><th>Anchor multiple</th><th>Trading samples</th></tr></thead><tbody>${multRows}</tbody></table>
    </div>
  </details>`;
}

function controlsHtml(s) {
  const cats = [...new Set(D.rows.map((r) => r.category || 'Uncategorized'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label || v)}</option>`;
  return `<form class="controls" id="controls">
    <input type="search" id="f-q" placeholder="Search name or category…" value="${esc(s.q)}" aria-label="Search">
    <select id="f-cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => opt(c, s.cat)).join('')}</select>
    <select id="f-chain" aria-label="Chain"><option value="">All chains</option>${chains.map((c) => opt(c, s.chain)).join('')}</select>
    <select id="f-min" aria-label="Minimum TVL">
      ${[[0, 'Any TVL'], [5e6, 'TVL ≥ $5M'], [25e6, 'TVL ≥ $25M'], [5e7, 'TVL ≥ $50M'], [2.5e8, 'TVL ≥ $250M'], [1e9, 'TVL ≥ $1B']].map(([v, l]) => opt(String(v), String(s.min), l)).join('')}
    </select>
    <label class="check"><input type="checkbox" id="f-wl"${s.wl ? ' checked' : ''}> Watchlist only</label>
    <select id="f-sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, v]) => opt(k, s.sort, `Sort: ${v.label}`)).join('')}</select>
    <select id="f-dir" aria-label="Direction">${opt('asc', s.dir, 'Ascending')}${opt('desc', s.dir, 'Descending')}</select>
    <span class="count" id="f-count"></span>
  </form>`;
}

function rowHtml(r) {
  return `<tr data-slug="${esc(r.slug)}" tabindex="0" title="Open ${esc(r.name)}">
    <td class="rank">${r.rank}</td>
    <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<br><span class="pcat">${esc(r.category || 'Uncategorized')}</span></td>
    <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
    <td class="n">${fmtUsd(r.tvl_usd)}</td>
    <td class="n">${fmtPct(r.change_7d)}</td>
    <td class="n">${fmtAge(r.age_days)}</td>
    <td class="n value">${fmtUsd(r.implied_value_usd)}</td>
    <td class="n">${fmtMult(r.implied_value_usd / r.tvl_usd)}</td>
  </tr>`;
}

function liveHtml() {
  const cards = D.live
    .slice(0, 8)
    .map((p) => `<div class="live-card"><b>${esc(p.name)}</b> · ${fmtUsd(p.mcap_usd)}<span>${esc(p.category || 'Uncategorized')} — already trading, shown at the market's own value and never ranked</span></div>`)
    .join('');
  return `<section class="live"><h2>Already trading — set aside, not ranked</h2><div class="live-grid">${cards}</div></section>`;
}

function renderBoard(s) {
  const rows = filteredRows(s);
  document.title = 'Token Launch Radar — the board';
  app.innerHTML = `${statsHtml()}${methodHtml()}${controlsHtml(s)}
    <table class="board"><thead><tr>
      <th>#</th><th>Protocol</th><th>Chains</th><th class="n">TVL</th><th class="n">7d</th><th class="n">Tokenless for</th><th class="n">Implied value</th><th class="n">Implied / TVL</th>
    </tr></thead><tbody>${rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="8" class="empty">No protocol matches these filters. Loosen one and sweep again.</td></tr>'}</tbody></table>
    ${liveHtml()}`;
  app.setAttribute('aria-busy', 'false');
  const count = document.getElementById('f-count');
  count.textContent = `${rows.length} of ${D.counts.board} protocols`;
  const read = () => ({
    q: document.getElementById('f-q').value,
    cat: document.getElementById('f-cat').value,
    chain: document.getElementById('f-chain').value,
    min: Number(document.getElementById('f-min').value),
    wl: document.getElementById('f-wl').checked,
    sort: document.getElementById('f-sort').value,
    dir: document.getElementById('f-dir').value,
  });
  let searchTimer = null;
  document.getElementById('f-q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { location.hash = boardHash(read()); }, 250);
  });
  for (const id of ['f-cat', 'f-chain', 'f-min', 'f-wl', 'f-sort', 'f-dir']) {
    document.getElementById(id).addEventListener('change', () => { location.hash = boardHash(read()); });
  }
  document.getElementById('controls').addEventListener('submit', (e) => e.preventDefault());
  for (const tr of app.querySelectorAll('tr[data-slug]')) {
    const go = () => { location.hash = `#/p/${encodeURIComponent(tr.dataset.slug)}`; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  // A filter change re-renders the board; keep the reader's place instead of jumping to the top.
  const q = document.getElementById('f-q');
  if (document.activeElement === document.body && s.q) q.focus();
}

/* ————— the detail view ————— */

function whyHtml(r) {
  const anchor = r.model.anchor_multiple;
  const own = D.multiples.some((x) => x.category === (r.category || 'Uncategorized'));
  const anchorPhrase = own
    ? `the ${esc(r.category || 'Uncategorized')} anchor of ${fmtMult(anchor)}`
    : `the global anchor of ${fmtMult(anchor)}, its own category having too few trading protocols to set one`;
  const rankPhrase = r.rank === 1 ? 'ahead of the whole pre-token field' : `ahead of all but ${r.rank - 1} of the pre-token field`;
  const growth = r.change_7d === null ? 'no reported 7-day change' : `a ${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}% week`;
  const bits = [
    `${esc(r.name)} ranks #${r.rank} of ${D.counts.board} because ${fmtFull(r.tvl_usd)} of TVL, valued at ${anchorPhrase}, puts it ${rankPhrase}`,
    `it has run ${fmtAge(r.age_days)} with no token recorded`,
    `across ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}`,
    `with ${growth}`,
  ];
  let s = `${bits.join(', ')}.`;
  if (r.model.delegated_factor < 1) {
    s += ` As a capital allocator its TVL is routed into other protocols and counted again there, so the model anchors its launch on half of it.`;
  }
  if (r.watchlist) s += ` It sits on the snapshot's watchlist — above the ${fmtUsd(D.floor_usd)} floor and free of any token record.`;
  return `<p class="why">${s}</p>`;
}

function waterfallHtml(r) {
  const m = r.model;
  const own = D.multiples.some((x) => x.category === (r.category || 'Uncategorized'));
  const anchorLabel = own
    ? `Category anchor — ${r.category || 'Uncategorized'} median Mcap/TVL`
    : `Global anchor — median Mcap/TVL of all trading protocols (${r.category || 'Uncategorized'} sets none)`;
  const steps = [
    ['TVL in the snapshot', null, r.tvl_usd],
    [anchorLabel, m.anchor_multiple, r.tvl_usd * m.anchor_multiple],
    ['Growth — damped 7-day TVL momentum', m.growth_multiplier, r.tvl_usd * m.anchor_multiple * m.growth_multiplier],
    ['Maturity — time run with no token', m.maturity_multiplier, r.tvl_usd * m.anchor_multiple * m.growth_multiplier * m.maturity_multiplier],
    ['Breadth — chains it serves', m.breadth_multiplier, r.tvl_usd * m.anchor_multiple * m.growth_multiplier * m.maturity_multiplier * m.breadth_multiplier],
  ];
  if (m.delegated_factor < 1) steps.push(['Delegated capital — routed TVL counted once', m.delegated_factor, r.implied_value_usd]);
  const maxLog = Math.log10(Math.max(r.implied_value_usd, r.tvl_usd));
  const bar = (v) => Math.max(3, Math.round((Math.log10(Math.max(v, 1)) / maxLog) * 100));
  const rows = steps
    .map(([label, mult, v], i) => `<tr${i === 0 ? '' : ''}><td>${esc(label)}</td><td class="n">${mult === null ? '—' : fmtMult(mult)}</td><td class="bar-cell"><span class="bar${mult !== null && mult < 1 ? ' under' : ''}"><i style="width:${bar(v)}%"></i></span></td><td class="n bar-val">${fmtFull(Math.round(v))}</td></tr>`)
    .join('');
  return `<table class="waterfall"><thead><tr><th>Step</th><th class="n">Factor</th><th></th><th class="n">Running value</th></tr></thead><tbody>${rows}
    <tr class="total"><td>Implied launch value</td><td class="n">${fmtMult(r.implied_value_usd / r.tvl_usd)} of TVL</td><td></td><td class="n">${fmtFull(r.implied_value_usd)}</td></tr></tbody></table>`;
}

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) {
    app.innerHTML = `<a class="back" href="#/board">← Back to the board</a><p class="empty">No protocol with that slug is on the board.</p>`;
    return;
  }
  document.title = `${r.name} — Token Launch Radar`;
  const farm = r.farm
    .map((s, i) => `<li><span class="no">${i + 1}</span><div class="txt">${esc(s.text)}<div class="chips"><span class="step-chip">Cost: <b>${esc(s.cost)}</b></span><span class="step-chip">Time: <b>${esc(s.time)}</b></span></div></div></li>`)
    .join('');
  app.innerHTML = `
    <a class="back" href="#/board">← Back to the board</a>
    <div class="detail-head"><h2>${esc(r.name)}</h2><span class="pcat">${esc(r.category || 'Uncategorized')} · rank #${r.rank} of ${D.counts.board}</span>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}</div>
    ${whyHtml(r)}
    <section class="kv-grid">
      <div class="kv"><span>Implied launch value</span><b>${fmtFull(r.implied_value_usd)}</b><small>${fmtMult(r.implied_value_usd / r.tvl_usd)} of TVL</small></div>
      <div class="kv"><span>TVL</span><b>${fmtFull(r.tvl_usd)}</b><small>as of ${esc(D.as_of)}</small></div>
      <div class="kv"><span>7-day TVL change</span><b>${r.change_7d === null ? 'n/a' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b><small>the momentum the growth factor damps</small></div>
      <div class="kv"><span>Tokenless for</span><b>${fmtAge(r.age_days)}</b><small>tracked since ${esc(r.listed_at || 'an unrecorded date')}</small></div>
    </section>
    <section class="panel"><h3>How this value is built</h3><p class="sub">The same model as every other row — ${esc(D.model_version)} — applied to ${esc(r.name)}'s own figures. Bars are on a log scale.</p>${waterfallHtml(r)}</section>
    <section class="panel"><h3>Farm plan</h3><p class="sub">What to do before a launch, in order. Written from ${esc(r.name)}'s category, main chain (${esc(r.chains[0] || 'its main chain')}), size and age — the costs are the plan's own budget, not a promise of any reward.</p><ol class="farm">${farm}</ol></section>
    <section class="panel"><h3>The record</h3><p class="sub">Chains: ${esc(r.chains.join(', ') || 'none recorded')}. DefiLlama records no token for this protocol — no market cap, no CoinGecko id, no symbol — which is a statement about the record, not proof none exists anywhere.</p></section>`;
  app.setAttribute('aria-busy', 'false');
  window.scrollTo(0, 0);
}

/* ————— boot ————— */

document.getElementById('asof').innerHTML = `Snapshot as of <b>${esc(D.as_of)}</b><br>${esc(D.source)}`;
function render() {
  const route = parseHash();
  if (route.view === 'detail') renderDetail(route.slug);
  else renderBoard(route);
}
window.addEventListener('hashchange', render);
render();
