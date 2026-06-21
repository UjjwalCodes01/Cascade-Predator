"use client";

import { useState } from "react";

interface CopyHelperProps {
  text: string;
  startLen?: number;
  endLen?: number;
}

export default function CopyHelper({ text, startLen = 8, endLen = 6 }: CopyHelperProps) {
  const [copied, setCopied] = useState(false);

  if (!text) return <span className="text-zinc-600">—</span>;

  const shortened =
    text.length > startLen + endLen
      ? `${text.slice(0, startLen)}...${text.slice(-endLen)}`
      : text;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1.5 group select-none">
      <span className="font-mono text-zinc-400 break-all">{shortened}</span>
      <button
        onClick={handleCopy}
        className="text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded transition-colors"
        title="Copy full proof"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
