// Token Launch Radar — the valuation model.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks protocols that record
// no token yet by what a launch would be worth if the protocol's record stayed as it is. Nothing
// here is a prediction that a token will be issued, and no protocol name is ever special-cased:
// the same functions score every row from the snapshot's own figures.
//
// Who is ranked
//   A protocol is pre-token when the snapshot records no token for it (mcap_usd, gecko_id and
//   symbol all null). A pre-token entry is still left off the board when it is a product of a
//   token that already trades: a wrapped, staked or bridged representation, a liquid staking or
//   restaking receipt, a canonical bridge, or an exchange's own product (isProductOfLiveToken).
//   Those are not launches waiting to happen; their value already trades under another name.
//
// How a launch is valued
//   The snapshot itself prices comparable launches: 416 of its protocols already trade, and for
//   each category their market caps sit at a measurable multiple of TVL. The model takes the
//   median Mcap/TVL of the trading protocols in a protocol's own category as that category's
//   anchor multiple, then adjusts it with three factors the snapshot also carries:
//
//     implied = TVL x category multiple x growth x maturity x breadth x delegated
//
//     growth     1 + clamp(change_7d, -40, +80) / 100 x 0.35 — a week of TVL momentum, damped:
//                one hot week moves a value by at most +28%, one bad week by at most -14%.
//     maturity   0.70 + 0.30 x min(age_days, 1460) / 1460 — a protocol that has held capital
//                for years with no token is worth more of its anchor than a month-old one.
//     breadth    1 + 0.015 x min(chains - 1, 10) — distribution across chains, worth at most
//                +15%: a launch with users on ten chains prices above a single-chain one.
//     delegated  0.5 for capital allocators and risk curators, 1 otherwise — their TVL is
//                capital routed into other protocols, where the same dollars are counted
//                again, so an allocator's own launch is anchored on half its routed TVL.
//
//   A category with fewer than three trading protocols borrows the global median multiple.
//   Multiples are clamped to [0.05, 3.0] so one thin category cannot dominate the board.

/** One protocol of the sealed snapshot: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the maths. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  min_category_samples: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  delegated_factor: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 3.0,
  min_category_samples: 3,
  growth_weight: 0.35,
  growth_floor_pct: -40,
  growth_cap_pct: 80,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.015,
  breadth_max_chains: 10,
  delegated_factor: 0.5,
};

export const MODEL_VERSION = 'launch-radar-2';

/** Categories whose TVL is capital delegated into other protocols, counted again there. */
const DELEGATED_CATEGORIES = new Set(['Risk Curators', 'Onchain Capital Allocator']);

/** Categories that are a product of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product may begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a wrapped or staked representation. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** DefiLlama's version marker: a name ending in a release belongs to an earlier protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to the snapshot's `asOf`, or null when no listing day is recorded. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for a protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a pre-token entry is a product of a token that already trades, and so no launch. */
export function isProductOfLiveToken(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (VERSIONED.test(p.name)) return true;
  return false;
}

/** Whether a protocol belongs on the board: pre-token, and not a product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProductOfLiveToken(p);
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The anchor multiples the snapshot itself sets: for every category, the median Mcap/TVL of its
 * trading protocols, plus the global median as the fallback for thin categories.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    const key = p.category ?? 'Uncategorized';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
    all.push(ratio);
  }
  const global = all.length > 0 ? clamp(median(all), model.multiple_floor, model.multiple_cap) : 1;
  const byCategory = new Map<string, number>();
  for (const [key, list] of ratios) {
    if (list.length >= model.min_category_samples) {
      byCategory.set(key, clamp(median(list), model.multiple_floor, model.multiple_cap));
    }
  }
  return { byCategory, global };
}

/** The anchor multiple one protocol is valued at: its category's, or the global fallback. */
export function anchorMultiple(p: SnapshotProtocol, multiples: { byCategory: Map<string, number>; global: number }): number {
  return multiples.byCategory.get(p.category ?? 'Uncategorized') ?? multiples.global;
}

/** The model's factors for one protocol, and the implied value they multiply to. */
export interface Valuation {
  implied: number;
  anchor: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  delegatedFactor: number;
  age: number | null;
}

/** Value one protocol under the model: TVL times its category anchor times the four factors. */
export function valueProtocol(p: SnapshotProtocol, asOf: string, multiples: { byCategory: Map<string, number>; global: number }, model: ModelConstants = MODEL): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const anchor = anchorMultiple(p, multiples);
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor_pct, model.growth_cap_pct);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const delegatedFactor = p.category !== null && DELEGATED_CATEGORIES.has(p.category) ? model.delegated_factor : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * anchor * growthMult * maturityMult * breadthMult * delegatedFactor));
  return { implied, anchor, growthMult, maturityMult, breadthMult, delegatedFactor, age };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    anchor_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    delegated_factor: number;
  };
  farm_steps: string[];
}

