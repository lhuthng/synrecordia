export default class BaseFingeringResolver {
  getPattern() {
    throw new Error(
      `${this.constructor.name}.getPattern() must be implemented.`,
    );
  }
}
