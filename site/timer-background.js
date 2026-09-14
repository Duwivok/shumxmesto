// The transparent animated WebP covers the entire scene. A PNG poster remains
// available if the animation cannot be decoded.
class TimerScreenBackground {
  constructor(image) {
    this.image = image;
    this.active = false;

    this.handleError = () => {
      const poster = this.image.dataset.poster;
      if (!poster || this.image.getAttribute("src") === poster) {
        return;
      }
      this.image.dataset.state = "poster";
      this.image.src = poster;
    };

    image.addEventListener("error", this.handleError);
  }

  setActive(active) {
    this.active = active;
    if (!active && !this.image.hasAttribute("src")) {
      return;
    }

    const source = active ? this.image.dataset.src : this.image.dataset.poster;
    if (!source || this.image.getAttribute("src") === source) {
      return;
    }

    this.image.dataset.state = active ? "image" : "poster";
    this.image.src = source;
  }

  destroy() {
    this.active = false;
    this.image.removeEventListener("error", this.handleError);
  }
}

export function initTimerScreenBackground(image) {
  return image ? new TimerScreenBackground(image) : null;
}
