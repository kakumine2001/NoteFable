// NoteFable AI Character System — canonical registry, production vector art, and state machine.
// Android mirrors this registry via scripts/gen-native-characters.ts -> ui/CharacterArt.kt.

export const CHARACTER_IDS = [
  "quill",
  "foldie",
  "piko",
  "velo",
  "sora",
  "loop",
  "orbit",
] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export const DEFAULT_CHARACTER_ID: CharacterId = "quill";

export const CHARACTER_STATES = [
  "idle",
  "typing",
  "thinking",
  "responding",
  "completed",
  "error",
  "hidden",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export type CharacterLayerPath = {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "round" | "butt" | "square";
  strokeLinejoin?: "round" | "miter" | "bevel";
  fillRule?: "nonzero" | "evenodd";
};

export type CharacterEye =
  | {
      kind: "capsule";
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
      rotation?: number;
      cx: number;
      cy: number;
      fill: string;
    }
  | {
      kind: "path";
      d: string;
      cx: number;
      cy: number;
      fill: string;
    };

export type CharacterStatePose = {
  bodyOffsetY: number;
  bodyTiltDeg: number;
  bodyScale: number;
  accentDeg: number;
  gazeX: number;
  gazeY: number;
  eyeScaleY: number;
};

export type CharacterMotionProfile = {
  floatAmplitude: number;
  floatDurationMs: number;
  idleAccentDeg: number;
  idleBodyTiltDeg: number;
  typingTiltDeg: number;
  typingAccentDeg: number;
  typingGazeY: number;
  thinkingTiltDeg: number;
  thinkingAccentDeg: number;
  thinkingGazeX: number;
  respondingTiltDeg: number;
  respondingAccentDeg: number;
  completedNodY: number;
  completedAccentDeg: number;
  errorDropY: number;
  errorTiltDeg: number;
  errorAccentDeg: number;
};

export type CharacterDefinition = {
  id: CharacterId;
  name: string;
  isDefault?: boolean;
  accentPivot: { x: number; y: number };
  eyeCenter: { x: number; y: number };
  shadowRx: number;
  backAccentPaths: readonly CharacterLayerPath[];
  bodyPaths: readonly CharacterLayerPath[];
  frontAccentPaths: readonly CharacterLayerPath[];
  eyes: readonly CharacterEye[];
  motion: CharacterMotionProfile;
};

// Icon viewBox frames the 240x240 artwork tightly for 16px-28px touchpoints with headroom for subtle motion.
export const CHARACTER_ICON_VIEWBOX = "16 14 208 212";
// Hero viewBox (aspect 64:68 = 216:229.5) includes bounce headroom and the ground shadow at y=226.
export const CHARACTER_HERO_VIEWBOX = "12 10 216 229.5";

const INK = "#0F172A";
const CREAM = "#F7F6F2";
const ORANGE = "#E8612C";

export const CHARACTER_DEFINITIONS: readonly CharacterDefinition[] = [
  {
    // D · Quill (DEFAULT): Soft folded-page spirit.
    // Contrast fix applied: warm vellum #DCD2BE body + #C3B59B bottom curl shade + #EAE3D4 soft crown highlight
    // + strengthened 8.5px #0F172A contour so it reads clearly on #FFFFFF, cream #F7F6F2, and dark ink #0F172A.
    id: "quill",
    name: "Quill",
    isDefault: true,
    accentPivot: { x: 136, y: 94 },
    eyeCenter: { x: 120, y: 137 },
    shadowRx: 56,
    backAccentPaths: [],
    bodyPaths: [
      {
        d: "M82 42c18-2 36-1 52 2 24 14 43 35 52 58 2 24 3 46 1 65-2 17-15 29-32 31-27 3-56 2-82-3-16-3-29-11-35-23 7-3 12-10 14-21 3-24 5-52 8-81 2-16 10-26 22-28Z",
        fill: "#DCD2BE",
      },
      {
        d: "M66 56c14-10 34-12 58-9-22 4-38 14-45 31-5 13-8 34-10 62-4-25-5-53-3-84Z",
        fill: "#EAE3D4",
      },
      {
        d: "M41 174c14 6 33 10 56 12 28 2 56 1 82-5 4-1 7-3 9-6-4 13-16 22-33 24-27 3-56 2-82-3-15-3-26-10-32-22Z",
        fill: "#C3B59B",
      },
      {
        d: "M82 42c18-2 36-1 52 2 24 14 43 35 52 58 2 24 3 46 1 65-2 17-15 29-32 31-27 3-56 2-82-3-16-3-29-11-35-23 7-3 12-10 14-21 3-24 5-52 8-81 2-16 10-26 22-28Z",
        stroke: INK,
        strokeWidth: 8.5,
        strokeLinejoin: "round",
      },
    ],
    frontAccentPaths: [
      {
        d: "M134 44c0 22 4 39 15 49 10 9 25 12 43 9-8-24-29-45-58-58Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 8.5,
        strokeLinejoin: "round",
      },
    ],
    eyes: [
      { kind: "capsule", x: 93, y: 125, width: 13, height: 24, rx: 6.5, cx: 99.5, cy: 137, fill: INK },
      { kind: "capsule", x: 134, y: 125, width: 13, height: 24, rx: 6.5, cx: 140.5, cy: 137, fill: INK },
    ],
    motion: {
      floatAmplitude: 7.5,
      floatDurationMs: 4300,
      idleAccentDeg: -7,
      idleBodyTiltDeg: 0.8,
      typingTiltDeg: 2.2,
      typingAccentDeg: 5,
      typingGazeY: 8.5,
      thinkingTiltDeg: -3.2,
      thinkingAccentDeg: -11,
      thinkingGazeX: 6.5,
      respondingTiltDeg: 1.8,
      respondingAccentDeg: -5,
      completedNodY: 7,
      completedAccentDeg: 8,
      errorDropY: 5.5,
      errorTiltDeg: -2.5,
      errorAccentDeg: 11,
    },
  },
  {
    // A · Foldie: Deepened NoteFable folded-sheet character with perked dog-ear fold.
    id: "foldie",
    name: "Foldie",
    accentPivot: { x: 151, y: 88 },
    eyeCenter: { x: 119, y: 139 },
    shadowRx: 54,
    backAccentPaths: [],
    bodyPaths: [
      {
        d: "M80 42h52c3.9 0 7 3.1 7 7v37c0 8.8 7.2 16 16 16h25c3.9 0 7 3.1 7.3 7 1.8 22.8 2.4 45.2.7 64.5-1.5 16.4-14.6 28.5-31 29.5-24.6 1.5-49.4 1.5-74 0-16.4-1-29.5-13.1-31-29.5-2.1-23.4-1.2-55.6 2.8-98.8C56.4 55.6 65.8 42 80 42Z",
        fill: INK,
      },
    ],
    frontAccentPaths: [
      {
        d: "M151 40.5c0-4.3 5.2-6.4 8.2-3.3l42.3 42.3c3.1 3.1.9 8.3-3.4 8.3H161c-5.5 0-10-4.5-10-10V40.5Z",
        fill: INK,
      },
    ],
    eyes: [
      { kind: "capsule", x: 85, y: 124, width: 15, height: 30, rx: 7.5, cx: 92.5, cy: 139, fill: CREAM },
      { kind: "capsule", x: 138, y: 124, width: 15, height: 30, rx: 7.5, cx: 145.5, cy: 139, fill: CREAM },
    ],
    motion: {
      floatAmplitude: 7,
      floatDurationMs: 4200,
      idleAccentDeg: -10,
      idleBodyTiltDeg: 0,
      typingTiltDeg: 1.8,
      typingAccentDeg: 4,
      typingGazeY: 8.5,
      thinkingTiltDeg: -2.6,
      thinkingAccentDeg: -13,
      thinkingGazeX: 7,
      respondingTiltDeg: 1.4,
      respondingAccentDeg: -6,
      completedNodY: 6.5,
      completedAccentDeg: 9,
      errorDropY: 5,
      errorTiltDeg: -2,
      errorAccentDeg: 13,
    },
  },
  {
    // B · Piko: Lively bookmark / paper-strip companion with perky top ribbon loop and swallowtail base.
    id: "piko",
    name: "Piko",
    accentPivot: { x: 120, y: 52 },
    eyeCenter: { x: 121, y: 111 },
    shadowRx: 44,
    backAccentPaths: [
      {
        d: "M112 54C112 34 126 20 144 20c10 0 16 7 14 16-2 9-12 15-26 20Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
    ],
    bodyPaths: [
      {
        d: "M96 50h50c4.2 0 8.1 1.9 10.7 5.2l11.6 14.8c2.1 2.7 3.1 6.1 2.9 9.5-2.6 40.5-4.2 76.2-2.2 122.5.3 5.8-6.5 8.9-10.8 4.9L120 172l-38.2 34.9c-4.3 4-11.1.9-10.8-4.9 2-46.3 3.8-82 6.4-122.5.2-3.4 1.6-6.7 3.9-9.2l13.8-15.1c2.7-3 6.6-5.2 10.9-5.2Z",
        fill: "#1E4D3B",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M96 50h50c4.2 0 8.1 1.9 10.7 5.2l11.6 14.8H77.4l13.8-15.1c2.7-3 6.6-4.9 4.8-4.9Z",
        fill: "#EFECE4",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
    ],
    frontAccentPaths: [],
    eyes: [
      { kind: "capsule", x: 97, y: 98, width: 13.5, height: 26, rx: 6.75, rotation: 3, cx: 103.75, cy: 111, fill: CREAM },
      { kind: "capsule", x: 131, y: 98, width: 13.5, height: 26, rx: 6.75, rotation: 3, cx: 137.75, cy: 111, fill: CREAM },
    ],
    motion: {
      floatAmplitude: 8.5,
      floatDurationMs: 3800,
      idleAccentDeg: 9,
      idleBodyTiltDeg: 1.4,
      typingTiltDeg: 3,
      typingAccentDeg: -8,
      typingGazeY: 9,
      thinkingTiltDeg: -3.8,
      thinkingAccentDeg: 14,
      thinkingGazeX: 6.5,
      respondingTiltDeg: 2.2,
      respondingAccentDeg: 7,
      completedNodY: 8,
      completedAccentDeg: -10,
      errorDropY: 6,
      errorTiltDeg: -3,
      errorAccentDeg: -14,
    },
  },
  {
    // C · Velo: Avant-garde faceted origami gem with planar geometry and sharp fold creases.
    id: "velo",
    name: "Velo",
    accentPivot: { x: 145, y: 84 },
    eyeCenter: { x: 121, y: 116.5 },
    shadowRx: 52,
    backAccentPaths: [
      {
        d: "M112 60L152 22L178 106Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
      {
        d: "M152 22L210 100L178 106Z",
        fill: "#EFECE3",
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
    ],
    bodyPaths: [
      {
        d: "M72 36L112 60L64 116L30 112Z",
        fill: "#EFECE3",
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
      {
        d: "M30 112L64 116L120 180L120 214L66 174Z",
        fill: "#16294A",
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
      {
        d: "M178 106L210 100L174 172L120 214L120 180Z",
        fill: "#DFDAD0",
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
      {
        d: "M112 60L178 106L120 180L64 116Z",
        fill: INK,
        stroke: INK,
        strokeWidth: 7,
        strokeLinejoin: "round",
      },
    ],
    frontAccentPaths: [],
    eyes: [
      { kind: "path", d: "M96 102L108 105L105 131L93 128Z", cx: 100.5, cy: 116.5, fill: CREAM },
      { kind: "path", d: "M146 102L134 105L137 131L149 128Z", cx: 141.5, cy: 116.5, fill: CREAM },
    ],
    motion: {
      floatAmplitude: 6.5,
      floatDurationMs: 4500,
      idleAccentDeg: -5,
      idleBodyTiltDeg: 1,
      typingTiltDeg: 2.4,
      typingAccentDeg: 4,
      typingGazeY: 8,
      thinkingTiltDeg: -4,
      thinkingAccentDeg: -9,
      thinkingGazeX: 6.5,
      respondingTiltDeg: 2,
      respondingAccentDeg: -4.5,
      completedNodY: 6,
      completedAccentDeg: 6,
      errorDropY: 5.5,
      errorTiltDeg: -2.8,
      errorAccentDeg: 8,
    },
  },
  {
    // E · Sora (Fox / Sora): Folded-paper & open-book fox whose cheek ruffs form twin open book pages.
    id: "sora",
    name: "Sora",
    accentPivot: { x: 120, y: 112 },
    eyeCenter: { x: 120, y: 108 },
    shadowRx: 54,
    backAccentPaths: [],
    bodyPaths: [
      {
        d: "M46 136L120 196L194 136L202 152L120 208L38 152Z",
        fill: "#16294A",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
        strokeLinecap: "round",
      },
      {
        d: "M52 34L98 68Q120 62 142 68L188 34L202 132L120 176L38 132Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
        strokeLinecap: "round",
      },
      {
        d: "M38 132C68 122 98 132 120 154V196C88 184 58 164 38 132Z",
        fill: "#F2EEE5",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
        strokeLinecap: "round",
      },
      {
        d: "M202 132C172 122 142 132 120 154V196C152 184 182 164 202 132Z",
        fill: "#F2EEE5",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
        strokeLinecap: "round",
      },
      {
        d: "M108 148Q120 144 132 148L120 166Z",
        fill: INK,
      },
    ],
    frontAccentPaths: [
      {
        d: "M62 52L88 72L56 104Z",
        fill: INK,
        stroke: INK,
        strokeWidth: 6,
        strokeLinejoin: "round",
      },
      {
        d: "M178 52L152 72L184 104Z",
        fill: INK,
        stroke: INK,
        strokeWidth: 6,
        strokeLinejoin: "round",
      },
    ],
    eyes: [
      { kind: "capsule", x: 81, y: 96, width: 13.5, height: 24, rx: 6.75, rotation: -5, cx: 87.75, cy: 108, fill: INK },
      { kind: "capsule", x: 145.5, y: 96, width: 13.5, height: 24, rx: 6.75, rotation: 5, cx: 152.25, cy: 108, fill: INK },
    ],
    motion: {
      floatAmplitude: 7,
      floatDurationMs: 4100,
      idleAccentDeg: -3,
      idleBodyTiltDeg: 1.1,
      typingTiltDeg: 2.5,
      typingAccentDeg: 2.5,
      typingGazeY: 8,
      thinkingTiltDeg: -3.5,
      thinkingAccentDeg: -4,
      thinkingGazeX: 6.5,
      respondingTiltDeg: 1.8,
      respondingAccentDeg: -2.5,
      completedNodY: 7,
      completedAccentDeg: 3.5,
      errorDropY: 5.5,
      errorTiltDeg: -2.4,
      errorAccentDeg: 4,
    },
  },
  {
    // F · Loop: Continuous two-sided flowing Möbius ribbon in deep navy and warm orange.
    id: "loop",
    name: "Loop",
    accentPivot: { x: 121, y: 120 },
    eyeCenter: { x: 128, y: 53.5 },
    shadowRx: 58,
    backAccentPaths: [],
    bodyPaths: [
      {
        d: "M168 52L212 72C206 108 188 130 186 154C184 184 154 208 116 208C76 208 46 188 30 162L72 142C84 160 102 168 122 166C144 164 152 146 154 124C156 104 164 88 168 52Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M72 188L30 162C38 124 54 104 56 80C58 50 90 30 130 32C168 34 196 48 212 72L168 94C156 76 138 72 118 74C96 76 90 94 88 116C86 136 78 154 72 188Z",
        fill: "#13233F",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M140 162C148 158 152 146 154 126L186 154C184 184 154 208 116 208C76 208 46 188 30 162L72 142C84 160 102 168 122 166C129 165 135 164 140 162Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M148 130L183 142L183 162L135 161Z",
        fill: ORANGE,
      },
      {
        d: "M212 72C206 108 188 130 186 154M163 87C158 102 155 114 154 126",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinecap: "round",
      },
    ],
    frontAccentPaths: [],
    eyes: [
      { kind: "capsule", x: 108, y: 42, width: 12.5, height: 23, rx: 6.25, cx: 114.25, cy: 53.5, fill: CREAM },
      { kind: "capsule", x: 136, y: 42, width: 12.5, height: 23, rx: 6.25, cx: 142.25, cy: 53.5, fill: CREAM },
    ],
    motion: {
      floatAmplitude: 6.5,
      floatDurationMs: 4800,
      idleAccentDeg: 4,
      idleBodyTiltDeg: 2.2,
      typingTiltDeg: 3.2,
      typingAccentDeg: 0,
      typingGazeY: 7.5,
      thinkingTiltDeg: -5.5,
      thinkingAccentDeg: -6,
      thinkingGazeX: 6,
      respondingTiltDeg: 3.4,
      respondingAccentDeg: 4,
      completedNodY: 6.5,
      completedAccentDeg: 7,
      errorDropY: 6,
      errorTiltDeg: -4,
      errorAccentDeg: -6,
    },
  },
  {
    // G · Orbit: Forward-banked origami delta navigator with directional prow and visor face.
    id: "orbit",
    name: "Orbit",
    accentPivot: { x: 124, y: 88 },
    eyeCenter: { x: 121, y: 126.5 },
    shadowRx: 56,
    backAccentPaths: [
      {
        d: "M128 30L22 154L76 150L96 110Z",
        fill: "#EFECE3",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M128 30L216 170L162 156L148 116Z",
        fill: "#EFECE3",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
    ],
    bodyPaths: [
      {
        d: "M128 30L74 154L96 190L121 175Z",
        fill: "#16294A",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M128 30L164 160L142 194L121 175Z",
        fill: "#16294A",
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
      {
        d: "M101 86L147 90L154 152L121 178L86 148Z",
        fill: INK,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
    ],
    frontAccentPaths: [
      {
        d: "M128 30L101 86L147 90Z",
        fill: ORANGE,
        stroke: INK,
        strokeWidth: 7.5,
        strokeLinejoin: "round",
      },
    ],
    eyes: [
      { kind: "capsule", x: 101, y: 114, width: 12.5, height: 25, rx: 6.25, rotation: 4, cx: 107.25, cy: 126.5, fill: CREAM },
      { kind: "capsule", x: 129, y: 114, width: 12.5, height: 25, rx: 6.25, rotation: 4, cx: 135.25, cy: 126.5, fill: CREAM },
    ],
    motion: {
      floatAmplitude: 8,
      floatDurationMs: 3900,
      idleAccentDeg: -3,
      idleBodyTiltDeg: 1.8,
      typingTiltDeg: 3.2,
      typingAccentDeg: 3,
      typingGazeY: 8.5,
      thinkingTiltDeg: -4.5,
      thinkingAccentDeg: -6,
      thinkingGazeX: 7,
      respondingTiltDeg: 2.6,
      respondingAccentDeg: -3,
      completedNodY: 7,
      completedAccentDeg: 5,
      errorDropY: 6,
      errorTiltDeg: -3.5,
      errorAccentDeg: 6,
    },
  },
];

const CHARACTER_BY_ID: ReadonlyMap<CharacterId, CharacterDefinition> = new Map(
  CHARACTER_DEFINITIONS.map((character) => [character.id, character]),
);

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && CHARACTER_BY_ID.has(value as CharacterId);
}

export function getCharacterDefinition(id: CharacterId): CharacterDefinition {
  return CHARACTER_BY_ID.get(id) ?? CHARACTER_BY_ID.get(DEFAULT_CHARACTER_ID)!;
}

// ---- Semantic State Machine (priority: hidden > error > responding > thinking > completed > typing > idle) ----

export type CharacterStateInput = {
  hidden?: boolean;
  hasError?: boolean;
  isResponding?: boolean;
  isThinking?: boolean;
  isCompleted?: boolean;
  isTyping?: boolean;
};

export function resolveCharacterState(input: CharacterStateInput): CharacterState {
  if (input.hidden) return "hidden";
  if (input.hasError) return "error";
  if (input.isResponding) return "responding";
  if (input.isThinking) return "thinking";
  if (input.isCompleted) return "completed";
  if (input.isTyping) return "typing";
  return "idle";
}

export type CharacterTurnOutcome = "completed" | "error";

export function characterOutcomeDurationMs(kind: CharacterTurnOutcome): number {
  return kind === "completed" ? 650 : 950;
}

// Per-session transient outcome tracker so clearing or starting one chat never cancels another chat's outcome timer.
export function createSessionOutcomeStore(options: {
  onChange: (outcomes: Record<string, CharacterTurnOutcome>) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.clearTimer ?? ((id) => clearTimeout(id));
  const entries = new Map<string, { key: string; kind: CharacterTurnOutcome; timerId: ReturnType<typeof setTimeout> }>();

  const snapshot = (): Record<string, CharacterTurnOutcome> => {
    const next: Record<string, CharacterTurnOutcome> = {};
    for (const [key, entry] of entries) next[key] = entry.kind;
    return next;
  };

  return {
    flash(sessionKey: string, kind: CharacterTurnOutcome | null) {
      const existing = entries.get(sessionKey);
      if (existing) {
        cancel(existing.timerId);
        entries.delete(sessionKey);
      }
      if (!kind) {
        if (existing) options.onChange(snapshot());
        return;
      }
      const entry = {
        key: sessionKey,
        kind,
        timerId: null as unknown as ReturnType<typeof setTimeout>,
      };
      entry.timerId = schedule(() => {
        if (entries.get(entry.key) === entry) {
          entries.delete(entry.key);
          options.onChange(snapshot());
        }
      }, characterOutcomeDurationMs(kind));
      entries.set(sessionKey, entry);
      options.onChange(snapshot());
    },
    migrate(fromKey: string, toKey: string) {
      if (fromKey === toKey) return;
      const moved = entries.get(fromKey);
      if (!moved) return;
      entries.delete(fromKey);
      const targetExisting = entries.get(toKey);
      if (targetExisting) cancel(targetExisting.timerId);
      moved.key = toKey;
      entries.set(toKey, moved);
      options.onChange(snapshot());
    },
    dispose() {
      for (const entry of entries.values()) cancel(entry.timerId);
      entries.clear();
    },
  };
}

export type TurnOutputSignals = {
  isBusy: boolean;
  isStopping?: boolean;
  hasOutput: boolean;
  outcome?: CharacterTurnOutcome | null;
  isTyping?: boolean;
  hidden?: boolean;
};

// Maps real UI turn signals (chat composer/stream or note AI action) to the character state machine.
// Stopping/cancelling exits thinking/responding immediately without lingering.
export function deriveTurnCharacterState(signals: TurnOutputSignals): CharacterState {
  const active = signals.isBusy && !signals.isStopping;
  return resolveCharacterState({
    hidden: signals.hidden,
    hasError: signals.outcome === "error",
    isResponding: active && signals.hasOutput,
    isThinking: active && !signals.hasOutput,
    isCompleted: !active && signals.outcome === "completed",
    isTyping: signals.isTyping,
  });
}

// Deterministic resting/representative pose for each (character, state) pair.
// Used for reduced-motion posture cues and state-completeness verification.
export function getCharacterStatePose(id: CharacterId, state: CharacterState): CharacterStatePose {
  const { motion } = getCharacterDefinition(id);
  switch (state) {
    case "idle":
    case "hidden":
      return {
        bodyOffsetY: 0,
        bodyTiltDeg: 0,
        bodyScale: 1,
        accentDeg: 0,
        gazeX: 0,
        gazeY: 0,
        eyeScaleY: 1,
      };
    case "typing":
      return {
        bodyOffsetY: 1.5,
        bodyTiltDeg: motion.typingTiltDeg,
        bodyScale: 1,
        accentDeg: motion.typingAccentDeg,
        gazeX: 0,
        gazeY: motion.typingGazeY,
        eyeScaleY: 1,
      };
    case "thinking":
      return {
        bodyOffsetY: -2,
        bodyTiltDeg: motion.thinkingTiltDeg,
        bodyScale: 1,
        accentDeg: motion.thinkingAccentDeg,
        gazeX: motion.thinkingGazeX,
        gazeY: -2.5,
        eyeScaleY: 1,
      };
    case "responding":
      return {
        bodyOffsetY: -1,
        bodyTiltDeg: motion.respondingTiltDeg,
        bodyScale: 1.015,
        accentDeg: motion.respondingAccentDeg,
        gazeX: 0,
        gazeY: 1.5,
        eyeScaleY: 1,
      };
    case "completed":
      return {
        bodyOffsetY: motion.completedNodY * 0.4,
        bodyTiltDeg: 1.2,
        bodyScale: 1.02,
        accentDeg: motion.completedAccentDeg,
        gazeX: 0,
        gazeY: 0,
        eyeScaleY: 0.72,
      };
    case "error":
      return {
        bodyOffsetY: motion.errorDropY,
        bodyTiltDeg: motion.errorTiltDeg,
        bodyScale: 0.985,
        accentDeg: motion.errorAccentDeg,
        gazeX: 0,
        gazeY: 3.5,
        eyeScaleY: 0.82,
      };
  }
}
