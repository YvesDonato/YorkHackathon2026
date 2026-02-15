"use client";

import { motion } from "framer-motion";

const verbs = [
  { word: "Discover", icon: "🔍", description: "Find papers that matter" },
  { word: "Visualize", icon: "📊", description: "See connections clearly" },
  { word: "Explore", icon: "🌐", description: "Navigate research networks" },
  { word: "Inspect", icon: "🔎", description: "Dive into paper details" },
  { word: "Connect", icon: "🔗", description: "Link related works" },
  { word: "Analyze", icon: "📈", description: "Understand citations" },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

export default function ActionVerbs() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative"
    >
      <h3 className="text-lg font-bold text-white mb-6 tracking-wide">
        <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          What You Can Do
        </span>
      </h3>
      
      <div className="space-y-4">
        {verbs.map((verb, index) => (
          <motion.div
            key={verb.word}
            variants={itemVariants}
            whileHover={{ scale: 1.02, x: 8 }}
            className="group flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/10 backdrop-blur-sm transition-all duration-300 hover:bg-white/[0.06] hover:border-purple-500/30 cursor-default"
          >
            <motion.span
              className="text-2xl"
              whileHover={{ scale: 1.2, rotate: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              {verb.icon}
            </motion.span>
            
            <div className="flex-1">
              <motion.span
                className="text-lg font-semibold text-white group-hover:text-purple-300 transition-colors"
              >
                {verb.word}
              </motion.span>
              <p className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                {verb.description}
              </p>
            </div>

            <motion.div
              className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity"
              layoutId={`dot-${index}`}
            />
          </motion.div>
        ))}
      </div>

      <div className="mt-8 p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
        <p className="text-sm text-gray-300 italic">
          "Transform how you understand academic research through interactive visualization."
        </p>
      </div>
    </motion.div>
  );
}
