import type { Client } from "@libsql/client";
import {
  HYPOTHESIS_SCORE_VERSION,
  HYPOTHESIS_UNIVERSE_MAX,
  type HypothesisCategory,
} from "../domain/hypothesis";
import { computeHypothesisScore } from "./score";

/** Fixed seed clock for deterministic migrate/replay. */
export const HYPOTHESIS_SEED_CAPTURED_AT = 1_760_000_000_000;

export type HypothesisSeedAsset = {
  /** Stable seed identity; used as mint when no public mint is known. */
  seedId: string;
  symbol: string;
  name: string;
  /** Public mint when known; otherwise a deterministic research placeholder. */
  mint: string;
  category: HypothesisCategory;
  narrative_summary: string;
  catalyst_summary: string;
  narrative_score: number;
  asymmetry_score: number;
  catalyst_score: number;
  attention_score: number;
  liquidity_score: number;
};

/**
 * Controlled first research pool (max 25).
 * Research hypotheses only — not a trade / buy list. No trade metadata.
 */
export const HYPOTHESIS_SEED_UNIVERSE: readonly HypothesisSeedAsset[] = [
  {
    seedId: "ai-render",
    symbol: "RENDER",
    name: "Render Network",
    mint: "rndrizN9ATm5FfRKxc8uGQmhic9scsZVQsoTfd2vpd",
    category: "AI",
    narrative_summary: "Decentralized GPU rendering narrative within broader AI compute demand.",
    catalyst_summary: "Watch compute marketplace usage and Solana settlement relevance over time.",
    narrative_score: 78,
    asymmetry_score: 62,
    catalyst_score: 55,
    attention_score: 70,
    liquidity_score: 72,
  },
  {
    seedId: "ai-nosana",
    symbol: "NOS",
    name: "Nosana",
    mint: "nosXBVoaCTtYdLvNY6BbZDZTw8h6PEeBVJz5xwRYuUH",
    category: "AI",
    narrative_summary: "Solana-native AI/GPU job network hypothesis for distributed inference workloads.",
    catalyst_summary: "Track network utilization and builder activity as research signals only.",
    narrative_score: 70,
    asymmetry_score: 68,
    catalyst_score: 58,
    attention_score: 52,
    liquidity_score: 48,
  },
  {
    seedId: "rwa-ondo",
    symbol: "ONDO",
    name: "Ondo Finance",
    mint: "HypSeedRwaOndo11111111111111111111111111111",
    category: "RWA",
    narrative_summary: "Tokenized treasury / RWA distribution narrative bridging TradFi yield rails.",
    catalyst_summary: "Monitor product expansion and on-chain settlement experiments.",
    narrative_score: 74,
    asymmetry_score: 60,
    catalyst_score: 64,
    attention_score: 66,
    liquidity_score: 58,
  },
  {
    seedId: "rwa-centrifuge",
    symbol: "CFG",
    name: "Centrifuge",
    mint: "HypSeedRwaCfg111111111111111111111111111111",
    category: "RWA",
    narrative_summary: "Real-world asset financing rails as a multi-cycle research theme.",
    catalyst_summary: "Follow issuer pipeline growth without treating listings as trade cues.",
    narrative_score: 66,
    asymmetry_score: 63,
    catalyst_score: 50,
    attention_score: 44,
    liquidity_score: 42,
  },
  {
    seedId: "sol-jup",
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    category: "SOLANA_ECOSYSTEM",
    narrative_summary: "Core Solana routing / aggregator gravity as an ecosystem research anchor.",
    catalyst_summary: "Observe product surface area and governance experiments over quarters.",
    narrative_score: 82,
    asymmetry_score: 58,
    catalyst_score: 60,
    attention_score: 80,
    liquidity_score: 85,
  },
  {
    seedId: "sol-jito",
    symbol: "JTO",
    name: "Jito",
    mint: "jtojtomepa8bpD9HrhWVANsGvyyTHYxGogAHRQvVK1c",
    category: "SOLANA_ECOSYSTEM",
    narrative_summary: "MEV and liquid staking infrastructure narrative native to Solana.",
    catalyst_summary: "Research stake distribution and client diversity over time.",
    narrative_score: 76,
    asymmetry_score: 61,
    catalyst_score: 57,
    attention_score: 68,
    liquidity_score: 74,
  },
  {
    seedId: "sol-pyth",
    symbol: "PYTH",
    name: "Pyth Network",
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    category: "SOLANA_ECOSYSTEM",
    narrative_summary: "Oracle coverage and publisher network as a Solana data-layer hypothesis.",
    catalyst_summary: "Watch new market listings and publisher set changes as research inputs.",
    narrative_score: 73,
    asymmetry_score: 59,
    catalyst_score: 54,
    attention_score: 65,
    liquidity_score: 70,
  },
  {
    seedId: "defi-ray",
    symbol: "RAY",
    name: "Raydium",
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    category: "DEFI",
    narrative_summary: "Solana AMM / launch-liquidity venue as a recurring DeFi structure thesis.",
    catalyst_summary: "Track volume mix and pool composition without trade framing.",
    narrative_score: 68,
    asymmetry_score: 55,
    catalyst_score: 52,
    attention_score: 72,
    liquidity_score: 78,
  },
  {
    seedId: "defi-orca",
    symbol: "ORCA",
    name: "Orca",
    mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektUE",
    category: "DEFI",
    narrative_summary: "Concentrated liquidity UX narrative on Solana DeFi.",
    catalyst_summary: "Observe whirlpool adoption metrics as qualitative research context.",
    narrative_score: 64,
    asymmetry_score: 57,
    catalyst_score: 48,
    attention_score: 58,
    liquidity_score: 66,
  },
  {
    seedId: "defi-kamino",
    symbol: "KMNO",
    name: "Kamino Finance",
    mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    category: "DEFI",
    narrative_summary: "Automated liquidity / lending products as a Solana DeFi packaging thesis.",
    catalyst_summary: "Follow vault strategy diversity and risk disclosures for research notes.",
    narrative_score: 71,
    asymmetry_score: 64,
    catalyst_score: 59,
    attention_score: 60,
    liquidity_score: 62,
  },
  {
    seedId: "infra-wormhole",
    symbol: "W",
    name: "Wormhole",
    mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ",
    category: "INFRA",
    narrative_summary: "Cross-chain messaging infrastructure as a multi-ecosystem research theme.",
    catalyst_summary: "Monitor message volume and security review cadence qualitatively.",
    narrative_score: 69,
    asymmetry_score: 56,
    catalyst_score: 53,
    attention_score: 63,
    liquidity_score: 60,
  },
  {
    seedId: "infra-tensor",
    symbol: "TNSR",
    name: "Tensor",
    mint: "TNSRxcUxoT9xBG3de7PiJmZKeWEkeJWSxYpVQ9Nwpump",
    category: "INFRA",
    narrative_summary: "Solana NFT market infrastructure and order-flow tooling hypothesis.",
    catalyst_summary: "Research marketplace share shifts; not an execution cue.",
    narrative_score: 58,
    asymmetry_score: 60,
    catalyst_score: 45,
    attention_score: 55,
    liquidity_score: 50,
  },
  {
    seedId: "infra-helium",
    symbol: "HNT",
    name: "Helium",
    mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    category: "INFRA",
    narrative_summary: "Decentralized wireless coverage narrative migrated onto Solana settlement.",
    catalyst_summary: "Track network hotspot growth and data-credit usage as research series.",
    narrative_score: 67,
    asymmetry_score: 65,
    catalyst_score: 51,
    attention_score: 57,
    liquidity_score: 64,
  },
  {
    seedId: "gaming-atlas",
    symbol: "ATLAS",
    name: "Star Atlas",
    mint: "ATLASXmbPQxBUYbxPsV97usA3pQYB3kHYBmm2uavr9Kw",
    category: "GAMING",
    narrative_summary: "Long-horizon Solana gaming world-building hypothesis.",
    catalyst_summary: "Observe player tooling releases and content cadence over long windows.",
    narrative_score: 55,
    asymmetry_score: 70,
    catalyst_score: 42,
    attention_score: 48,
    liquidity_score: 45,
  },
  {
    seedId: "gaming-aurora",
    symbol: "AURY",
    name: "Aurory",
    mint: "AURYydfxJib1ZkTir1Jn1J9ECYUtjb6rKQVmtYaLCWWf",
    category: "GAMING",
    narrative_summary: "Solana game studio + asset loop as a sector research sample.",
    catalyst_summary: "Follow game updates; keep notes separate from any trade framing.",
    narrative_score: 52,
    asymmetry_score: 66,
    catalyst_score: 40,
    attention_score: 46,
    liquidity_score: 40,
  },
  {
    seedId: "meme-bonk",
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    category: "MEME",
    narrative_summary: "Cultural attention asset on Solana — research attention dynamics only.",
    catalyst_summary: "Map social attention cycles; explicitly not a buy thesis.",
    narrative_score: 60,
    asymmetry_score: 72,
    catalyst_score: 35,
    attention_score: 88,
    liquidity_score: 80,
  },
  {
    seedId: "meme-wif",
    symbol: "WIF",
    name: "dogwifhat",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    category: "MEME",
    narrative_summary: "Meme attention persistence hypothesis for Solana cultural markets.",
    catalyst_summary: "Study attention half-life; no entry/target framing.",
    narrative_score: 54,
    asymmetry_score: 74,
    catalyst_score: 30,
    attention_score: 84,
    liquidity_score: 76,
  },
  {
    seedId: "meme-popcat",
    symbol: "POPCAT",
    name: "Popcat",
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    category: "MEME",
    narrative_summary: "Viral meme continuum case study for attention vs liquidity research.",
    catalyst_summary: "Document narrative decay patterns for methodology, not trading.",
    narrative_score: 50,
    asymmetry_score: 71,
    catalyst_score: 28,
    attention_score: 82,
    liquidity_score: 68,
  },
  {
    seedId: "l1-sol",
    symbol: "SOL",
    name: "Solana",
    mint: "So11111111111111111111111111111111111111112",
    category: "L1",
    narrative_summary: "Base L1 throughput / fee-market research reference for the Solana stack.",
    catalyst_summary: "Track client upgrades and fee economics as structural research context.",
    narrative_score: 88,
    asymmetry_score: 48,
    catalyst_score: 62,
    attention_score: 90,
    liquidity_score: 95,
  },
  {
    seedId: "l1-avax",
    symbol: "AVAX",
    name: "Avalanche",
    mint: "HypSeedL1Avax111111111111111111111111111111",
    category: "L1",
    narrative_summary: "Alternate L1 subnet design as comparative research against Solana.",
    catalyst_summary: "Compare validator/subnet developments for cross-L1 notes only.",
    narrative_score: 72,
    asymmetry_score: 54,
    catalyst_score: 56,
    attention_score: 70,
    liquidity_score: 72,
  },
  {
    seedId: "l1-sui",
    symbol: "SUI",
    name: "Sui",
    mint: "HypSeedL1Sui1111111111111111111111111111111",
    category: "L1",
    narrative_summary: "Object-centric L1 execution model as a comparative research hypothesis.",
    catalyst_summary: "Follow ecosystem app density trends for qualitative comparison.",
    narrative_score: 70,
    asymmetry_score: 58,
    catalyst_score: 55,
    attention_score: 74,
    liquidity_score: 70,
  },
  {
    seedId: "l2-arb",
    symbol: "ARB",
    name: "Arbitrum",
    mint: "HypSeedL2Arb1111111111111111111111111111111",
    category: "L2",
    narrative_summary: "Optimistic rollup L2 design as comparative scaling research.",
    catalyst_summary: "Observe ecosystem migration patterns vs Solana monolithic design.",
    narrative_score: 68,
    asymmetry_score: 52,
    catalyst_score: 50,
    attention_score: 72,
    liquidity_score: 75,
  },
  {
    seedId: "l2-op",
    symbol: "OP",
    name: "Optimism",
    mint: "HypSeedL2Op11111111111111111111111111111111",
    category: "L2",
    narrative_summary: "OP Stack shared governance / superchain research theme.",
    catalyst_summary: "Track chain proliferation qualitatively for scaling notes.",
    narrative_score: 66,
    asymmetry_score: 53,
    catalyst_score: 49,
    attention_score: 68,
    liquidity_score: 73,
  },
  {
    seedId: "l2-base",
    symbol: "BASE",
    name: "Base (ecosystem proxy)",
    mint: "HypSeedL2Base111111111111111111111111111111",
    category: "L2",
    narrative_summary: "Exchange-adjacent L2 distribution hypothesis for comparative research.",
    catalyst_summary: "Study consumer onboarding funnels; not a Solana trade proxy.",
    narrative_score: 65,
    asymmetry_score: 57,
    catalyst_score: 58,
    attention_score: 78,
    liquidity_score: 60,
  },
  {
    seedId: "sol-msol",
    symbol: "mSOL",
    name: "Marinade Staked SOL",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    category: "SOLANA_ECOSYSTEM",
    narrative_summary: "Liquid staking derivative as Solana capital-efficiency research sample.",
    catalyst_summary: "Monitor stake share and validator set notes over time.",
    narrative_score: 75,
    asymmetry_score: 50,
    catalyst_score: 46,
    attention_score: 58,
    liquidity_score: 77,
  },
] as const;

