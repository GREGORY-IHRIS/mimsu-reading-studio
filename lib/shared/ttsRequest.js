import { TTS_MODEL } from "./config.js";

// The exact JSON body sent to Gemini for one group of turns. The browser also
// uses it as the clip-cache identity, so two groups are treated as "the same
// audio" precisely when they would send the same request.

function buildSingleSpeaker(turns) {
  const { voice, style } = turns[0];
  return {
    model: TTS_MODEL,
    input: [{
      type: "user_input",
      content: [{
        type: "text",
        text: turns.map((turn) => turn.text).join("\n\n"),
        annotations: style ? [{ type: "speech_metadata", style }] : [],
      }],
    }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  };
}

function buildConversation(turns, speakers) {
  return {
    model: TTS_MODEL,
    input: [{
      type: "user_input",
      content: turns.map((turn) => ({
        type: "text",
        text: turn.text,
        annotations: [{
          type: "speech_metadata",
          speaker: turn.speaker,
          ...(turn.style ? { style: turn.style } : {}),
        }],
      })),
    }],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: {
        mode: "conversational",
        speakers: speakers.map(([speaker, voice]) => ({ speaker, voice })),
      },
    },
  };
}

export function buildTtsRequest(turns) {
  const speakers = [...new Map(turns.map((turn) => [turn.speaker, turn.voice]))];
  return speakers.length === 1 ? buildSingleSpeaker(turns) : buildConversation(turns, speakers);
}

export function requestSignature(turns) {
  return JSON.stringify(buildTtsRequest(turns));
}
