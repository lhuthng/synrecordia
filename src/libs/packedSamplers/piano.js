import PackedSampler from ".";
import * as Tone from "tone";

export default class PianoSampler extends PackedSampler {
  constructor(urls, baseUrl, callback) {
    super();
    this.reverb = new Tone.Reverb({
      decay: 5,
      preDelay: 0.02,
      wet: 0.15,
    }).toDestination();
    this.gain = new Tone.Gain(0.4).connect(this.reverb);

    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => callback?.(),
    }).connect(this.gain);
  }

  dispose() {
    [this.sampler, this.gain, this.reverb].forEach((node) => node.dispose());
  }
}
