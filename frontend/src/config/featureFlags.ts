export interface FeatureFlags {
  fiatOnRamp: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  fiatOnRamp: false,
};

function readEnvFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return undefined;
}

/**
 * Resolve the active feature flags, allowing environment overrides so the
 * fiat on-ramp can be toggled per deployment without a code change.
 */
export function getFeatureFlags(): FeatureFlags {
  const envFlag = readEnvFlag(process.env.REACT_APP_FEATURE_FIAT_ON_RAMP);
  return {
    ...DEFAULT_FLAGS,
    ...(envFlag === undefined ? {} : { fiatOnRamp: envFlag }),
  };
}

/**
 * Whether the fiat on-ramp (SEP-24) feature is enabled. The ramp UI, its
 * entry points in the purchase wizard and wallet menu, and the status
 * tracker are all gated behind this flag.
 */
export function isFiatOnRampEnabled(): boolean {
  return getFeatureFlags().fiatOnRamp;
}
