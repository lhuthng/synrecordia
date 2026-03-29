export default class PackedSampler {
  constructor(addition) {
    this.name = addition.name;
    this.alternatives = addition.alternatives.versions;
    this.version = addition.version;
  }

  async fetchSampler() {
    const baseUrl = `/samples/${this.name}/${this.version}/`;
    const urlsResponse = await fetch(`${baseUrl}index.json`);

    if (!urlsResponse.ok) return;

    return {
      urls: await urlsResponse.json(),
      baseUrl,
    };
  }

  getSampler() {
    return this.sampler;
  }

  getVersion() {
    return this.version;
  }

  async setVersion(version) {
    this.version = version;
  }

  getAlternatives() {
    return this.alternatives;
  }

  dispose() {
    throw new Error("Method 'dispose()' must be implemented.");
  }

  getPresentation() {
    throw new Error("Method 'getPresentation()' must be implemented.");
  }
}
