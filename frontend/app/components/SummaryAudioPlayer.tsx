"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateSummaryAudio } from "@/lib/api";

type LanguageCode = "en" | "fr" | "es" | "hi" | "ar" | "ur";

type SummaryAudioPlayerProps = {
  summary: string;
};

const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "ur", label: "Urdu" },
];

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

export default function SummaryAudioPlayer({ summary }: SummaryAudioPlayerProps) {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canGenerate = useMemo(() => summary.trim().length > 0, [summary]);

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

    setIsGenerating(true);
    setError(null);

    try {
      const blob = await generateSummaryAudio({ summary, lang: language });
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
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Summary Narration</h3>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="summary-language" className="text-sm text-slate-700">
          Language
        </label>
        <select
          id="summary-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value as LanguageCode)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
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
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? "Generating..." : "Generate + Play"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-rose-700">{error}</p>
      ) : null}

      <audio ref={audioRef} controls className="w-full" src={audioUrl ?? undefined}>
        Your browser does not support audio playback.
      </audio>
    </section>
  );
}
