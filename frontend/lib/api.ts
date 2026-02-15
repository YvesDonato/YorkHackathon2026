const LOCALHOST_HTTP_URL_PATTERN =
  /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?(\/|$)/i;

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

const parseErrorDetail = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
  } catch {
    // Ignore JSON parsing errors and fall back to status text.
  }

  return "";
};

const requestJson = async <T>(
  path: string,
  params: Record<string, string> = {},
  options: {
    method?: string;
    body?: unknown;
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
    throw new Error(detail ? `${statusLabel}: ${detail}` : statusLabel);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const fetchGraph = (link: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>("/graph", { link });

export const fetchPaper = (link: string): Promise<PaperResponse> =>
  requestJson<PaperResponse>("/paper", { link });

// Session API functions
export const createSession = (payload: SessionCreate): Promise<Session> =>
  requestJson<Session>("/sessions", {}, { method: "POST", body: payload });

export const listSessions = (): Promise<Session[]> =>
  requestJson<Session[]>("/sessions");

export const getSession = (sessionId: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>(`/sessions/${sessionId}`);

export const updateSession = (sessionId: string, payload: SessionUpdate): Promise<Session> =>
  requestJson<Session>(`/sessions/${sessionId}`, {}, { method: "PATCH", body: payload });

export const deleteSession = (sessionId: string): Promise<void> =>
  requestJson<void>(`/sessions/${sessionId}`, {}, { method: "DELETE" });

