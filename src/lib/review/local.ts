/**
 * Local Review Provider
 *
 * Polls `prloom/.local/review.md` for review items.
 * See RFC: docs/rfc-review-providers.md
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type {
  ReviewProvider,
  ReviewProviderContext,
  ReviewItem,
  LocalReviewItem,
  LocalProviderState,
  ReviewLocalConfig,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const REVIEW_MD_PATH = "prloom/.local/review.md";
const DEFAULT_POLL_INTERVAL_MS = 2000;

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse review.md content and extract unchecked items from the ## ready section.
 */
export function parseReviewMd(content: string): LocalReviewItem[] {
  const items: LocalReviewItem[] = [];
  const lines = content.split("\n");

  // Find the ## ready section (case-insensitive)
  let inReadySection = false;
  let currentItem: Partial<LocalReviewItem> | null = null;
  let textLines: string[] = [];

  for (const line of lines) {
    // Check for section headers
    const headerMatch = line.match(/^##\s+(\w+)/i);
    if (headerMatch && headerMatch[1]) {
      // Save current item if valid before switching sections
      if (currentItem && inReadySection) {
        const finalItem = finalizeItem(currentItem, textLines);
        if (finalItem) items.push(finalItem);
      }
      currentItem = null;
      textLines = [];

      inReadySection = headerMatch[1].toLowerCase() === "ready";
      continue;
    }

    if (!inReadySection) continue;

    // Check for list item start
    const itemMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)/);
    if (itemMatch && itemMatch[1] && itemMatch[2]) {
      // Save previous item if valid
      if (currentItem) {
        const finalItem = finalizeItem(currentItem, textLines);
        if (finalItem) items.push(finalItem);
      }

      const isChecked = itemMatch[1].toLowerCase() === "x";
      // Skip checked items
      if (isChecked) {
        currentItem = null;
        textLines = [];
        continue;
      }

      currentItem = { checked: false };
      textLines = [itemMatch[2].trim()];
      continue;
    }

    // Check for metadata lines (indented)
    if (currentItem && line.match(/^\s+/)) {
      const trimmed = line.trim();

      const fileMatch = trimmed.match(/^file:\s*(.+)/i);
      if (fileMatch && fileMatch[1]) {
        currentItem.file = fileMatch[1].trim();
        continue;
      }

      const lineMatch = trimmed.match(/^line:\s*(\d+)/i);
      if (lineMatch && lineMatch[1]) {
        currentItem.line = parseInt(lineMatch[1], 10);
        continue;
      }

      const sideMatch = trimmed.match(/^side:\s*(left|right)/i);
      if (sideMatch && sideMatch[1]) {
        currentItem.side = sideMatch[1].toLowerCase() as "left" | "right";
        continue;
      }

      // Additional text lines (continuation of item body)
      if (trimmed && !trimmed.includes(":")) {
        textLines.push(trimmed);
      }
    }
  }

  // Don't forget the last item
  if (currentItem && inReadySection) {
    const finalItem = finalizeItem(currentItem, textLines);
    if (finalItem) items.push(finalItem);
  }

  return items;
}

function finalizeItem(
  partial: Partial<LocalReviewItem>,
  textLines: string[]
): LocalReviewItem | null {
  const text = textLines.join(" ").trim();

  // Require file and line (per RFC)
  if (!partial.file || partial.line === undefined || !text) {
    return null;
  }

  return {
    text,
    file: partial.file,
    line: partial.line,
    side: partial.side ?? "right", // Default to right per RFC
    checked: partial.checked ?? false,
  };
}

// =============================================================================
// Hashing
// =============================================================================

/**
 * Compute a stable hash for a review item.
 * Hash is based on: text + file + line + side (per RFC)
 */
