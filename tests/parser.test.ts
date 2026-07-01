import { describe, expect, it } from "vitest";
import { parseScenes } from "../src/shared/parser";

describe("parseScenes", () => {
  it("parses unknown scene counts", () => {
    const text = Array.from({ length: 127 }, (_, index) => `СЦЕНА ${index + 1} — ПРОМПТ:\nPrompt ${index + 1}`).join("\n");

    const scenes = parseScenes(text);

    expect(scenes).toHaveLength(127);
    expect(scenes[0]).toMatchObject({ index: 0, sceneNumber: 1, prompt: "Prompt 1" });
    expect(scenes[126]).toMatchObject({ index: 126, sceneNumber: 127, prompt: "Prompt 127" });
  });

  it("supports dash variants and inline prompts", () => {
    const scenes = parseScenes(
      [
        "СЦЕНА 1 — ПРОМПТ: first",
        "СЦЕНА 2 – ПРОМПТ: second",
        "СЦЕНА 3 - ПРОМПТ: third"
      ].join("\n")
    );

    expect(scenes.map((scene) => scene.prompt)).toEqual(["first", "second", "third"]);
  });

  it("keeps multiline prompt text until the next header", () => {
    const scenes = parseScenes("СЦЕНА 10 — ПРОМПТ:\nline one\nline two\n\nСЦЕНА 11 — ПРОМПТ:\nnext");

    expect(scenes[0].prompt).toBe("line one\nline two");
    expect(scenes[1].prompt).toBe("next");
  });

  it("allows an empty prompt", () => {
    const scenes = parseScenes("СЦЕНА 1 — ПРОМПТ:\n\nСЦЕНА 2 — ПРОМПТ: filled");

    expect(scenes[0].prompt).toBe("");
    expect(scenes[1].prompt).toBe("filled");
  });

  it("throws a human error when no scene headers are present", () => {
    expect(() => parseScenes("plain text")).toThrow("No scenes found in TXT.");
  });
});
