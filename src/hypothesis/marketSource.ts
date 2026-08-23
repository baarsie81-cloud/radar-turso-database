import type { Client } from "@libsql/client";
import type { HypothesisAssetRow } from "../db/repositories/hypothesis/assets";
import { listSnapshotsByCase, type SnapshotRow } from "../db/repositories/snapshots";
import {
  getOpenTokenCaseByMint,
  getTokenCase,
} from "../db/repositories/tokenCases";
import {
  snapshotRowToObservation,
  type HypothesisMarketObservation,
} from "./marketAdapter";

export type HypothesisMarketResolution =
  | "token_case_id_snapshot"
  | "open_mint_snapshot"
  | "none";

export type GatheredHypothesisMarket = {
  market: HypothesisMarketObservation | null;
  dataSources: string[];
  missingFields: string[];
  resolution: HypothesisMarketResolution;
  snapshotId: number | null;
  tokenCaseId: number | null;
};

const OBSERVATION_FIELDS = [
  "price",
  "marketCap",
  "liquidityUsd",
  "volumeUsd",
  "priceChangePct",
  "momentumPct",
  "roiPct",
] as const;

function pickLatestSnapshot(rows: SnapshotRow[]): SnapshotRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    if (b.capturedAt !== a.capturedAt) return b.capturedAt - a.capturedAt;
    return b.id - a.id;
  })[0] ?? null;
}

function missingFieldsFromMarket(
  market: HypothesisMarketObservation | null,
): string[] {
  if (market == null) {
    return [...OBSERVATION_FIELDS];
  }
  const missing: string[] = [];
  for (const field of OBSERVATION_FIELDS) {
    const value = market[field];
    if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
      missing.push(field);
    }
  }
  return missing;
}

function fromSnapshot(
  snapshot: SnapshotRow,
  resolution: HypothesisMarketResolution,
  dataSources: string[],
): GatheredHypothesisMarket {
  const market = snapshotRowToObservation(snapshot);
  return {
    market,
    dataSources,
    missingFields: missingFieldsFromMarket(market),
    resolution,
    snapshotId: snapshot.id,
    tokenCaseId: snapshot.tokenCaseId,
  };
}

function emptyGather(): GatheredHypothesisMarket {
  return {
    market: null,
    dataSources: [],
    missingFields: missingFieldsFromMarket(null),
    resolution: "none",
    snapshotId: null,
    tokenCaseId: null,
  };
}

/**
 * Resolve market observation from existing project DB rows only.
 * No network / provider calls. Soft-links Radar snapshots when present.
 */
export async function gatherHypothesisMarketObservation(
  client: Client,
  asset: HypothesisAssetRow,
): Promise<GatheredHypothesisMarket> {
  if (asset.tokenCaseId != null) {
    const tokenCase = await getTokenCase(client, asset.tokenCaseId);
    if (tokenCase) {
      const latest = pickLatestSnapshot(
        await listSnapshotsByCase(client, tokenCase.id),
      );
      if (latest) {
        return fromSnapshot(latest, "token_case_id_snapshot", [
          "radar_snapshots",
          "hypothesis_assets.token_case_id",
        ]);
      }
    }
  }

  const openCase = await getOpenTokenCaseByMint(client, asset.mint);
  if (openCase) {
    const latest = pickLatestSnapshot(
      await listSnapshotsByCase(client, openCase.id),
    );
    if (latest) {
      return fromSnapshot(latest, "open_mint_snapshot", [
        "radar_snapshots",
        "token_cases.mint",
      ]);
    }
  }

  return emptyGather();
}
