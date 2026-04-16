/**
 * Shared channel type definitions.
 *
 * Used by onboarding wizard, tenant-channels, and tenant-agents pages.
 */

export interface ChannelTypeDef {
  value: string;
  labelKey: string;
  icon?: string;
}

export const CHANNEL_TYPES: readonly ChannelTypeDef[] = [
  { value: "feishu", labelKey: "channels.feishu", icon: "/feishu-logo.svg" },
  { value: "dingtalk", labelKey: "channels.dingtalk", icon: "/dingtalk-logo.svg" },
  { value: "wecom", labelKey: "channels.wecom", icon: "/wecom-logo.svg" },
] as const;

/** Quick lookup: channel type value → icon path (or undefined) */
export const CHANNEL_ICON_MAP: Record<string, string> = Object.fromEntries(
  CHANNEL_TYPES.filter((c) => c.icon).map((c) => [c.value, c.icon!]),
);
