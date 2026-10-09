// End-to-end test against a real whisper-flow server (spec 0002, TS-3). Streams a recorded WAV
// through the extension's dictation session (no VS Code needed) and checks the transcript.
// Usage: npm run compile && WHISPER_FLOW_URL=http://localhost:8181 node scripts/e2e.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DictationSession } = require("../out/dictation/session.js");

const serverUrl = process.env.WHISPER_FLOW_URL ?? "http://localhost:8181";
const wav = fileURLToPath(new URL("../test-fixtures/e2e/3081-166546-0000.wav", import.meta.url));
const player = fileURLToPath(new URL("./play-wav.mjs", import.meta.url));
const AUDIO_SECONDS = 10.5;
const REFERENCE =
  "when we took our seats at the breakfast table it was with the feeling of being no longer looked upon as connected in any way with this case";
/** Share of reference words that must appear; tiny.en's wording varies between runs. */
const MIN_RECALL = 0.7;

const partials = [];
const finals = [];
const states = [];
const errors = [];

const session = new DictationSession({
  serverUrl,
  apiKey: process.env.WHISPER_FLOW_API_KEY,
  model: undefined,
  prompt: "breakfast table",
  recorderCommands: [[process.execPath, player, wav]],
  sink: {
    partial: async (text) => void partials.push(text),
    final: async (text) => void finals.push(text),
    finish: async () => undefined,
  },
  onState: (state, error) => {
    states.push(state);
    if (error) {
      errors.push(error.message);
    }
  },
});

await session.start();
assert.deepEqual(errors, [], "session failed to start");
await new Promise((resolve) => setTimeout(resolve, (AUDIO_SECONDS + 2.5) * 1000));
await session.stop();

const transcript = finals.join(" ").replace(/\s+/g, " ").trim();
console.log(`partials: ${partials.length}, finals: ${finals.length}`);
console.log(`transcript: ${transcript}`);

assert.deepEqual(errors, []);
assert.deepEqual(states, ["connecting", "recording", "idle"]);
assert.ok(partials.length > 0, "no partial results");
const heard = new Set(
  transcript
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/),
);
const reference = REFERENCE.split(" ");
const recall = reference.filter((word) => heard.has(word)).length / reference.length;
console.log(`word recall: ${(recall * 100).toFixed(0)}%`);
assert.ok(recall >= MIN_RECALL, `word recall ${recall.toFixed(2)} below ${MIN_RECALL}`);

// The server drops the session just after closing the socket; give it a moment.
let active = -1;
for (let attempt = 0; attempt < 30 && active !== 0; attempt++) {
  active = (await (await fetch(new URL("/ready", serverUrl))).json()).active_sessions;
  if (active !== 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
assert.equal(active, 0, "session still open on the server");
console.log("E2E passed");
