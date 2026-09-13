// One transparent, already projected movie covers the entire scene.
// The supplied PNG poster keeps the same appearance if playback is unavailable.
class TimerScreenBackground {
  constructor(video) {
    this.video = video;
    this.active = false;
    this.started = false;
    this.failed = false;
    video.muted = true;

    this.handleLoadedData = () => {
      try {
        // The top-left pixel is outside all three screens. Verify actual
        // decoded alpha before accepting a decoder that could paint it black.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
        if (context.getImageData(0, 0, 1, 1).data[3] !== 0) {
          throw new Error("The video decoder does not preserve transparency");
        }
        video.dataset.state = "video";
      } catch (error) {
        this.showPoster(error);
      }
    };
    this.handleError = () => this.showPoster(
      new Error(video.error?.message || "Could not load the screen background video"),
    );
    this.handleVisibilityChange = () => this.syncPlayback();
    video.addEventListener("loadeddata", this.handleLoadedData);
    video.addEventListener("error", this.handleError);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  showPoster(error) {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.dataset.state = "poster";
    console.warn("Using the transparent screen background poster", error);
  }

  syncPlayback() {
    if (this.failed || !this.started) {
      return;
    }
    if (!this.active || document.hidden) {
      this.video.pause();
      return;
    }
    this.video.play()?.catch((error) => {
      if (error.name !== "AbortError" && this.active && !document.hidden) {
        this.showPoster(error);
      }
    });
  }

  setActive(active) {
    this.active = active;
    if (active && !this.started && !this.failed) {
      this.started = true;
      this.video.src = this.video.dataset.src;
      this.video.load();
    }
    this.syncPlayback();
  }

  destroy() {
    this.active = false;
    this.video.pause();
    this.video.removeEventListener("loadeddata", this.handleLoadedData);
    this.video.removeEventListener("error", this.handleError);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }
}

export function initTimerScreenBackground(video) {
  return video ? new TimerScreenBackground(video) : null;
}
