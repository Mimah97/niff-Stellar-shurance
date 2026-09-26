import { z } from "zod";

/**
 * i18n error map for zod.
 *
 * Zod resolves messages through this map so that every shared schema in
 * `lib/schemas/` emits translated, user-facing text instead of raw defaults.
 * The translator is injected once at app bootstrap (see `setSchemaTranslator`)
 * so schemas stay framework-agnostic and testable.
 */
export type SchemaTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

let translator: SchemaTranslator | null = null;

/**
 * Register the active i18n translator. Call this from the app entry point
 * (e.g. where the i18n provider is mounted) before rendering any form.
 */
export function setSchemaTranslator(next: SchemaTranslator | null): void {
  translator = next;
}

/**
 * Translate a schema message key, falling back to the key itself when no
 * translator has been registered (keeps unit tests and SSR safe).
 */
export function translateSchemaMessage(
  key: string,
  values?: Record<string, string | number>,
): string {
  if (!translator) return key;
  return translator(key, values);
}

/**
 * Message keys used across the shared schemas. Keeping them in one place
 * makes it easy to audit that every key exists in the translation catalogs.
 */
export const schemaErrorKeys = {
  required: "validation.required",
  invalidType: "validation.invalidType",
  stellarAddress: "validation.stellarAddress",
  amountFormat: "validation.amountFormat",
  amountPositive: "validation.amountPositive",
  amountMax: "validation.amountMax",
  riskLevel: "validation.riskLevel",
  coverageRange: "validation.coverageRange",
  evidenceLimit: "validation.evidenceLimit",
  evidenceUrl: "validation.evidenceUrl",
  tooShort: "validation.tooShort",
  tooLong: "validation.tooLong",
  email: "validation.email",
} as const;

/**
 * Zod error map wired to the i18n translator. Install it globally with
 * `z.setErrorMap(schemaErrorMap)` (or pass it per-parse) so all schemas
 * produce translated messages.
 */
export const schemaErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: translateSchemaMessage(schemaErrorKeys.required) };
      }
      return {
        message: translateSchemaMessage(schemaErrorKeys.invalidType, {
          expected: issue.expected,
        }),
      };
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") {
        return {
          message: translateSchemaMessage(schemaErrorKeys.tooShort, {
            minimum: issue.minimum,
          }),
        };
      }
      return {
        message: translateSchemaMessage(schemaErrorKeys.amountPositive),
      };
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") {
        return {
          message: translateSchemaMessage(schemaErrorKeys.tooLong, {
            maximum: issue.maximum,
          }),
        };
      }
      return {
        message: translateSchemaMessage(schemaErrorKeys.amountMax, {
          maximum: issue.maximum,
        }),
      };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") {
        return { message: translateSchemaMessage(schemaErrorKeys.email) };
      }
      if (issue.validation === "url") {
        return { message: translateSchemaMessage(schemaErrorKeys.evidenceUrl) };
      }
      return { message: translateSchemaMessage(schemaErrorKeys.invalidType) };
    case z.ZodIssueCode.custom:
      return { message: ctx.defaultError };
    default:
      return { message: ctx.defaultError };
  }
};
