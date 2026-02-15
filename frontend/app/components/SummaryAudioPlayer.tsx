"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateSummaryAudio } from "@/lib/api";

type LanguageCode = "en" | "fr" | "es" | "hi";

type SummaryAudioPlayerProps = {
  summary: string;
  variant?: "light" | "dark";
};

const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "hi", label: "Hindi" },
];

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

export default function SummaryAudioPlayer({ summary, variant = "light" }: SummaryAudioPlayerProps) {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canGenerate = useMemo(() => summary.trim().length > 0, [summary]);
  const isDark = variant === "dark";

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const handleGenerateAndPlay = async () => {
    if (!canGenerate) {
      setError("Summary is empty.");
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setAudioUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return null;
    });

    setIsGenerating(true);
    setError(null);

    try {
      const blob = await generateSummaryAudio(summary, language);
      const nextAudioUrl = URL.createObjectURL(blob);

      setAudioUrl((previousUrl) => {
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return nextAudioUrl;
      });

      window.requestAnimationFrame(() => {
        if (audioRef.current) {
          void audioRef.current.play();
        }
      });
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section
      className={`w-full space-y-3 rounded-xl border p-4 ${
        isDark
          ? "border-[var(--border-secondary)] bg-[var(--bg-secondary)]/40"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <h3 className={`text-sm font-semibold ${isDark ? "text-[var(--text-primary)]" : "text-slate-900"}`}>
        Audio Summary
      </h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto,1fr,auto] sm:items-center">
        <label
          htmlFor="summary-language"
          className={`text-xs font-medium ${isDark ? "text-[var(--text-secondary)]" : "text-slate-700"}`}
        >
          Language
        </label>
        <select
          id="summary-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value as LanguageCode)}
          className={`rounded-lg border px-2.5 py-2 text-sm focus:outline-none ${
            isDark
              ? "border-[var(--border-primary)] bg-[var(--bg-primary)]/60 text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
              : "border-slate-300 bg-white text-slate-900 focus:border-slate-500"
          }`}
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void handleGenerateAndPlay()}
          disabled={isGenerating || !canGenerate}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${
            isDark
              ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50"
              : "bg-slate-900 text-white hover:bg-slate-700"
          }`}
        >
          {isGenerating ? "Generating..." : "Generate + Play"}
        </button>
      </div>

      {!canGenerate ? (
        <p className={`text-sm ${isDark ? "text-[var(--text-tertiary)]" : "text-slate-600"}`}>
          Summary is not available yet, so audio can&apos;t be generated.
        </p>
      ) : null}

      {error ? (
        <p className={`text-sm ${isDark ? "text-rose-300" : "text-rose-700"}`}>{error}</p>
      ) : null}

      {audioUrl ? (
        <audio ref={audioRef} controls className="summary-audio-control w-full" src={audioUrl}>
          Your browser does not support audio playback.
        </audio>
      ) : null}
    </section>
  );
}
