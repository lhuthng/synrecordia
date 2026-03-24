const defaultFluteOptions = [
  "pianissimo",
  "piano",
  "mezzo-piano",
  "mezzo-forte",
  "forte",
];

const defaultPianoOptions = Array.from({ length: 16 }, (_, index) => {
  return `v${index + 1}`;
});

export default function InstrumentControls({
  fluteDynamic = "mezzo-forte",
  pianoVersion = "v8",
  fluteOptions = defaultFluteOptions,
  pianoOptions = defaultPianoOptions,
  onFluteChange,
  onPianoChange,
}) {
  return (
    <div className="text-main flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="flute-dynamic" className="text-sm font-semibold">
          Flute dynamic
        </label>
        <select
          id="flute-dynamic"
          value={fluteDynamic}
          onChange={(event) => onFluteChange?.(event.target.value)}
        >
          {fluteOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="piano-version" className="text-sm font-semibold">
          Piano version
        </label>
        <select
          id="piano-version"
          value={pianoVersion}
          onChange={(event) => onPianoChange?.(event.target.value)}
        >
          {pianoOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
