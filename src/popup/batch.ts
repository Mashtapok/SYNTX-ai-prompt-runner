import { createBatchId, parseScenes } from "../shared/parser";
import type { StoredBatch } from "../shared/types";

export async function createBatchFromFile(file: File): Promise<StoredBatch> {
  const text = await file.text();
  const scenes = parseScenes(text);

  return {
    id: createBatchId(file.name, file.size, file.lastModified, text),
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sceneCount: scenes.length,
    scenes
  };
}
