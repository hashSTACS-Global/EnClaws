/**
 * i18n lookup for tier display names. Use this everywhere UI renders a
 * tier to a user — `TIER_LABELS` in constants/providers.ts is a constant
 * map (hardcoded Chinese) kept only for places that need a static fallback
 * or pure reference shape (tests, type derivation).
 */

import { t } from "./index.ts";
import type { ModelTierValue } from "../constants/providers.ts";

export function tierLabel(tier: ModelTierValue): string {
  return t(`models.tierLabel.${tier}`);
}
