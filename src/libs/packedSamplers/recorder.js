import PackedSampler from ".";
import * as Tone from "tone";

export default class RecorderSampler extends PackedSampler {
  constructor(urls, baseUrl, callback) {
    super();
    this.vibrato = new Tone.Vibrato(5, 0.1).toDestination();
    this.reverb = new Tone.Reverb({
      decay: 5,
      preDelay: 0.02,
      wet: 0.15,
    }).connect(this.vibrato);
    this.filter = new Tone.Filter(2000, "lowpass").connect(this.reverb);
    this.gain = new Tone.Gain(4).connect(this.filter);

    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => callback?.(),
    }).connect(this.gain);
  }

  dispose() {
    [this.sampler, this.gain, this.filter, this.reverb, this.vibrato].forEach(
      (node) => node.dispose(),
    );
  }
}
