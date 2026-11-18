import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CharacterGraphic } from "@/components/character-avatar";
import { renderNativeCharactersKotlin } from "../../scripts/gen-native-characters";
import {
  CHARACTER_DEFINITIONS,
  CHARACTER_IDS,
  CHARACTER_STATES,
  DEFAULT_CHARACTER_ID,
  deriveTurnCharacterState,
  getCharacterDefinition,
  getCharacterStatePose,
  isCharacterId,
  resolveCharacterState,
} from "./characters";

function srgbChannelLuminance(byte: number): number {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbChannelLuminance(r) + 0.7152 * srgbChannelLuminance(g) + 0.0722 * srgbChannelLuminance(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("AI character registry & production artwork", () => {
  it("defines the complete 7-character round-1 roster with D · Quill as the sole default", () => {
    expect(CHARACTER_IDS).toEqual(["quill", "foldie", "piko", "velo", "sora", "loop", "orbit"]);
    expect(DEFAULT_CHARACTER_ID).toBe("quill");
    expect(CHARACTER_DEFINITIONS.map((c) => c.id)).toEqual([...CHARACTER_IDS]);

    const defaults = CHARACTER_DEFINITIONS.filter((c) => c.isDefault);
    expect(defaults.map((c) => c.id)).toEqual(["quill"]);

    for (const id of CHARACTER_IDS) {
      expect(isCharacterId(id)).toBe(true);
      const def = getCharacterDefinition(id);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.bodyPaths.length).toBeGreaterThan(0);
      expect(def.eyes.length).toBeGreaterThanOrEqual(2);
      expect(def.accentPivot.x).toBeGreaterThan(0);
      expect(def.accentPivot.x).toBeLessThan(240);
      expect(def.accentPivot.y).toBeGreaterThan(0);
      expect(def.accentPivot.y).toBeLessThan(240);
      expect(def.motion.floatDurationMs).toBeGreaterThanOrEqual(3000);
      expect(def.motion.floatAmplitude).toBeGreaterThan(0);
      for (const layer of [...def.backAccentPaths, ...def.bodyPaths, ...def.frontAccentPaths]) {
        expect(layer.d).toMatch(/^M/);
      }
    }
    expect(isCharacterId("unknown")).toBe(false);
    expect(isCharacterId("")).toBe(false);
  });

  it("applies D · Quill's contrast fix so it reads clearly on cream #F7F6F2, white #FFFFFF, and dark ink #0F172A", () => {
    const quill = getCharacterDefinition("quill");
    const mainBodyFill = quill.bodyPaths[0]?.fill;
    const contourLayer = quill.bodyPaths.find((p) => p.stroke === "#0F172A");

    expect(mainBodyFill).toBeDefined();
    // Must not use cream #F7F6F2 or pure white #FFFFFF as its body fill.
    expect(mainBodyFill!.toUpperCase()).not.toBe("#F7F6F2");
    expect(mainBodyFill!.toUpperCase()).not.toBe("#FFFFFF");
    // Body luminance is noticeably deeper than cream #F7F6F2 while staying bright against #0F172A ink.
    expect(relativeLuminance("#F7F6F2") - relativeLuminance(mainBodyFill!)).toBeGreaterThan(0.2);
    expect(contrastRatio(mainBodyFill!, "#0F172A")).toBeGreaterThan(9);
    // Strengthened ink contour (up from 6.5) ensures crisp edge legibility on light backgrounds.
    expect(contourLayer).toBeDefined();
    expect(contourLayer!.strokeWidth).toBeGreaterThanOrEqual(8);
    // Eyes keep strong contrast against Quill's warm vellum body.
    for (const eye of quill.eyes) {
      expect(contrastRatio(mainBodyFill!, eye.fill)).toBeGreaterThan(9);
    }
  });

  it("supports all 7 semantic states across all 7 characters (49 combinations) in poses and SVG rendering", () => {
    expect(CHARACTER_STATES).toEqual([
      "idle",
      "typing",
      "thinking",
      "responding",
      "completed",
      "error",
      "hidden",
    ]);

    for (const id of CHARACTER_IDS) {
      const idlePose = getCharacterStatePose(id, "idle");
      const typingPose = getCharacterStatePose(id, "typing");
      const thinkingPose = getCharacterStatePose(id, "thinking");
      const respondingPose = getCharacterStatePose(id, "responding");
      const completedPose = getCharacterStatePose(id, "completed");
      const errorPose = getCharacterStatePose(id, "error");

      // Every active semantic state differs meaningfully from idle.
      expect(typingPose.gazeY).toBeGreaterThan(idlePose.gazeY);
      expect(thinkingPose.bodyTiltDeg).not.toBe(idlePose.bodyTiltDeg);
      expect(thinkingPose.gazeX).toBeGreaterThan(0);
      expect(respondingPose.bodyTiltDeg).not.toBe(idlePose.bodyTiltDeg);
      expect(completedPose.eyeScaleY).toBeLessThan(1);
      expect(errorPose.bodyOffsetY).toBeGreaterThan(0);

      for (const state of CHARACTER_STATES) {
        const pose = getCharacterStatePose(id, state);
        for (const value of Object.values(pose)) {
          expect(Number.isFinite(value)).toBe(true);
        }

        const heroSvg = renderToStaticMarkup(
          createElement(CharacterGraphic, { characterId: id, size: 64, state, hero: true, animated: true }),
        );
        expect(heroSvg).toContain(`data-character="${id}"`);
        expect(heroSvg).toContain(`data-state="${state}"`);
        expect(heroSvg).toContain(`data-animated="${state === "hidden" ? "false" : "true"}"`);
        expect(heroSvg).toContain('aria-hidden="true"');

        const compactSvg = renderToStaticMarkup(
          createElement(CharacterGraphic, { characterId: id, size: 20, state, hero: false, animated: false }),
        );
        expect(compactSvg).toContain(`data-character="${id}"`);
        expect(compactSvg).toContain('data-animated="false"');
      }
    }
  });

  it("keeps Android's generated Characters.kt in exact sync with src/lib/characters.ts", () => {
    const kotlinPath = path.resolve(
      import.meta.dirname,
      "../../mobile/android/app/src/main/java/com/kakumine/notefable/data/Characters.kt",
    );
    const actual = readFileSync(kotlinPath, "utf8").replace(/\r\n/g, "\n");
    expect(actual).toBe(renderNativeCharactersKotlin());
  });
});

describe("character semantic state machine", () => {
  it("enforces priority: hidden > error > responding > thinking > completed > typing > idle", () => {
    expect(resolveCharacterState({})).toBe("idle");
    expect(resolveCharacterState({ isTyping: true })).toBe("typing");
    expect(resolveCharacterState({ isTyping: true, isCompleted: true })).toBe("completed");
    expect(resolveCharacterState({ isTyping: true, isCompleted: true, isThinking: true })).toBe("thinking");
    expect(resolveCharacterState({ isTyping: true, isThinking: true, isResponding: true })).toBe("responding");
    // Error overrides responding, thinking, completed, and typing (e.g. 429 restored draft).
    expect(
      resolveCharacterState({
        isTyping: true,
        isCompleted: true,
        isThinking: true,
        isResponding: true,
        hasError: true,
      }),
    ).toBe("error");
    // Hidden short-circuits everything so background tabs/views stop animating.
    expect(
      resolveCharacterState({
        hidden: true,
        hasError: true,
        isResponding: true,
        isThinking: true,
        isTyping: true,
      }),
    ).toBe("hidden");
  });

  it("maps real turn lifecycle signals without lingering in thinking on stop/cancel", () => {
    // Idle -> Typing
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: false })).toBe("idle");
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: false, isTyping: true })).toBe("typing");

    // Sent, waiting for first token/image -> Thinking (overrides typing)
    expect(deriveTurnCharacterState({ isBusy: true, hasOutput: false, isTyping: true })).toBe("thinking");

    // Streaming tokens or proposals -> Responding (steady state regardless of how many chunks arrive)
    expect(deriveTurnCharacterState({ isBusy: true, hasOutput: true })).toBe("responding");

    // User clicks Stop -> immediately exits thinking/responding without lingering
    expect(deriveTurnCharacterState({ isBusy: true, isStopping: true, hasOutput: false })).toBe("idle");
    expect(deriveTurnCharacterState({ isBusy: true, isStopping: true, hasOutput: true, isTyping: true })).toBe("typing");

    // Stream finishes cleanly -> Completed confirmation, then back to Idle
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: true, outcome: "completed" })).toBe("completed");
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: true, outcome: null })).toBe("idle");

    // Request fails (e.g. 429 restores draft so isTyping is true) -> Error takes priority over Typing
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: false, outcome: "error", isTyping: true })).toBe("error");
  });
});
