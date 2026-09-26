import { z } from "zod";

/**
 * Shared zod schemas for forms and API payloads.
 *
 * These schemas centralize validation rules that are shared between client
 * forms and API payloads so that client-side validation matches the backend
 * and on-chain contract rules.
 *
 * Each limit below is annotated with its source (contract constant or backend
 * config) so the two stay in sync.
 */

// ---------------------------------------------------------------------------
// i18n error map
// ---------------------------------------------------------------------------

/**
 * Minimal translation function shape. The app's i18n instance (or a bound
 * `t` function) is passed in so error messages can be localized.
 */
export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Builds a zod error map that routes every issue through the app's i18n
 * setup. Keys follow the `validation.<code>` convention and fall back to the
 * default zod message when a translation is missing.
 */
export function createZodErrorMap(t: TranslateFn): z.ZodErrorMap {
  return (issue, ctx) => {
    const key = `validation.${issue.code}`;
    const translated = t(key, {
      ...(issue as { [k: string]: unknown }),
      minimum: (issue as { minimum?: number }).minimum ?? "",
      maximum: (issue as { maximum?: number }).maximum ?? "",
    });

    // `t` returns the key itself when no translation exists; in that case
    // fall back to zod's default message so we never surface raw keys.
    if (translated && translated !== key) {
      return { message: translated };
    }

    return { message: ctx.defaultError };
  };
}

/**
 * Applies the i18n error map globally. Call once during app bootstrap with the
 * active i18n `t` function.
 */
export function configureZodI18n(t: TranslateFn): void {
  z.setErrorMap(createZodErrorMap(t));
}

// ---------------------------------------------------------------------------
// Stellar address (StrKey)
// ---------------------------------------------------------------------------

/**
 * Stellar StrKey public key (account address).
 *
 * Source: Stellar StrKey encoding — account IDs are 56-char base32 strings
 * starting with `G` (see stellar-sdk `StrKey.isValidEd25519PublicKey`).
 */
export const stellarAddressSchema = z
  .string()
  .trim()
  .regex(/^G[A-Z2-7]{55}$/, "validation.stellarAddress");

/**
 * Stellar StrKey contract ID.
 *
 * Source: Stellar StrKey encoding — contract IDs are 56-char base32 strings
 * starting with `C` (see stellar-sdk `StrKey.isValidContract`).
 */
export const stellarContractIdSchema = z
  .string()
  .trim()
  .regex(/^C[A-Z2-7]{55}$/, "validation.stellarContractId");

// ---------------------------------------------------------------------------
// Amount strings
// ---------------------------------------------------------------------------

/**
 * Amount as a decimal string (never a float, to avoid precision loss).
 *
 * Source: backend config `AMOUNT_MAX_DECIMALS = 7` (Stellar's 7-decimal
 * precision) and `AMOUNT_MIN = 0` (amounts must be strictly positive).
 */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,7})?$/, "validation.amount")
  .refine((value) => Number(value) > 0, "validation.amountPositive");

/**
 * Coverage amount. Same precision rules as `amountSchema`.
 *
 * Source: contract constant `MIN_COVERAGE` / `MAX_COVERAGE` (see
 * `contracts/policy/src/lib.rs`).
 */
export const coverageAmountSchema = amountSchema.refine(
  (value) => Number(value) >= 1,
  "validation.coverageMinimum",
);

// ---------------------------------------------------------------------------
// Risk input
// ---------------------------------------------------------------------------

/**
 * Risk input submitted when requesting a quote.
 *
 * Source: backend config `RISK_SCORE_MIN = 0`, `RISK_SCORE_MAX = 100`.
 */
export const riskInputSchema = z.object({
  region: z.string().trim().min(1, "validation.required"),
  category: z.string().trim().min(1, "validation.required"),
  riskScore: z
    .number()
    .int("validation.integer")
    .min(0, "validation.riskScoreMinimum")
    .max(100, "validation.riskScoreMaximum"),
});

export type RiskInput = z.infer<typeof riskInputSchema>;

// ---------------------------------------------------------------------------
// Policy purchase payload
// ---------------------------------------------------------------------------

/**
 * Policy purchase payload.
 *
 * Source: contract constant `MIN_COVERAGE` / `MAX_COVERAGE` and backend
 * config `POLICY_TERM_DAYS_MIN = 1`, `POLICY_TERM_DAYS_MAX = 365`.
 */
export const policyPurchaseSchema = z.object({
  holder: stellarAddressSchema,
  coverageAmount: coverageAmountSchema,
  premium: amountSchema,
  termDays: z
    .number()
    .int("validation.integer")
    .min(1, "validation.termMinimum")
    .max(365, "validation.termMaximum"),
  risk: riskInputSchema,
});

export type PolicyPurchasePayload = z.infer<typeof policyPurchaseSchema>;

// ---------------------------------------------------------------------------
// Claim filing payload
// ---------------------------------------------------------------------------

/**
 * Claim filing payload.
 *
 * Source: backend config `EVIDENCE_MAX_ITEMS = 10` and
 * `EVIDENCE_URL_MAX_LENGTH = 2048`.
 */
export const claimFilingSchema = z.object({
  policyId: z.string().trim().min(1, "validation.required"),
  claimant: stellarAddressSchema,
  amount: amountSchema,
  description: z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(2000, "validation.descriptionMaximum"),
  evidence: z
    .array(z.string().trim().url("validation.evidenceUrl").max(2048))
    .max(10, "validation.evidenceMaximum"),
});

export type ClaimFilingPayload = z.infer<typeof claimFilingSchema>;

// ---------------------------------------------------------------------------
// Profile updates
// ---------------------------------------------------------------------------

/**
 * Profile update payload.
 *
 * Source: backend config `DISPLAY_NAME_MAX_LENGTH = 64`,
 * `BIO_MAX_LENGTH = 280`.
 */
export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(64, "validation.displayNameMaximum"),
  bio: z.string().trim().max(280, "validation.bioMaximum").optional(),
  stellarAddress: stellarAddressSchema.optional(),
});

export type ProfileUpdatePayload = z.infer<typeof profileUpdateSchema>;
