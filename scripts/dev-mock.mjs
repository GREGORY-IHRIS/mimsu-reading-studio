// Runs the app against the fake Gemini server (scripts/mock-gemini.mjs) with
// throw-away data and a test login, so nothing touches the real API key, the
// real quota or real family data:
//
//   npm run dev:mock        then open http://localhost:3100
//
// Sign in without Google by pasting the printed cookie value in the browser
// console:  document.cookie = "next-auth.session-token=<value>; path=/"
import { spawn } from "node:child_process";
import { encode } from "next-auth/jwt";
import { startMockGemini } from "./mock-gemini.mjs";

const APP_PORT = 3100;
const MOCK_PORT = 4010;
const SECRET = "mock-secret-not-for-production";
const EMAIL = "tester@example.com";

const mock = await startMockGemini({ port: MOCK_PORT, ...JSON.parse(process.env.MOCK_OPTIONS || "{}") });
const token = await encode({ token: { email: EMAIL, name: "테스터" }, secret: SECRET });
console.log(`\n[dev-mock] app      http://localhost:${APP_PORT}`);
console.log(`[dev-mock] mock API http://localhost:${MOCK_PORT}  (tweak: POST /__set, stats: GET /__stats)`);
console.log(`[dev-mock] login    document.cookie = "next-auth.session-token=${token}; path=/"\n`);

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXTAUTH_SECRET: SECRET,
    NEXTAUTH_URL: `http://localhost:${APP_PORT}`,
    ALLOWED_EMAILS: EMAIL,
    GEMINI_API_KEY: "mock-key",
    GEMINI_API_BASE: `http://localhost:${MOCK_PORT}/v1beta`,
    BLOB_READ_WRITE_TOKEN: "",
    DATA_DIR: ".data-mock",
  },
});
next.on("exit", (code) => { mock.close(); process.exit(code ?? 0); });
process.on("SIGINT", () => next.kill("SIGINT"));
