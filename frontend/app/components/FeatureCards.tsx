"use client";

import { motion, useReducedMotion } from "framer-motion";

type Feature = {
  title: string;
  description: string;
};

type FeatureCardsProps = {
  features: Feature[];
};

export default function FeatureCards({ features }: FeatureCardsProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="mt-16 grid gap-4 md:mt-20 md:grid-cols-3">
      {features.map((feature) => (
        <motion.article
          key={feature.title}
          whileHover={prefersReducedMotion ? undefined : { scale: 1.04, y: -6 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm transition-colors duration-200 hover:z-10 hover:border-[var(--accent-primary)]/40 hover:bg-white/[0.05] hover:shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
          style={prefersReducedMotion ? undefined : { willChange: "transform" }}
        >
          <h2 className="text-lg font-bold text-white">{feature.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
            {feature.description}
          </p>
        </motion.article>
      ))}
    </section>
  );
}
