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
    <section className="mt-8 grid gap-3 md:mt-10 md:grid-cols-3 lg:mt-6 lg:items-stretch">
      {features.map((feature) => (
        <motion.article
          key={feature.title}
          whileHover={prefersReducedMotion ? undefined : { scale: 1.04, y: -6 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm transition-colors duration-200 hover:z-10 hover:border-[var(--accent-primary)]/40 hover:bg-white/[0.05] hover:shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
          style={prefersReducedMotion ? undefined : { willChange: "transform" }}
        >
          <h2 className="text-base font-bold text-white lg:text-[15px]">{feature.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[13px]">
            {feature.description}
          </p>
        </motion.article>
      ))}
    </section>
  );
}
