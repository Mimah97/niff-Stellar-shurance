/**
 * Client-side validation for governance proposal payloads.
 *
 * These limits mirror the on-chain governance contract so that invalid
 * proposals are rejected before a transaction is ever submitted.
 */

/** Basis points are expressed out of 10_000 (100%). */
export const BPS_DENOMINATOR = 10_000;

/** Proposal kinds supported by the governance contract. */
export type ProposalKind =
  | "parameter_change"
  | "quorum_change"
  | "treasury_spend"
  | "text";

/** Payload shapes keyed by proposal kind. */
export interface ParameterChangePayload {
  kind: "parameter_change";
  /** Parameter key being modified, e.g. "min_collateral". */
  parameter: string;
  /** New value encoded as a string to preserve integer precision. */
  value: string;
}

export interface QuorumChangePayload {
  kind: "quorum_change";
  /** New quorum in basis points (1..=10_000). */
  quorumBps: number;
}

export interface TreasurySpendPayload {
  kind: "treasury_spend";
  /** Recipient address. */
  recipient: string;
  /** Amount in the smallest unit, encoded as a string. */
  amount: string;
}

export interface TextPayload {
  kind: "text";
  /** Free-form description, bounded by MAX_TEXT_LENGTH. */
  text: string;
}

export type ProposalPayload =
  | ParameterChangePayload
  | QuorumChangePayload
  | TreasurySpendPayload
  | TextPayload;

/** Contract limits. */
export const MAX_TITLE_LENGTH = 128;
export const MAX_DESCRIPTION_LENGTH = 2_048;
export const MAX_TEXT_LENGTH = 1_024;
export const MIN_QUORUM_BPS = 1;
export const MAX_QUORUM_BPS = BPS_DENOMINATOR;

/** Result of a validation pass. */
export interface ValidationResult {
  valid: boolean;
  /** Field-keyed error messages, empty when valid. */
  errors: Record<string, string>;
}

function isPositiveIntegerString(value: string): boolean {
  return /^[0-9]+$/.test(value.trim());
}

/**
 * Validate a quorum value expressed in basis points.
 * Returns an error message, or null when the value is acceptable.
 */
export function validateQuorumBps(value: number | string): string | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (value === "" || value === null || value === undefined) {
    return "Quorum is required";
  }
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return "Quorum must be a whole number of basis points";
  }
  if (numeric < MIN_QUORUM_BPS) {
    return `Quorum must be at least ${MIN_QUORUM_BPS} bps`;
  }
  if (numeric > MAX_QUORUM_BPS) {
    return `Quorum cannot exceed ${MAX_QUORUM_BPS} bps (100%)`;
  }
  return null;
}

/**
 * Validate a proposal payload against the contract's limits for its kind.
 */
export function validatePayload(payload: ProposalPayload): ValidationResult {
  const errors: Record<string, string> = {};

  switch (payload.kind) {
    case "parameter_change": {
      if (!payload.parameter.trim()) {
        errors.parameter = "Parameter name is required";
      }
      if (!payload.value.trim()) {
        errors.value = "Value is required";
      } else if (!isPositiveIntegerString(payload.value)) {
        errors.value = "Value must be a non-negative integer";
      }
      break;
    }
    case "quorum_change": {
      const error = validateQuorumBps(payload.quorumBps);
      if (error) {
        errors.quorumBps = error;
      }
      break;
    }
    case "treasury_spend": {
      if (!payload.recipient.trim()) {
        errors.recipient = "Recipient address is required";
      }
      if (!payload.amount.trim()) {
        errors.amount = "Amount is required";
      } else if (!isPositiveIntegerString(payload.amount)) {
        errors.amount = "Amount must be a non-negative integer";
      }
      break;
    }
    case "text": {
      if (!payload.text.trim()) {
        errors.text = "Text is required";
      } else if (payload.text.length > MAX_TEXT_LENGTH) {
        errors.text = `Text cannot exceed ${MAX_TEXT_LENGTH} characters`;
      }
      break;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate the shared proposal metadata (title + description).
 */
export function validateProposalMeta(title: string, description: string): ValidationResult {
  const errors: Record<string, string> = {};

  if (!title.trim()) {
    errors.title = "Title is required";
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Title cannot exceed ${MAX_TITLE_LENGTH} characters`;
  }

  if (!description.trim()) {
    errors.description = "Description is required";
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate a full create-proposal submission.
 */
export function validateProposal(
  title: string,
  description: string,
  payload: ProposalPayload,
): ValidationResult {
  const meta = validateProposalMeta(title, description);
  const body = validatePayload(payload);
  const errors = { ...meta.errors, ...body.errors };
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Compute the remaining proposer cooldown in milliseconds.
 * Returns 0 when the cooldown has elapsed.
 */
export function cooldownRemainingMs(
  lastProposalAt: number | null | undefined,
  cooldownMs: number,
  now: number = Date.now(),
): number {
  if (!lastProposalAt) {
    return 0;
  }
  const elapsed = now - lastProposalAt;
  return elapsed >= cooldownMs ? 0 : cooldownMs - elapsed;
}

/**
 * Whether a proposer may create a new proposal right now.
 */
export function canCreateProposal(
  lastProposalAt: number | null | undefined,
  cooldownMs: number,
  now: number = Date.now(),
): boolean {
  return cooldownRemainingMs(lastProposalAt, cooldownMs, now) === 0;
}

/**
 * Human-readable cooldown explanation for the disabled create form.
 */
export function cooldownMessage(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return `You can create another proposal in ${parts.join(" ")}`;
}