export function computeItemHash(item: LocalReviewItem): string {
  const data = `${item.text}|${item.file}|${item.line}|${item.side}`;
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// =============================================================================
// Local Provider Implementation
// =============================================================================

export const localProvider: ReviewProvider = {
  name: "local",

  async poll(
    ctx: ReviewProviderContext,
    state: Record<string, unknown> | undefined
  ): Promise<{ items: ReviewItem[]; state: Record<string, unknown> }> {
    const providerState = (state as LocalProviderState) ?? {};
    const now = Date.now();

    // Check timing - respect poll interval
    const lastPollTime = providerState.lastPollTime ?? 0;
    const config = ctx.config as ReviewLocalConfig | undefined;
    const pollInterval = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    if (now - lastPollTime < pollInterval) {
      // Too soon, return empty
      return { items: [], state: providerState as Record<string, unknown> };
    }

    const reviewPath = join(ctx.worktree, REVIEW_MD_PATH);

    if (!existsSync(reviewPath)) {
      return {
        items: [],
        state: {
          lastPollTime: now,
          processedHashes: [],
        },
      };
    }

    const content = readFileSync(reviewPath, "utf-8");
    const localItems = parseReviewMd(content);

    // Get current hashes
    const currentHashes = new Set(localItems.map(computeItemHash));

    // Get previously processed hashes
    const processedHashes = new Set<string>(
      (providerState.processedHashes as string[]) ?? []
    );

    // Remove hashes that are no longer present (item was checked off or removed)
    for (const hash of processedHashes) {
      if (!currentHashes.has(hash)) {
        processedHashes.delete(hash);
      }
    }

    // Find new items (not in processed hashes)
    const newItems: ReviewItem[] = [];
    for (const item of localItems) {
      const hash = computeItemHash(item);
      if (!processedHashes.has(hash)) {
        newItems.push({
          id: hash,
          author: "local",
          body: item.text,
          createdAt: new Date().toISOString(),
          path: item.file,
          line: item.line,
          side: item.side,
        });
        processedHashes.add(hash);
      }
    }

    if (newItems.length > 0) {
      ctx.log.info(`Found ${newItems.length} new local review items`);
    }

    return {
      items: newItems,
      state: {
        lastPollTime: now,
        processedHashes: Array.from(processedHashes),
      },
    };
  },

  // Local provider does not post triage replies (per RFC)
  respond: undefined,
};

// =============================================================================
// Checkbox Update (Resolution Loop)
// =============================================================================

export interface CheckboxMatchCriteria {
  text: string;
  file: string;
  line: number;
  side: "left" | "right";
}

/**
 * Update a review.md checkbox from [ ] to [x] when a TODO completes.
 * Matches by text + file + line + side (per RFC).
 * Returns true if a match was found and updated.
 */
export function updateReviewMdCheckbox(
  worktree: string,
  criteria: CheckboxMatchCriteria
): boolean {
  const reviewPath = join(worktree, REVIEW_MD_PATH);

  if (!existsSync(reviewPath)) {
    return false;
  }

  const content = readFileSync(reviewPath, "utf-8");
  const lines = content.split("\n");

  let inReadySection = false;
  let foundMatch = false;
  let currentItemStartIndex = -1;
  let currentText = "";
  let currentFile = "";
  let currentLine: number | undefined;
  let currentSide = "right";

  for (let i = 0; i < lines.length; i++) {
    const currentLineText = lines[i]!;

    // Check for section headers
    const headerMatch = currentLineText.match(/^##\s+(\w+)/i);
    if (headerMatch && headerMatch[1]) {
      // Check if we had a pending match from previous section
      if (currentItemStartIndex >= 0 && inReadySection && currentLine !== undefined) {
        if (matchesCriteria(currentText, currentFile, currentLine, currentSide, criteria)) {
          lines[currentItemStartIndex] = lines[currentItemStartIndex]!.replace("- [ ]", "- [x]");
          foundMatch = true;
          break;
        }
      }
      currentItemStartIndex = -1;
      inReadySection = headerMatch[1].toLowerCase() === "ready";
      continue;
    }

    if (!inReadySection) continue;

    // Check for unchecked list item
    const itemMatch = currentLineText.match(/^-\s+\[ \]\s+(.+)/);
    if (itemMatch && itemMatch[1]) {
      // Check previous item if any
      if (currentItemStartIndex >= 0 && currentLine !== undefined) {
        if (matchesCriteria(currentText, currentFile, currentLine, currentSide, criteria)) {
          lines[currentItemStartIndex] = lines[currentItemStartIndex]!.replace("- [ ]", "- [x]");
          foundMatch = true;
          break;
        }
      }

      currentItemStartIndex = i;
      currentText = itemMatch[1].trim();
      currentFile = "";
      currentLine = undefined;
      currentSide = "right";
      continue;
    }

    // Skip checked items
    if (currentLineText.match(/^-\s+\[x\]/i)) {
      if (currentItemStartIndex >= 0 && currentLine !== undefined) {
        if (matchesCriteria(currentText, currentFile, currentLine, currentSide, criteria)) {
          lines[currentItemStartIndex] = lines[currentItemStartIndex]!.replace("- [ ]", "- [x]");
          foundMatch = true;
          break;
        }
      }
      currentItemStartIndex = -1;
      continue;
    }

    // Check for metadata lines
    if (currentItemStartIndex >= 0 && currentLineText.match(/^\s+/)) {
      const trimmed = currentLineText.trim();

      const fileMatch = trimmed.match(/^file:\s*(.+)/i);
      if (fileMatch && fileMatch[1]) {
        currentFile = fileMatch[1].trim();
        continue;
      }

      const lineMatch = trimmed.match(/^line:\s*(\d+)/i);
      if (lineMatch && lineMatch[1]) {
        currentLine = parseInt(lineMatch[1], 10);
        continue;
      }

      const sideMatch = trimmed.match(/^side:\s*(left|right)/i);
      if (sideMatch && sideMatch[1]) {
        currentSide = sideMatch[1].toLowerCase();
        continue;
      }

      // Continuation text
      if (trimmed && !trimmed.includes(":")) {
        currentText += " " + trimmed;
      }
    }
  }

  // Check the last item
  if (!foundMatch && currentItemStartIndex >= 0 && inReadySection && currentLine !== undefined) {
    if (matchesCriteria(currentText, currentFile, currentLine, currentSide, criteria)) {
      lines[currentItemStartIndex] = lines[currentItemStartIndex]!.replace("- [ ]", "- [x]");
      foundMatch = true;
    }
  }

  if (foundMatch) {
    writeFileSync(reviewPath, lines.join("\n"));
    return true;
  }

  return false;
}

function matchesCriteria(
  text: string,
  file: string,
  line: number | undefined,
  side: string,
  criteria: CheckboxMatchCriteria
): boolean {
  return (
    text.trim() === criteria.text.trim() &&
    file === criteria.file &&
    line === criteria.line &&
    side === criteria.side
  );
}

// =============================================================================
// Export
// =============================================================================

export default localProvider;
