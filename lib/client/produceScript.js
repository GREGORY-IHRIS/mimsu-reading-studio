import { planPieces } from "../shared/scriptPlan.js";
import { cutClipIntoLines, joinWavClips } from "./audioBlob.js";

// Gets audio for every line of a script, round after round.
//
// Round 1 plays the cheapest plan (see planPieces). Calls that read several
// lines at once come back as ONE recording; it is cut apart at the pauses, and
// only the lines whose boundaries are unmistakable are kept. The others stay
// "pending" and go into the next round's plan, which is again the cheapest way
// for just those lines. After MAX_CUT_ROUNDS rounds — or as soon as cutting
// clearly does not work for this script — the rest is read in plain script
// order, which needs no cutting and therefore always succeeds. So a line is
// never guessed at: it is either cut with certainty or asked for again.

const MAX_CUT_ROUNDS = 3;
// When the recordings cut so far (at least MIN_EVIDENCE lines) gave back less
// than this share of their lines, cutting is not working for this script:
// stop spending calls on it and read the rest in plain order.
const MIN_YIELD = 0.4;
const MIN_EVIDENCE = 8;

// `runRound(plan, fresh, onClip)` sends the plan's calls (see runSpeechJob) and
// calls `onClip(clip, call)` after each; it may answer "stop" to skip the rest.
// `fresh`: signatures already asked for in an earlier round (ask again, do not
// take the cached answer).
export async function produceScript({
  pieces,
  runRound,
  cutClip = cutClipIntoLines,
  joinClips = joinWavClips,
  onRound = () => {},
}) {
  const segments = new Map(); // first piece index → { last, blob }
  const covered = new Set();
  const asked = new Set();
  const summary = { rounds: 0, calls: 0, cutCalls: 0, cutLines: 0, resolvedLines: 0, fellBackToSequence: false };
  let sequenceOnly = false;

  const keep = (first, last, blob) => {
    segments.set(first, { last, blob });
    for (let i = first; i <= last; i++) covered.add(i);
  };

  for (let round = 1; ; round++) {
    const pending = pieces.filter((piece) => !covered.has(piece.index));
    if (!pending.length) break;

    const mustBeSequence = sequenceOnly || round > MAX_CUT_ROUNDS;
    const plan = planPieces(pending, { mode: mustBeSequence ? "sequence" : "auto" });
    const fresh = new Set(plan.calls.map((call) => call.signature).filter((signature) => asked.has(signature)));
    for (const call of plan.calls) asked.add(call.signature);
    summary.rounds = round;
    summary.calls += plan.calls.length;
    onRound({ round, plan, pending: pending.length });

    const onClip = async (clip, call) => {
      if (!call.cut) {
        keep(call.pieceIndices[0], call.pieceIndices.at(-1), clip);
        return undefined;
      }
      const { parts, resolved } = await cutClip(clip, call.cut.lines);
      call.cut.lines.forEach((line, n) => {
        if (parts[n]) keep(line.pieceIndex, line.pieceIndex, parts[n]);
      });
      summary.cutCalls++;
      summary.cutLines += call.cut.lines.length;
      summary.resolvedLines += resolved;
      if (summary.cutLines >= MIN_EVIDENCE && summary.resolvedLines < MIN_YIELD * summary.cutLines) {
        sequenceOnly = true;
        summary.fellBackToSequence = true;
        return "stop";
      }
      return undefined;
    };

    try {
      await runRound(plan, fresh, onClip);
    } catch (error) {
      // Gemini refused a two-voice request: read the rest in plain order.
      if (error.code === "REJECTED" && plan.mode !== "sequence") {
        sequenceOnly = true;
        summary.fellBackToSequence = true;
        continue;
      }
      throw error;
    }
  }

  const blobs = [];
  let next = 0;
  for (const first of [...segments.keys()].sort((a, b) => a - b)) {
    if (first !== next) throw new Error("일부 대사의 음성이 빠졌어요. 다시 시도해주세요.");
    const { last, blob } = segments.get(first);
    blobs.push(blob);
    next = last + 1;
  }
  if (next !== pieces.length) throw new Error("일부 대사의 음성이 빠졌어요. 다시 시도해주세요.");

  return { audio: await joinClips(blobs), summary };
}
