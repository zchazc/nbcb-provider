/**
 * TokenManager - Manages token lifecycle: fetch, store, and auto-refresh.
 *
 * Reads configuration from environment variables:
 *   NBCB_TOKEN_URL            - URL to fetch tokens from (required for refresh)
 *   NBCB_TOKEN_METHOD         - HTTP method, "GET" or "POST" (default: "POST")
 *   NBCB_TOKEN_HEADERS        - JSON string of extra headers for token request
 *   NBCB_TOKEN_BODY           - JSON string body for POST token request
 *   NBCB_TOKEN_PATH           - Dot-path to extract token from response (default: "token")
 *                                e.g. "data.accessToken" for { data: { accessToken: "..." } }
 *   NBCB_TOKEN_REFRESH_SECS   - Refresh interval in seconds (default: 3600)
 */

interface TokenManagerConfig {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  tokenPath: string;
  refreshIntervalSecs: number;
}

/**
 * Extract a value from a nested object using a dot-notation path.
 * e.g. getByPath({ data: { accessToken: "abc" } }, "data.accessToken") -> "abc"
 */
function getByPath(obj: unknown, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      throw new Error(`Token path "${path}" not found in response`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "string") {
    throw new Error(`Token at path "${path}" is not a string, got: ${typeof current}`);
  }
  return current;
}

type LogFn = (msg: string) => Promise<unknown>;
type Logger = { info: LogFn; warn: LogFn; error: LogFn };

export class TokenManager {
  private config: TokenManagerConfig | null = null;
  private token: string = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private fetching = false;
  private log: Logger;

  constructor(log: Logger) {
    this.log = log;

    const url = process.env.NBCB_TOKEN_URL ?? "";
    if (!url) {
      this.log.warn("NBCB_TOKEN_URL not set, token refresh disabled");
      return;
    }

    let headers: Record<string, string> = {};
    const rawHeaders = process.env.NBCB_TOKEN_HEADERS;
    if (rawHeaders) {
      try {
        headers = JSON.parse(rawHeaders);
      } catch {
        this.log.error("NBCB_TOKEN_HEADERS is not valid JSON, ignoring");
      }
    }

    this.config = {
      url,
      method: (process.env.NBCB_TOKEN_METHOD?.toUpperCase() as "GET" | "POST") ?? "POST",
      headers,
      body: process.env.NBCB_TOKEN_BODY,
      tokenPath: process.env.NBCB_TOKEN_PATH ?? "token",
      refreshIntervalSecs: parseInt(process.env.NBCB_TOKEN_REFRESH_SECS ?? "3600", 10),
    };
  }

  /** Whether token refresh is enabled (i.e. NBCB_TOKEN_URL was provided) */
  get enabled(): boolean {
    return this.config !== null;
  }

  /** Get the current token value */
  getToken(): string {
    return this.token;
  }

  /** Fetch a new token from the configured URL */
  async refreshToken(): Promise<void> {
    if (!this.config) return;
    if (this.fetching) return;
    this.fetching = true;

    try {
      const init: RequestInit = {
        method: this.config.method,
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
      };

      if (this.config.method === "POST" && this.config.body) {
        init.body = this.config.body;
      }

      const response = await fetch(this.config.url, init);

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.token = getByPath(data, this.config.tokenPath);
      this.log.info("Token refreshed successfully");
    } catch (err) {
      this.log.error(`Failed to refresh token: ${err}`);
    } finally {
      this.fetching = false;
    }
  }

  /** Start periodic token refresh */
  async start(): Promise<void> {
    if (!this.config) return;

    await this.refreshToken();

    const intervalMs = this.config.refreshIntervalSecs * 1000;
    this.timer = setInterval(() => {
      this.refreshToken().catch((err) => {
        this.log.error(`Periodic token refresh error: ${err}`);
      });
    }, intervalMs);

    this.log.info(`Token refresh scheduled every ${this.config.refreshIntervalSecs}s`);
  }

  /** Stop periodic refresh */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
