const LOCALHOST_HTTP_URL_PATTERN =
  /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?(\/|$)/i;
const AUTH_REDIRECT_PATH = "/";
const USER_GEMINI_API_KEY_STORAGE_KEY = "prismarine_user_gemini_api_key";
const GEMINI_API_KEY_HEADER = "X-Gemini-Api-Key";
let hasTriggeredUnauthorizedRedirect = false;

export const GEMINI_QUOTA_EXHAUSTED_CODE = "GEMINI_QUOTA_EXHAUSTED";
export const GEMINI_API_KEY_INVALID_CODE = "GEMINI_API_KEY_INVALID";
export const GEMINI_API_KEY_MISSING_CODE = "GEMINI_API_KEY_MISSING";

const getFastApiBaseUrl = (): string => {
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_FASTAPI_BASE_URL ?? "/api").trim();
  if (!configuredBaseUrl) {
    return "/api";
  }

  // Guard against accidental production deployments that still embed localhost.
  if (typeof window !== "undefined") {
    const browserHost = window.location.hostname.toLowerCase();
    const isBrowserLocalhost = browserHost === "localhost" || browserHost === "127.0.0.1";
    if (LOCALHOST_HTTP_URL_PATTERN.test(configuredBaseUrl) && !isBrowserLocalhost) {
      return "/api";
    }
  }

  return configuredBaseUrl;
};

export const FASTAPI_BASE_URL = getFastApiBaseUrl();

export class ApiError extends Error {
  status: number;
  code?: string;
  retryable?: boolean;

  constructor(message: string, options: { status: number; code?: string; retryable?: boolean }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export const getUserGeminiApiKey = (): string | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_GEMINI_API_KEY_STORAGE_KEY);
  if (!raw) return null;
  const normalized = raw.trim();
  return normalized || null;
};

export const setUserGeminiApiKey = (apiKey: string): void => {
  if (typeof window === "undefined") return;
  const normalized = apiKey.trim();
  if (!normalized) {
    localStorage.removeItem(USER_GEMINI_API_KEY_STORAGE_KEY);
    return;
  }
  localStorage.setItem(USER_GEMINI_API_KEY_STORAGE_KEY, normalized);
};

export const clearUserGeminiApiKey = (): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(USER_GEMINI_API_KEY_STORAGE_KEY);
};

const handleUnauthorizedSession = (): void => {
  if (typeof window === "undefined") return;

  localStorage.removeItem("access_token");
  localStorage.removeItem("user");

  if (hasTriggeredUnauthorizedRedirect) return;
  hasTriggeredUnauthorizedRedirect = true;

  if (window.location.pathname !== AUTH_REDIRECT_PATH) {
    window.location.replace(AUTH_REDIRECT_PATH);
  }
};

export type ApiGraphNode = {
  id: string;
  label: string;
  content: string;
  url?: string | null;
  published?: string | null;
  authors: string[];
  summary: string;
  is_root: boolean;
};

export type ApiGraphLink = {
  source: string;
  target: string;
  similarity?: number;
};

export type ApiGraphResponse = {
  seed_id: string;
  nodes: ApiGraphNode[];
  links: ApiGraphLink[];
};

export type PaperReference = {
  title: string;
  url?: string;
  published?: string;
  authors?: string[];
  summary?: string;
  arxiv_url?: string;
  doi_url?: string;
  semantic_scholar_url?: string;
};

export type PaperResponse = {
  title: string;
  url: string;
  published: string;
  authors: string[];
  summary: string;
  references: PaperReference[];
  references_error?: string;
};

// Session types
export type Session = {
  id: string;
  user_id: string;
  title: string | null;
  seed_paper_id: string;
  mode: string;
  created_at: string;
  last_accessed: string;
};

export type SessionCreate = {
  seed_paper_link: string;
  mode?: string;
  title?: string | null;
};

export type SessionUpdate = {
  title?: string | null;
};

