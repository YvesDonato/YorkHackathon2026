import Link from "next/link";
import Image from "next/image";
import FeatureCards from "./components/FeatureCards";
import LandingNodeBackground from "./components/LandingNodeBackground";

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
    <div className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,#1f1230_0%,#0a0a0a_40%,#050505_100%)] text-[var(--text-primary)] lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <LandingNodeBackground />
      <div className="landing-orb pointer-events-none absolute -left-24 top-20 h-72 w-72 bg-[#a855f7]/25 blur-3xl" />
      <div className="landing-orb landing-orb-delay pointer-events-none absolute -right-24 bottom-16 h-72 w-72 bg-[#ec4899]/20 blur-3xl" />

      <header className="relative z-10 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 overflow-hidden shadow-lg">
              <Image
                src="/prismarinelogo.png"
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
            className="inline-flex items-center justify-center border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium !text-[var(--text-secondary)] no-underline transition duration-300 hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 hover:!text-white hover:no-underline"
          >
            Login
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-12 pt-12 md:pb-14 md:pt-16 lg:flex lg:flex-1 lg:flex-col lg:justify-between lg:pb-8 lg:pt-8">
        <section className="mx-auto max-w-3xl text-center animate-fade-in">
          <p className="mb-3 inline-flex items-center border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary-hover)] animate-slide-down">
            Discover Research Connections Faster
          </p>
          <h1 className="animate-slide-up text-4xl font-black leading-tight md:text-5xl lg:text-5xl">
            Turn Research papers into
            <span className="block bg-gradient-to-r from-[#c084fc] to-[#f472b6] bg-clip-text text-transparent">
              interactive citation maps
            </span>
          </h1>
          <p className="animate-slide-up mx-auto mt-4 max-w-2xl text-base text-[var(--text-secondary)] md:text-base" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
            Start from one paper and reveal the citation structure around it. Explore context, follow ideas,
            and understand research neighborhoods without manual digging.
          </p>

          <div className="animate-slide-up mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row lg:mt-5" style={{ animationDelay: "220ms", animationFillMode: "both" }}>
            <Link
              href="/login"
              className="cta-shine inline-flex min-w-[180px] items-center justify-center bg-gradient-to-r from-[#a855f7] to-[#ec4899] px-6 py-3 text-sm font-semibold !text-white no-underline shadow-lg transition duration-300 hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(168,85,247,0.45)] hover:no-underline"
            >
              Get Started
            </Link>
            <Link
              href="/signup"
              className="inline-flex min-w-[180px] items-center justify-center border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold !text-[var(--text-secondary)] no-underline transition duration-300 hover:border-[var(--accent-primary)] hover:!text-white hover:no-underline"
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
