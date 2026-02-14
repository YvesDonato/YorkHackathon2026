"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchPaper, type PaperReference, type PaperResponse } from "@/lib/api";

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getReferenceUrl = (reference: PaperReference): string | null =>
  reference.url ??
  reference.arxiv_url ??
  reference.doi_url ??
  reference.semantic_scholar_url ??
  null;

export default function NodePage() {
  const params = useParams<{ id: string | string[] }>();

  const nodeId = useMemo(() => {
    const rawId = params?.id;
    const encodedId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!encodedId) {
      return "";
    }

    return decodeURIComponent(encodedId);
  }, [params]);

  const [paper, setPaper] = useState<PaperResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setPaper(null);
      setError("Missing node id.");
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadPaper = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchPaper(nodeId);
        if (!cancelled) {
          setPaper(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setPaper(null);
          setError(formatError(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPaper();

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Node Paper Details</h1>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Back to Graph
          </Link>
        </div>

        <p className="mb-6 text-sm text-slate-600">
          Node ID: <code>{nodeId || "(missing)"}</code>
        </p>

        {isLoading ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Loading paper details...
          </p>
        ) : null}

        {!isLoading && error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!isLoading && !error && paper ? (
          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-900">{paper.title}</h2>

              <div className="flex flex-wrap gap-2 text-xs">
                {paper.published ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    Published: {paper.published}
                  </span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                  Authors: {paper.authors.length}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                  References: {paper.references.length}
                </span>
              </div>

              {paper.url ? (
                <a
                  href={paper.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
                >
                  Open paper source
                </a>
              ) : null}

              <p className="text-sm leading-7 text-slate-700">
                {paper.summary || "No summary provided."}
              </p>
            </section>

            <section>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">References</h3>

              {paper.references.length === 0 ? (
                <p className="text-sm text-slate-600">No references available.</p>
              ) : (
                <ul className="space-y-3">
                  {paper.references.map((reference, index) => {
                    const href = getReferenceUrl(reference);
                    const title = reference.title || "Untitled reference";
                    const key = `${href ?? title}-${index}`;

                    return (
                      <li
                        key={key}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <p className="text-sm font-medium text-slate-900">{title}</p>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
                          >
                            Open reference source
                          </a>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">
                            No outbound URL available.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
