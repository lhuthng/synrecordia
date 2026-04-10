import GuitarSampler from "./guitar.js";
import BGuitar from "../../components/instruments/BGuitar.jsx";

export default class BGuitarSampler extends GuitarSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(urls, baseUrl, callback, { ...addition, name: "guitar" });
  }

  getPresentation() {
    return BGuitar;
  }
}