/** A trading protocol, shown on the dashboard as the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The dashboard's compact row: the board row plus its farm plan, rendered by the page. */
export interface RadarRow extends BoardRow {
  farm: FarmStep[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  multiples: { category: string; multiple: number; samples: number }[];
  global_multiple: number;
  counts: {
    protocols: number;
    trading: number;
    pre_token: number;
    products_set_aside: number;
    board: number;
    watchlist: number;
    early: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** The protocols the board ranks, valued and ordered, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      anchor_multiple: round4(s.v.anchor),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      delegated_factor: s.v.delegatedFactor,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The largest trading protocols by market cap, for the dashboard's already-trading strip. */
export function liveRows(snapshot: Snapshot, limit = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, limit)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const multiples = categoryMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: RadarRow[] = board.map((row) => {
    const p = bySlug.get(row.slug)!;
    return { ...row, farm: farmSteps(p, row.age_days) };
  });
  // The multiples table the dashboard's method panel prints: samples counted the same way
  // categoryMultiples counted them, so the page's figures are the model's figures.
  const samples = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorized';
    samples.set(key, (samples.get(key) ?? 0) + 1);
  }
  const multiplesTable = [...multiples.byCategory.entries()]
    .map(([category, multiple]) => ({ category, multiple: round4(multiple), samples: samples.get(category) ?? 0 }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    multiples: multiplesTable,
    global_multiple: round4(multiples.global),
    counts: {
      protocols: snapshot.protocols.length,
      trading: snapshot.protocols.length - preToken,
      pre_token: preToken,
      products_set_aside: preToken - board.length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      early: board.filter((r) => !r.watchlist).length,
    },
    rows,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it is. Mirrors the gate's own rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `slug ${r.slug} is not in the snapshot`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is held by ${byRank[i]!.slug} with rank ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `${byRank[i]!.slug} outranks ${byRank[i - 1]!.slug} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------------------
// Farm plans. Every plan is derived from the protocol's own record — category,
// main chain, TVL tier and age — and states what each step costs and how long
// it takes. No plan is written for a protocol by name.
// ---------------------------------------------------------------------------

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string for board.json: the action, then its cost and time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check it weekly.`;
  return s;
}

/** The chain a plan is worked on: the protocol's first chain, or a neutral phrase. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in plain gas terms a farmer can budget. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $4-15 of ETH in gas per transaction at typical fees';
  if (c === 'solana') return 'about $0.05 of SOL in fees per transaction';
  if (c === 'bitcoin') return 'about $1-5 of BTC in miner fees per transaction';
  if (c.includes('arbitrum') || c.includes('base') || c.includes('optimism') || c.includes('zksync') || c.includes('linea') || c.includes('scroll') || c.includes('mantle') || c.includes('blast') || c.includes('mode')) {
    return 'about $0.10-0.50 of ETH in gas per transaction';
  }
  return 'about $0.10-2 of gas per transaction';
}

/** How much capital one farm position carries, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How many weeks a position is worked: younger protocols get the longer qualifying window. */
function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  return 4;
}

/** The core action of a category, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain}; the vault routes it to lending markets, and your shares are the position to hold`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow about 30% against it and re-supply the borrow so both sides of the market see the wallet`;
  if (c.includes('cdp') || c.includes('collateral')) return `Deposit $${capital} of collateral into ${name} on ${chain} and mint a conservative amount of its stablecoin against it, keeping the health factor above 2`;
  if (c.includes('dex')) return `Swap about $${capital} of volume through ${name} on ${chain} across several pairs, then park $${Math.round(capital / 2)} in its deepest stablecoin pool`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and trade one small hedged position a week, keeping the account active without directional risk`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and leave the vault shares untouched so the balance history builds`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenised asset on ${chain} through its own app and hold it in the farming wallet`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain} and use two native apps there, so the wallet has real activity on the chain itself`;
  if (c.includes('farm')) return `Stake $${capital} of liquidity in ${name}'s main farm on ${chain} and compound the rewards back in weekly`;
  if (c.includes('basis')) return `Open a $${capital} basis position on ${name}: long the spot asset, short the same size on its perpetual market, and let the funding accrue`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, built from the
 * protocol's category, main chain, TVL tier and age — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const weeks = weeksFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Set up one fresh wallet for ${p.name} alone and fund it on ${chain} with the position capital plus a gas float`,
      cost: gas,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital in the position, plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one qualifying action every week for ${weeks} weeks — a deposit, a swap, a borrow or a claim — so the wallet shows a pattern, not a single visit`,
      cost: gas.replace('per transaction', 'a week'),
      time: `10 minutes a week for ${weeks} weeks`,
    },
    {
      text: `Keep the position open for the whole ${weeks} weeks; snapshots and points programs reward balances that stay, and an early exit usually earns nothing`,
      cost: `the $${capital} stays locked in the position`,
      time: `${weeks} weeks`,
    },
    {
      text: `Once a month, open ${p.name}'s own points, rewards or governance page from the app you already use and screenshot the wallet's standing; never follow a claim link from a message or a search ad`,
      cost: 'nothing to check, and never pay a fee to claim',
      time: '5 minutes a month',
    },
    {
      text: `Log the wallet address, every date and every transaction hash in a farm sheet; if a token launches, the same sheet is your claim record and your exit plan`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
  ];
}
