import { HumanError } from "./errors";
import type { Scene } from "./types";

const HEADER_RE = /^\s*(?:\uFEFF)?(?:СЦЕНА|SCENE)\s+(\d+)\s*[—–-]\s*(?:ПРОМПТ|PROMPT)\s*:\s*(.*)$/iu;

export function parseScenes(text: string): Scene[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const scenes: Scene[] = [];
  let current:
    | {
        sceneNumber: number;
        lines: string[];
      }
    | null = null;

  for (const line of lines) {
    const header = HEADER_RE.exec(line);

    if (header) {
      if (current) {
        scenes.push(toScene(scenes.length, current));
      }

      current = {
        sceneNumber: Number(header[1]),
        lines: [header[2] ?? ""]
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    scenes.push(toScene(scenes.length, current));
  }

  if (scenes.length === 0) {
    throw new HumanError("No scenes found in TXT.");
  }

  return scenes;
}

function toScene(index: number, current: { sceneNumber: number; lines: string[] }): Scene {
  return {
    index,
    sceneNumber: current.sceneNumber,
    prompt: trimPrompt(current.lines)
  };
}

function trimPrompt(lines: string[]): string {
  return lines.join("\n").trim();
}

export function createBatchId(fileName: string, size: number, lastModified: number, text: string): string {
  const source = `${fileName}:${size}:${lastModified}:${text.length}:${hashText(text)}`;
  return `batch-${hashText(source)}`;
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