if (HYPOTHESIS_SEED_UNIVERSE.length > HYPOTHESIS_UNIVERSE_MAX) {
  throw new Error(
    `HYPOTHESIS_SEED_UNIVERSE length ${HYPOTHESIS_SEED_UNIVERSE.length} exceeds HYPOTHESIS_UNIVERSE_MAX ${HYPOTHESIS_UNIVERSE_MAX}`,
  );
}

export type SeedHypothesisUniverseResult = {
  inserted: number;
  skipped: number;
  total: number;
};

function seedInputsJson(seed: HypothesisSeedAsset): string {
  return JSON.stringify({
    source: "hypothesis_seed_universe",
    seed_id: seed.seedId,
    research_only: true,
    not_a_trade_list: true,
  });
}

/**
 * Idempotent seed of the first hypothesis research universe.
 * Append-safe: existing open mints are skipped (duplicate prevention).
 * Does not emit events, push, or activation transitions.
 */
export async function seedHypothesisUniverse(
  client: Client,
  options: { now?: number } = {},
): Promise<SeedHypothesisUniverseResult> {
  const now = options.now ?? HYPOTHESIS_SEED_CAPTURED_AT;
  let inserted = 0;
  let skipped = 0;

  for (const seed of HYPOTHESIS_SEED_UNIVERSE) {
    const scored = computeHypothesisScore({
      narrative_score: seed.narrative_score,
      asymmetry_score: seed.asymmetry_score,
      catalyst_score: seed.catalyst_score,
      attention_score: seed.attention_score,
      liquidity_score: seed.liquidity_score,
    });

    const result = await client.execute({
      sql: `
        INSERT OR IGNORE INTO hypothesis_assets (
          mint, token_case_id, symbol, name, category, status,
          hypothesis_score, narrative_score, asymmetry_score, catalyst_score,
          attention_score, liquidity_score, rank, narrative_summary, catalyst_summary,
          score_version, inputs_json, activated_at, invalidated_at, entered_universe_at,
          updated_at
        ) VALUES (?, NULL, ?, ?, ?, 'WATCH', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `,
      args: [
        seed.mint,
        seed.symbol,
        seed.name,
        seed.category,
        scored.hypothesis_score,
        scored.narrative_score,
        scored.asymmetry_score,
        scored.catalyst_score,
        scored.attention_score,
        scored.liquidity_score,
        seed.narrative_summary,
        seed.catalyst_summary,
        HYPOTHESIS_SCORE_VERSION,
        seedInputsJson(seed),
        now,
        now,
      ],
    });

    if ((result.rowsAffected ?? 0) > 0) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    inserted,
    skipped,
    total: HYPOTHESIS_SEED_UNIVERSE.length,
  };
}
