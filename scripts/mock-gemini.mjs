// A stand-in for the Gemini API, so the whole app can be exercised without
// spending any real quota:  node scripts/mock-gemini.mjs   (or npm run dev:mock)
//
// Point the app at it with GEMINI_API_BASE=http://localhost:4010/v1beta.
// Behaviour can be changed while it runs:
//   curl -X POST localhost:4010/__set -d '{"dailyLimit":5,"perMinute":3,"rejectConversations":true}'
//   curl localhost:4010/__stats
import http from "node:http";
import { synthesize, textsOfRequest, wavFromPcm } from "./synth-speech.mjs";

export const defaults = {
  dailyLimit: 100,          // after this many successful calls: 429 "requests per day"
  perMinute: 10,            // more than this many calls within 60 s: 429 with "retry in Ns"
  rejectConversations: false, // answer 400 to multi-speaker requests
  failEvery: 0,             // every Nth call: 503
  latencyMs: 150,
  weakPauseShare: 0.1,      // share of <long pause> tags the fake model "forgets" (pause of only 0.3 s)
};

// 24 kHz, 16-bit mono WAV with a quiet tone; ~0.05 s per input character.
// (Used for voice previews; speech requests get the more lifelike synth-speech.)
function makeWav(chars) {
  const samples = Math.max(2400, Math.round(chars * 0.05 * 24000));
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 12) * 2000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function startMockGemini({ port = 4010, quiet = false, ...overrides } = {}) {
  const config = { ...defaults, ...overrides };
  const stats = { calls: 0, ok: 0, refused: 0, recent: [] };
  const log = (...args) => { if (!quiet) console.log("[mock-gemini]", ...args); };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const url = new URL(req.url, "http://mock");

    if (url.pathname === "/__set") { Object.assign(config, body); return send(200, config); }
    if (url.pathname === "/__stats") return send(200, { ...stats, config });

    await new Promise((resolve) => setTimeout(resolve, config.latencyMs));

    if (url.pathname.endsWith("/interactions")) {
      stats.calls++;
      const now = Date.now();
      stats.recent = stats.recent.filter((at) => now - at < 60_000);
      const content = body.input?.[0]?.content ?? [];
      const chars = content.reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
      const conversation = body.generation_config?.speech_config?.mode === "conversational";

      let refusal = null;
      if (stats.ok >= config.dailyLimit) {
        refusal = [429, "You exceeded your current quota: generate_requests_per_day limit: 100. Please retry in 10h37m25s"];
      } else if (stats.recent.length >= config.perMinute) {
        refusal = [429, "Rate limit reached: generate_requests_per_minute. Please retry in 8.5s"];
      } else if (config.rejectConversations && conversation) {
        refusal = [400, "Invalid input received."];
      } else if (config.failEvery && stats.calls % config.failEvery === 0) {
        refusal = [503, "The model is overloaded."];
      }
      if (refusal) {
        stats.refused++;
        log(`#${stats.calls} ${chars} chars → ${refusal[0]} ${refusal[1].slice(0, 40)}`);
        return send(refusal[0], { error: { message: refusal[1] } });
      }
      stats.ok++;
      stats.recent.push(now);
      log(`#${stats.calls} ${chars} chars${conversation ? " (conversation)" : ""} → 200`);
      // Speech-like audio: a tone per line with sentence pauses and a pause
      // wherever the request has a <long pause> tag, so the app's cutting of
      // several lines out of one recording can be tried without real quota.
      const pcm = synthesize(textsOfRequest(body), { pause: () => (Math.random() < config.weakPauseShare ? 0.3 : 1.2 + Math.random() * 0.5) });
      return send(200, {
        steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: wavFromPcm(pcm).toString("base64") }] }],
      });
    }

    if (url.pathname.endsWith(":generateContent")) {
      const prompt = body.contents?.[0]?.parts?.[0]?.text ?? "";
      const original = prompt.split("원문:\n")[1] ?? prompt;
      return send(200, { candidates: [{ content: { parts: [{ text: original.replace(/"([^"]+)"/g, "손님: $1") }] } }] });
    }
    if (url.pathname.endsWith("/voices") && req.method === "GET") return send(200, { voices: [] });
    if (url.pathname.endsWith("/voices") && req.method === "POST") {
      return send(200, { voice: { id: `voice_mock_${Date.now()}` }, steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: makeWav(20).toString("base64") }] }] });
    }
    return send(404, { error: { message: `mock: no route for ${url.pathname}` } });
  });

  return new Promise((resolve) => server.listen(port, () => {
    log(`listening on http://localhost:${port}/v1beta`);
    resolve({ server, config, stats, close: () => server.close() });
  }));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("mock-gemini.mjs")) {
  await startMockGemini({ port: Number(process.env.MOCK_PORT) || 4010 });
}
