# Radar V24 Design Principles

Status: binding guidance for all future Radar V24 work.  
Audience: anyone changing Turso schema, collector, decision engine, outcomes, API, or dashboard.  
Source: lessons learned from Neon/V2 ENTRY MOMENTUM (stopped; history retained for analysis only).

This document does not authorize migrations, feature work, or V2 code changes by itself.

---

## 1. Product philosophy

Radar V24 is a **new standalone product**, not a migration of Neon/V2.

- **Lessons, not code.** V2 is a source of failure modes and useful concepts. It is not a template to copy.
- **Turso is the source of truth.** Lifecycle cases, snapshots, decisions, outcomes, jobs, and V24 push bookkeeping live in Turso/libSQL.
- **No Neon/V2 dependency.** V24 must run without Neon Postgres, without `marker_events`, and without the V2 cron/exact/marker/push chain.
- **Research radar, not a trading bot.** No wallets, private keys, swaps, orders, or trade advice.
- **Explainability over cleverness.** A human must be able to replay why PASS or REJECT happened from stored inputs.

If a proposed change only makes V24 look more like V2 without improving learning or honesty, reject it.

---

## 2. Core mistakes from V2

These mistakes caused late or misleading “calls.” V24 must not repeat them.

### Confirmation vs prediction

V2 ENTRY MOMENTUM qualified only after a **+10m** Jupiter quote already showed **≥ 25%** ROI with non-negative +5→+10 momentum. That is **confirmation of a realized move**, not a prediction of an upcoming one. The product name implied early entry.

### Late alerts after realized movement

`marker_at` was set to `plus10.measured_at`. Push then required a **second** fresh entry quote inside **120 seconds**. Cadence was a 5-minute cron with a serial collect → exact → marker → push pipeline. Humans often received (or missed) the alert after the move.

### Quote ROI vs real trade reality

Decisions and research used **Jupiter round-trip quote ROI**. That is not the same as a filled trade at size, with slippage, impact, and route failure. Peaks between discrete samples were invisible. Alerts could look “executable” while they were research quotes only.

### Non-gating indicators creating false confidence

Health (HEALTHY / WARNING / RISK) and security (often UNKNOWN) appeared next to signals but **did not gate** QUALIFIED or push. Social lead minutes were context only. Only a narrow catastrophic market-integrity check suppressed push. UI decoration felt like risk clearance.

### Incomplete denominator / reporting

Research hit rates were easy to read as predictive skill while being computed on tokens that **already** cleared +25% and successfully got quotes. Missed windows (`MISSED_ENTRY_WINDOW`, `MISSED_WINDOW`) removed names from “executable” sets. Rejects and incomplete coverage were easy to under-report relative to winners.

### Complexity without measurable edge

Layers accumulated: discovery, Dex snapshots, exact-position quotes, marker events, forward quote outcomes, health, social, integrity guard, dual VAPID push paths. Capacity incidents showed early candidate windows starving under load. Complexity rose faster than proven edge.

---

## 3. V24 rules

### Decision transparency

Every decision must be explainable after the fact:

- **Inputs stored** (numeric fields + `inputs_json` sufficient to replay).
- **Reject reasons stored** when status is REJECT (explicit codes, not free-form vibes).
- **Replay possible** from case + stage + radar version without re-fetching the market.

Do not ship a PASS/REJECT that cannot be reconstructed from Turso alone.

### Decision vs outcome separation

Do not collapse tracking, decision, and result into one field.

| Concept | Meaning |
| --- | --- |
| `case_status` / lifecycle stage | Whether the token is still being followed |
| `decision_status` | What Radar decided at a stage (`PENDING` / `PASS` / `REJECT`) |
| `outcome_label` | What happened afterwards (`NO_RESULT` / `SMALL_WIN` / `RUNNER`, or unlabeled if incomplete) |

- A case may be REJECT and remain OPEN until CLOSED.
- Outcomes must not rewrite the historical decision.
- Incomplete closes stay unlabeled — they are not silent `NO_RESULT`.