const buildUrl = (path: string, params: Record<string, string>): string => {
  const baseUrl = getFastApiBaseUrl().replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  if (/^https?:\/\//i.test(baseUrl)) {
    const url = new URL(normalizedPath, `${baseUrl}/`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  const prefix = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  const queryString = new URLSearchParams(params).toString();
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  const resolvedPath = `${normalizedPrefix}/${normalizedPath}`;

  return queryString ? `${resolvedPath}?${queryString}` : resolvedPath;
};

const parseErrorDetail = async (
  response: Response,
): Promise<{ message: string; code?: string; retryable?: boolean }> => {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      const message = payload.detail.trim();
      if (message) {
        return { message };
      }
    }
    if (payload.detail && typeof payload.detail === "object") {
      const detailRecord = payload.detail as Record<string, unknown>;
      const message =
        typeof detailRecord.message === "string" && detailRecord.message.trim()
          ? detailRecord.message.trim()
          : "";
      const code =
        typeof detailRecord.code === "string" && detailRecord.code.trim()
          ? detailRecord.code.trim()
          : undefined;
      const retryable =
        typeof detailRecord.retryable === "boolean" ? detailRecord.retryable : undefined;

      if (message || code || retryable !== undefined) {
        return { message, code, retryable };
      }
    }
  } catch {
    // Ignore JSON parsing errors and fall back to status text.
  }

  return { message: "" };
};

const requestJson = async <T>(
  path: string,
  params: Record<string, string> = {},
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    includeGeminiApiKey?: boolean;
  } = {},
): Promise<T> => {
  const headers: Record<string, string> = { Accept: "application/json" };

  // Add Authorization header if token is available
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  if (options.includeGeminiApiKey) {
    const userGeminiApiKey = getUserGeminiApiKey();
    if (userGeminiApiKey) {
      headers[GEMINI_API_KEY_HEADER] = userGeminiApiKey;
    }
  }

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const fetchOptions: RequestInit = {
    method: options.method || "GET",
    headers,
    cache: "no-store",
  };

  // Add body for POST/PATCH/PUT requests
  if (options.body && ["POST", "PATCH", "PUT"].includes(fetchOptions.method || "")) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path, params), fetchOptions);

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    const statusLabel = `${response.status} ${response.statusText}`.trim();
    if (response.status === 401 && detail.code !== GEMINI_API_KEY_INVALID_CODE) {
      handleUnauthorizedSession();
    }
    const errorMessage = detail.message ? `${statusLabel}: ${detail.message}` : statusLabel;
    throw new ApiError(errorMessage, {
      status: response.status,
      code: detail.code,
      retryable: detail.retryable,
    });
  }

  hasTriggeredUnauthorizedRedirect = false;

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const fetchGraph = (link: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>("/graph", { link }, { includeGeminiApiKey: true });

export const fetchPaper = (link: string): Promise<PaperResponse> =>
  requestJson<PaperResponse>("/paper", { link });

// Session API functions
export const createSession = (payload: SessionCreate): Promise<Session> =>
  requestJson<Session>("/sessions", {}, {
    method: "POST",
    body: payload,
    includeGeminiApiKey: true,
  });

export const listSessions = (): Promise<Session[]> =>
  requestJson<Session[]>("/sessions");

export const getSession = (sessionId: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>(`/sessions/${sessionId}`);

export const updateSession = (sessionId: string, payload: SessionUpdate): Promise<Session> =>
  requestJson<Session>(`/sessions/${sessionId}`, {}, { method: "PATCH", body: payload });

export const deleteSession = (sessionId: string): Promise<void> =>
  requestJson<void>(`/sessions/${sessionId}`, {}, { method: "DELETE" });

export const expandSessionNode = (sessionId: string, nodeId: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>(
    `/sessions/${sessionId}/expand/${nodeId}`,
    {},
    { method: "POST", includeGeminiApiKey: true },
  );



export type SummaryAudioRequest = {
  summary: string;
  lang: "en" | "fr" | "es" | "hi";
};

export const generateSummaryAudio = async (
  summary: string,
  lang: SummaryAudioRequest["lang"],
): Promise<Blob> => {
  const response = await fetch(buildUrl("/api/audio/generate", {}), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ summary, lang }),
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    const statusLabel = `${response.status} ${response.statusText}`.trim();
    const errorMessage = detail.message ? `${statusLabel}: ${detail.message}` : statusLabel;
    throw new ApiError(errorMessage, {
      status: response.status,
      code: detail.code,
      retryable: detail.retryable,
    });
  }
  return response.blob();
};
