// Prediction record schema — the full object lives in 0G Storage; only its
// keccak256 hash goes on-chain. Keep this in lockstep with the frontend verifier
// and the Solidity `Outcome` enum.

export type Outcome = "HOME" | "DRAW" | "AWAY";

/** On-chain enum ordering. MUST match the Solidity `enum Outcome`. */
export const OUTCOME_INDEX: Record<Outcome, number> = {
  HOME: 0,
  DRAW: 1,
  AWAY: 2,
};

export const OUTCOME_FROM_INDEX: Outcome[] = ["HOME", "DRAW", "AWAY"];

export interface DebateEntry {
  agent: string; // display name, e.g. "The Statistician"
  role: string; // one-line description of its lens
  outcome: Outcome;
  scoreline: string;
  confidence: number;
  take: string; // the agent's reasoning
  teeSignatureValid: boolean;
}

export interface PredictionRecord {
  schemaVersion: "1.0";
  agentId: string; // 0G Agentic ID — did:0g:<agent wallet>
  agentCardRoot?: string; // 0G Storage root of the agent identity card
  match: {
    id: string; // e.g. "wc2026-m57"
    home: string;
    away: string;
    competition: string;
    kickoffUtc: string; // ISO 8601, Z
  };
  prediction: {
    outcome: Outcome;
    scoreline: string; // "2-1"
    confidence: number; // 0..1
    rationale: string; // one line, model-generated
  };
  // The panel of analyst agents that debated this call, plus the judge's
  // synthesis. Each ran its own TEE inference. The final `prediction` above is
  // the judge's verdict.
  debate?: {
    panel: DebateEntry[];
    consensus: string;
  };
  provenance: {
    provider: string; // 0x provider address
    model: string;
    chatId: string; // ZG-Res-Key returned by the Direct inference
    verificationMode: "TeeML" | "TeeTLS";
    teeSignatureValid: boolean;
    attestationRef: string; // path/hash of the saved attestation report
  };
  createdAtUtc: string; // ISO 8601, Z
  dataSources: string[];
}
