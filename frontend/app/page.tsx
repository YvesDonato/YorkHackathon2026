import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] px-6 py-12">
      <section className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="relative mb-6 h-16 w-16">
          <Image
            src="/prismarinelogo.png"
            alt="Prismarine logo"
            fill
            sizes="64px"
            className="object-contain"
            priority
          />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Prismarine</h1>
        <p className="mt-4 max-w-xl text-base text-[var(--text-secondary)]">
          Explore arXiv papers as a citation network. Start with one paper and
          expand related research in a simple interactive graph.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex min-w-[150px] items-center justify-center rounded-md bg-[var(--accent-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-primary-hover)]"
          >
            Log In
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-w-[150px] items-center justify-center rounded-md border border-[var(--border-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)]"
          >
            Sign Up
          </Link>
        </div>
        <p className="mt-6 text-xs text-[var(--text-tertiary)]">
          No session required to view this page.
        </p>
      </section>
    </main>
  );
}
