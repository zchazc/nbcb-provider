/**
 * NBCB Provider Plugin for OpenCode
 *
 * Provides a custom LLM provider with automatic token management.
 * Periodically fetches a token from a configured URL and injects it
 * into every API request header.
 *
 * ## Environment Variables
 *
 * Token configuration:
 *   NBCB_TOKEN_URL            - URL to fetch tokens from (required for token refresh)
 *   NBCB_TOKEN_METHOD         - HTTP method "GET" or "POST" (default: "POST")
 *   NBCB_TOKEN_HEADERS        - JSON string of extra headers for token request
 *   NBCB_TOKEN_BODY           - JSON string body for POST token request
 *   NBCB_TOKEN_PATH           - Dot-path to token in response JSON (default: "token")
 *   NBCB_TOKEN_REFRESH_SECS   - Refresh interval in seconds (default: 3600)
 *
 * Provider configuration:
 *   NBCB_PROVIDER_ID          - Provider identifier (default: "nbcb")
 *   NBCB_PROVIDER_NAME        - Display name (default: "NBCB")
 *   NBCB_PROVIDER_BASE_URL    - API base URL (required)
 *   NBCB_PROVIDER_NPM         - NPM package for provider SDK (default: "@ai-sdk/openai-compatible")
 *   NBCB_PROVIDER_MODELS      - JSON string of model definitions
 *                                e.g. '{"model-1":{"name":"Model One"}}'
 *   NBCB_HEADER_NAME          - Header name for token (default: "Authorization")
 *   NBCB_HEADER_FORMAT        - Header value format, use {token} as placeholder
 *                                (default: "Bearer {token}")
 *   COMPAT_PROVIDER_ID_ACCESS - How to read provider ID from chat.headers input:
 *                                "auto"    - try info.id then id (default)
 *                                "direct"  - use provider.id (current OpenCode bug)
 *                                "context" - use provider.info.id (correct ProviderContext)
 *
 * ## Usage
 *
 * 1. As npm package — in opencode.json:
 *      { "plugin": ["nbcb-provider"] }
 *
 * 2. As local plugin — place this file in .opencode/plugin/
 */

import type { Plugin } from "@opencode-ai/plugin";
import { TokenManager } from "./token-manager";

// Provider configuration from environment
const PROVIDER_ID = process.env.NBCB_PROVIDER_ID ?? "nbcb";
const PROVIDER_NAME = process.env.NBCB_PROVIDER_NAME ?? "NBCB";
const PROVIDER_BASE_URL = process.env.NBCB_PROVIDER_BASE_URL ?? "";
const PROVIDER_NPM = process.env.NBCB_PROVIDER_NPM ?? "@ai-sdk/openai-compatible";
const HEADER_NAME = process.env.NBCB_HEADER_NAME ?? "Authorization";
const HEADER_FORMAT = process.env.NBCB_HEADER_FORMAT ?? "Bearer {token}";

// Compatibility: OpenCode bug causes input.provider to be Provider instead of ProviderContext
// - Provider:        { id, name, ... }           → read .id directly
// - ProviderContext: { info: { id, name, ... } }  → read .info.id
const COMPAT_PROVIDER_ID_ACCESS =
  (process.env.COMPAT_PROVIDER_ID_ACCESS as "auto" | "direct" | "context") ?? "auto";

function getProviderId(provider: any): string | undefined {
  if (COMPAT_PROVIDER_ID_ACCESS === "direct") {
    return provider?.id;
  }
  if (COMPAT_PROVIDER_ID_ACCESS === "context") {
    return provider?.info?.id;
  }
  // auto: try both
  return provider?.info?.id ?? provider?.id;
}

function parseModels(): Record<
  string,
  { name: string; limit?: { context: number; output: number } }
> {
  const raw = process.env.NBCB_PROVIDER_MODELS;
  if (!raw) {
    return {
      default: {
        name: "Default Model",
      },
    };
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[nbcb-provider] Failed to parse NBCB_PROVIDER_MODELS, using default");
    return { default: { name: "Default Model" } };
  }
}

export const NBCBProviderPlugin: Plugin = async (_ctx) => {
  const tokenManager = new TokenManager();

  if (tokenManager.enabled) {
    await tokenManager.start();
  }

  return {
    // Register the custom provider via config hook
    config: async (config) => {
      if (!PROVIDER_BASE_URL) {
        console.warn(
          "[nbcb-provider] NBCB_PROVIDER_BASE_URL not set, skipping provider registration",
        );
        return;
      }

      const providers = (config.provider ?? {}) as Record<string, any>;
      providers[PROVIDER_ID] = {
        npm: PROVIDER_NPM,
        name: PROVIDER_NAME,
        options: {
          baseURL: PROVIDER_BASE_URL,
        },
        models: parseModels(),
      };
      config.provider = providers;

      console.log(
        `[nbcb-provider] Registered provider "${PROVIDER_ID}" with base URL: ${PROVIDER_BASE_URL}`,
      );
    },

    // Inject token into request headers for our provider
    "chat.headers": async (input, output) => {
      const token = tokenManager.getToken();
      if (!token) return;

      if (getProviderId(input.provider) === PROVIDER_ID) {
        output.headers[HEADER_NAME] = HEADER_FORMAT.replace("{token}", token);
      }
    },
  };
};

export default NBCBProviderPlugin;
