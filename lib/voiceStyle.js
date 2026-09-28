export function buildVoiceStyle(character) {
  const pace = {
    slow: "천천히 여유 있게 말함.",
    normal: "보통 속도로 말함.",
    fast: "빠르고 경쾌하게 말함.",
  }[character?.pace];
  const clarity = {
    natural: "자연스럽고 편안하게 발음함.",
    clear: "한 글자씩 또렷하게 발음함.",
  }[character?.clarity];
  return [character?.style?.trim(), pace, clarity].filter(Boolean).join(" ");
}
