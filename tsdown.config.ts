const env = {
  NODE_ENV: "production",
};

const shared = {
  env,
  fixedExtension: false,
  platform: "node" as const,
  inlineOnly: false,
};

export default [
  {
    entry: "src/index.ts",
    ...shared,
  },
  {
    entry: "src/entry.ts",
    ...shared,
  },
  {
    // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
    entry: "src/cli/daemon-cli.ts",
    ...shared,
  },
  {
    entry: "src/infra/warning-filter.ts",
    ...shared,
  },
  {
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: "src/plugin-sdk/account-id.ts",
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: [
      "src/plugin-sdk/reply-history.ts",
      "src/plugin-sdk/channel-contract.ts",
      "src/plugin-sdk/param-readers.ts",
      "src/plugin-sdk/reply-runtime.ts",
      "src/plugin-sdk/setup.ts",
      "src/plugin-sdk/channel-status.ts",
      "src/plugin-sdk/channel-runtime.ts",
      "src/plugin-sdk/channel-feedback.ts",
      "src/plugin-sdk/channel-send-result.ts",
      "src/plugin-sdk/agent-runtime.ts",
      "src/plugin-sdk/zalouser.ts",
      "src/plugin-sdk/routing.ts",
      "src/plugin-sdk/channel-policy.ts",
      "src/plugin-sdk/tool-send.ts",
      "src/plugin-sdk/temp-path.ts",
      "src/plugin-sdk/allow-from.ts",
    ],
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: "src/extensionAPI.ts",
    ...shared,
  },
  {
    entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
    ...shared,
  },
];
