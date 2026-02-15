import Link from "next/link";
import Image from "next/image";
import FeatureCards from "./components/FeatureCards";

const features = [
  {
    title: "Citation Network Mapping",
    description:
      "Load any arXiv paper and visualize how references connect across related research.",
  },
  {
    title: "Paper-Level Insights",
    description:
      "Inspect abstracts, metadata, and outbound relationships directly from each node.",
  },
  {
    title: "Interactive Exploration",
    description:
      "Zoom, pan, and inspect clusters to quickly understand a field's knowledge graph.",
  },
];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#1f1230_0%,#0a0a0a_40%,#050505_100%)] text-[var(--text-primary)]">
      <div className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#a855f7]/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-16 h-72 w-72 rounded-full bg-[#ec4899]/20 blur-3xl" />

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 overflow-hidden rounded-xl shadow-lg">
              <Image
                src="/prismarineLogo.png"
                alt="Prismarine logo"
                fill
                sizes="48px"
                className="object-contain p-0.5"
                priority
              />
            </div>
            <span className="text-sm font-semibold tracking-[0.08em] text-[var(--text-secondary)]">
              Prismarine
            </span>
          </div>

          <Link
            href="/login"
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-white"
          >
            Login
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-20 md:pb-24 md:pt-28">
        <section className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center rounded-full border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary-hover)]">
            Discover Research Connections Faster
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            Turn arXiv papers into
            <span className="block bg-gradient-to-r from-[#c084fc] to-[#f472b6] bg-clip-text text-transparent">
              interactive citation maps
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-[var(--text-secondary)] md:text-lg">
            Start from one paper and reveal the citation structure around it. Explore context, follow ideas,
            and understand research neighborhoods without manual digging.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex min-w-[180px] items-center justify-center rounded-lg bg-gradient-to-r from-[#a855f7] to-[#ec4899] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(168,85,247,0.45)]"
            >
              Get Started
            </Link>
            <Link
              href="/signup"
              className="inline-flex min-w-[180px] items-center justify-center rounded-lg border border-white/20 px-6 py-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-white"
            >
              Create Account
            </Link>
          </div>
        </section>

        <FeatureCards features={features} />
      </main>
    </div>
  );
}
