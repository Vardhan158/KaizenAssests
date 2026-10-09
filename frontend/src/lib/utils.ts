import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateProductSKU(name?: string, existingCodes: string[] = []): string {
  const cleanName = (name || "").trim();
  let prefix = "PRD";

  if (cleanName) {
    const words = cleanName.split(/[\s_\-]+/).filter(Boolean);
    const firstWord = words[0];
    if (words.length >= 2) {
      prefix = words.slice(0, 3).map((w) => (w && w[0] ? w[0].toUpperCase() : "")).join("");
    } else if (firstWord) {
      prefix = firstWord.slice(0, 4).toUpperCase();
    }
    prefix = prefix.replace(/[^A-Z0-9]/g, "");
    if (!prefix) prefix = "PRD";
  }

  let seq = 1;
  let candidate = `FG-${prefix}-${String(seq).padStart(3, "0")}`;
  while (existingCodes.includes(candidate) && seq < 999) {
    seq++;
    candidate = `FG-${prefix}-${String(seq).padStart(3, "0")}`;
  }
  return candidate;
}

