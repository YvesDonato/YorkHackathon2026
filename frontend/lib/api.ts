export const FASTAPI_BASE_URL =
  process.env.NEXT_PUBLIC_FASTAPI_BASE_URL ?? "http://localhost:8000";

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

const buildUrl = (path: string, params: Record<string, string>): string => {
  const baseUrl = FASTAPI_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, `${baseUrl}/`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
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
  params: Record<string, string>,
): Promise<T> => {
  const response = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    const statusLabel = `${response.status} ${response.statusText}`.trim();
    throw new Error(detail ? `${statusLabel}: ${detail}` : statusLabel);
  }

  return (await response.json()) as T;
};

export const fetchGraph = (link: string): Promise<ApiGraphResponse> =>
  requestJson<ApiGraphResponse>("/graph", { link });

export const fetchPaper = (link: string): Promise<PaperResponse> =>
  requestJson<PaperResponse>("/paper", { link });
