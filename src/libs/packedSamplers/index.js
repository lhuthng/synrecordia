export default class PackedSampler {
  constructor() {
    if (new.target === PackedSampler) {
      throw new Error("PackedSampler is abstract and cannot be instantiated.");
    }

    this.sampler = null;
  }

  getSampler() {
    return this.sampler;
  }

  dispose() {
    throw new Error("Method 'dispose()' must be implemented by subclass.");
  }
}
