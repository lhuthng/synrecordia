import GuitarSampler from "../guitar/GuitarSampler.js";
import BGuitarComponent from "./BGuitarComponent.jsx";

export default class BGuitarSampler extends GuitarSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(urls, baseUrl, callback, { ...addition, name: "guitar" });
  }

  getPresentation() {
    return BGuitarComponent;
  }
}
