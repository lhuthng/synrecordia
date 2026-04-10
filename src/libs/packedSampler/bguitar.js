import GuitarSampler from "./guitar.js";
import Guitar from "../../components/instruments/Guitar.jsx";

export default class BGuitarSampler extends GuitarSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(urls, baseUrl, callback, { ...addition, name: "guitar" });
  }

  getPresentation() {
    return Guitar;
  }
}
