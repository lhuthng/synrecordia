const generateMidiMap = () => {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const map = {};
  for (let i = 0; i < 128; i++) {
    const note = names[i % 12];
    const octave = Math.floor(i / 12) - 1;
    map[`${note}${octave}`] = i;
  }
  return map;
};

export const NOTE_TO_MIDI = generateMidiMap();

export const getHighestNote = (notes) => {
  if (Array.isArray(notes)) {
    return notes.reduce((best, current) => {
      return NOTE_TO_MIDI[current] > NOTE_TO_MIDI[best] ? current : best;
    }, notes[0]);
  }
  return notes;
};

export const getBeatsPerBar = (timeSignature) => {
  if (!timeSignature || typeof timeSignature !== "string") return 4;
  const [numeratorText, denominatorText] = timeSignature.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);

  if (!numerator || !denominator) return 4;

  return numerator * (4 / denominator);
};
