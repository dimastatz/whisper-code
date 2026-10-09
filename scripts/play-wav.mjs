// Fake microphone for the end-to-end test: writes a 16 kHz mono s16le WAV's samples to stdout
// in real time, then silence until killed. Usage: node scripts/play-wav.mjs <file.wav>
import { readFileSync } from "node:fs";

const FRAME_BYTES = 2048; // 1024 samples, 64 ms
const wav = readFileSync(process.argv[2]);

// Find the "data" chunk; WAV headers vary in length.
let offset = 12;
while (offset + 8 <= wav.length && wav.toString("ascii", offset, offset + 4) !== "data") {
  offset += 8 + wav.readUInt32LE(offset + 4);
}
if (offset + 8 > wav.length) {
  console.error("no data chunk in", process.argv[2]);
  process.exit(1);
}
const pcm = wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4));

let position = 0;
setInterval(() => {
  const frame =
    position < pcm.length
      ? pcm.subarray(position, position + FRAME_BYTES)
      : Buffer.alloc(FRAME_BYTES);
  position += FRAME_BYTES;
  process.stdout.write(frame);
}, 64);