### Coverage honesty

Always distinguish in metrics and UI:

- **Successful tracking** — required snapshots present and on time enough to decide.
- **Incomplete data** — case closed or evaluated without a full window.
- **Missing snapshots** — stage never written.
- **NO_DATA / missed window** — attempted but unavailable within the useful deadline.
- **True negative outcomes** — complete window, labeled `NO_RESULT` (or equivalent), not a coverage failure.

Never score OPEN / TRACKING / unlabeled incomplete as false positives.

### No fake confidence

Do not add:

- arbitrary composite scores;
- confidence percentages without a validated model;
- cosmetic indicators that sit beside alerts but do not affect decisions.

If it is shown next to a decision, it either **gates** the decision or is labeled **non-blocking context**.

### Naming matters

Avoid:

- “entry” language when the rule is confirmation of a move already measured;
- alert copy that implies a buy recommendation;
- research labels that sound like live trading signals.

Prefer precise names: decision, PASS/REJECT, snapshot stage, outcome label, coverage miss.

### One source of truth

Do not mix without explicit labeling:

- different price models (e.g. DEX spot snapshot vs Jupiter round-trip quote) in one PASS rate;
- different outcome windows (e.g. 15m post-marker quotes vs +15/+30/+60 from entry) in one “runner” rate;
- incompatible metrics that look comparable in a single table.

Pick one decision price series. If a second series is researched, keep it separate and named.

---

## 4. What V24 keeps from V2

### Keep (concepts)

- **Lifecycle tracking** — discrete stages from first seen through close.
- **Snapshots** — lightweight checkpoints with time and price (and related market fields as needed).
- **Outcomes** — post-decision labels for learning, independent of PASS/REJECT.
- **Reject reasons** — auditable, enumerable codes.
- **Deterministic rules** — pure evaluation from stored inputs (`evaluateRadar24` and successors under version control).
- **Historical analysis** — replay, completeness, and cohort honesty over vanity hit rates.

### Do not copy (implementation)

- Neon Postgres as a V24 dependency.
- `marker_events` / ENTRY MOMENTUM marker pipeline.
- V2 scoring / tracking-priority-as-signal.
- Jupiter confirmation pipeline as the decision gate.
- Complex serial V2 push chain tied to marker entry windows.
- V2 dashboard assumptions (QUALIFIED-only radar, display-only health as confidence, research KPIs without full denominators).

Reuse ideas. Do not port the Neon stack into Turso.

---

## 5. Development rules

Before adding a feature, answer all four:

1. **Does this improve prediction or only presentation?**  
   Presentation-only changes must not invent confidence.
2. **Does this create measurable learning?**  
   Prefer append-only evidence that can be scored later (decisions, coverage, outcomes).
3. **Can we replay and explain it?**  
   If not, do not ship it as a decision input.
4. **Does it add complexity without proven value?**  
   Default to no. Capacity and latency budgets beat feature count.

Additional hard constraints for this product phase (unless an explicit decision overrides them in writing):

- Do not treat Neon/V2 as a runtime dependency.
- Do not change `evaluateRadar24()` casually; version rule changes.
- Do not add confidence scoring until outcomes and coverage are honest and measured.
- Do not add ingest/filters/alerts that violate sections 3–4.

---

## 6. Current V24 architecture

High-level components of the standalone V24 product (Turso-first). Neon/V2 remains stopped and is used only as a source of lessons learned — not as part of this runtime.

