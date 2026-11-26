/** Capability tags a connector or API key can be created with. "all" is the default. */
export interface CapabilityPreset {
  id: string;
  label: string;
  description: string;
  capabilities: readonly string[];
}

export const CAPABILITY_PRESETS: readonly CapabilityPreset[] = [
  {
    id: "all",
    label: "All capabilities",
    description: "Research, writing, and editing",
    capabilities: ["social-search", "web-research", "design-system", "long-form-writing", "social-copy", "editing", "tone-review"],
  },
  {
    id: "research",
    label: "Research",
    description: "Search and sourced facts",
    capabilities: ["social-search", "web-research"],
  },
  {
    id: "writing",
    label: "Writing",
    description: "Long-form and social copy",
    capabilities: ["design-system", "long-form-writing", "social-copy"],
  },
  {
    id: "editing",
    label: "Editing",
    description: "Tone and accuracy",
    capabilities: ["editing", "tone-review"],
  },
];

const CAPABILITY_TAG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function capabilitiesForPreset(id: string): string[] {
  const preset = CAPABILITY_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown capability preset ${id}`);
  return [...preset.capabilities];
}

/** Preset tags plus any extra tags. An omitted preset is "all". */
export function resolveCapabilities(presetId: string | undefined, extra: readonly string[] = []): string[] {
  const id = presetId && presetId.length > 0 ? presetId : "all";
  const base = capabilitiesForPreset(id);
  const cleaned = extra.map((tag) => tag.trim().toLowerCase()).filter((tag) => CAPABILITY_TAG.test(tag));
  return [...new Set([...base, ...cleaned])];
}

export function providerFromClientName(name: string): "anthropic" | "openai" | "xai" | "other" {
  const normalized = name.toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("chatgpt") || normalized.includes("openai") || /\bgpt\b/.test(normalized)) return "openai";
  if (normalized.includes("grok") || normalized.includes("xai")) return "xai";
  return "other";
}

/** Short editable label for the approval form when the client name is a URL. */
export function prefillAgentName(clientName: string): string {
  const trimmed = clientName.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    try {
      return new URL(trimmed).hostname.slice(0, 80);
    } catch {
      return "Connected agent";
    }
  }
  return trimmed.slice(0, 80) || "Connected agent";
}