| Component | Role |
| --- | --- |
| **Turso / libSQL** | Source of truth for cases, snapshots, decisions, outcomes, jobs/locks/watermarks, push bookkeeping |
| **Lifecycle** | Stages `INITIAL → PLUS_5 → PLUS_10 → PLUS_15 → PLUS_30 → PLUS_60 → CLOSED`; case tracking separate from decisions |
| **Collector** | Discovers tokens, schedules snapshot jobs, fetches market data, advances lifecycle under a collection lock |
| **GeckoTerminal** | Discovery provider for new Solana pools / tokens |
| **DexScreener** | Market snapshot provider for lifecycle prices (and related fields) |
| **`evaluateRadar24()`** | Pure decision engine at the configured stage (PASS/REJECT/PENDING + reject reasons + inputs) |
| **Outcomes** | `labelOutcome()` / close path — `NO_RESULT` / `SMALL_WIN` / `RUNNER` (or unlabeled if incomplete) |
| **Hono read API** | Optional health/cases/push endpoints; not required for the Next dashboard path |
| **Next.js app** | V24 UI (radar / cases / replay) and V24-specific routes; Server Components read Turso repositories in-process — no Neon |

Supporting principles already encoded in V24 domain design:

- `decision_status` ≠ `case_status` ≠ `outcome_label`
- Social/audit observations are not decision filters unless explicitly promoted later under section 5
- No wallets, swaps, or trade execution

---

## 7. V24 Success Definition

V24 success is **not** defined by the number of alerts.

It is defined by whether the system is honest, independent, and learnable:

### 1. Independent operation

V24 runs without V2 or Neon. Turso is the only database. No V2 runtime imports, no V2 data bridge, no shared V2 cron or push infrastructure.

### 2. Reproducible decisions

Every decision can be explained from stored inputs. Replay uses Turso rows (`inputs_json`, reject reasons, ROI fields) — not a re-fetch of the market and not a silent re-run that changes history.

### 3. Measurable outcomes

Decisions are separated from market outcomes. PASS/REJECT answers “what did the rule decide?” Outcome labels answer “what happened afterwards?” Neither overwrites the other.

### 4. Honest evaluation

False positives, missed opportunities, incomplete coverage, and missed windows are visible. Vanity hit rates on survivors alone are not success.

### 5. Data-driven improvement

Changes are based on measured results, not intuition. New signals, filters, and alert copy wait until collection, lifecycle completeness, and outcome denominators are reliable enough to judge them.

---

## 8. Additional V24 Rules

### Rule 9 — No alert without context

Every alert/event should make clear:

- lifecycle age;
- snapshot completeness;
- decision status;
- reason for decision;
- relevant market context.

Avoid presenting information that creates confidence without affecting the decision. If a field does not gate PASS/REJECT, label it as non-blocking context or do not put it next to the alert.

### Rule 10 — Measure the complete population

V24 must not only analyze successful calls.

Track:

- all discovered tokens;
- accepted decisions;
- rejected decisions;
- incomplete cases;
- missed windows;
- final outcomes.

Avoid survivorship bias. Metrics and research views must keep the full denominator visible.

### Rule 11 — Observe before optimizing

The first goal of V24 is:

- reliable collection;
- complete lifecycle tracking;
- reproducible decisions;
- measurable outcomes.

Optimization and new signals only happen after sufficient data exists. Do not add scoring layers, extra filters, or “smarter” alerts to compensate for incomplete observation.

---

## 9. Alert Philosophy

V24 should not present confirmation signals as early opportunities.

Before creating an alert, ask:

- Is this a **predictive** signal or a **confirmation** signal?
- Is the timing still useful?
- Does the user understand what the alert actually means?

Naming matters.

Avoid misleading terms that imply more certainty than the data supports. Prefer language that states the measured fact (for example: decision stage, PASS/REJECT, reject reason, snapshot age) over language that implies entry timing, tradeability, or guaranteed edge.

Alerts are communication about stored decisions and coverage — not trading advice.

---

## Document control

| Field | Value |
| --- | --- |
| ID | `v24principles001` |
| Path | `docs/V24_DESIGN_PRINCIPLES.md` |
| Product | Radar V24 (Turso) |
| Supersedes | Informal V2 “ENTRY MOMENTUM” product story for new work |
| Related analysis | Cursor canvas / chat: Moonshot Radar V2 Lessons Learned |
| Updated | Success definition; Rules 9–11; Alert Philosophy |

When this document conflicts with a convenience shortcut in code or UI, **this document wins** until deliberately revised.
