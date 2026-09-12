import {
  loadDigitAsset,
  loadGlowAsset,
  playVideo,
  preloadDigitAssets,
} from "./assets-loader.js";
import { PerspectiveLayout } from "./perspective.js";

export const COUNTDOWN_CONFIG = Object.freeze({
  // No timezone suffix means device-local time. Change this one value when the
  // final event date is known.
  targetLocalDateTime: "2026-09-19T23:59:00",
});

const TIME = Object.freeze({ minute: 60_000, dayInMinutes: 1440, hourInMinutes: 60 });

function countdownParts(targetTime, now = Date.now()) {
  const remainingMilliseconds = Math.max(0, targetTime - now);
  const totalMinutes = Math.ceil(remainingMilliseconds / TIME.minute);
  const days = Math.floor(totalMinutes / TIME.dayInMinutes);
  const minutesAfterDays = totalMinutes % TIME.dayInMinutes;

  return {
    days: Math.min(days, 99),
    hours: Math.floor(minutesAfterDays / TIME.hourInMinutes),
    minutes: minutesAfterDays % TIME.hourInMinutes,
    expired: remainingMilliseconds === 0,
  };
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function runWhenIdle(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 2000 });
  } else {
    window.setTimeout(callback, 0);
  }
}

class CountdownTimer {
  constructor(root, config) {
    this.root = root;
    this.target = new Date(config.targetLocalDateTime);
    this.active = false;
    this.timeout = 0;
    this.screens = new Map();
    this.videos = [...root.querySelectorAll("video")];

    if (Number.isNaN(this.target.getTime())) {
      throw new Error(`Некорректная дата таймера: ${config.targetLocalDateTime}`);
    }

    root.dataset.targetLocal = config.targetLocalDateTime;
    root.querySelectorAll("[data-timer-screen]").forEach((element, index) => {
      const name = element.dataset.timerScreen;
      this.screens.set(name, {
        element,
        index,
        value: "",
        digitVideos: [...element.querySelectorAll("[data-timer-digit]")],
        glowVideo: element.querySelector("[data-timer-glow]"),
      });
    });

    this.perspective = new PerspectiveLayout(root.closest(".scene"), root);
    this.handleVisibilityChange = () => this.syncVisibility();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    this.loadGlowLayers();
    this.updateCountdown();
    runWhenIdle(() => preloadDigitAssets());
  }

  loadGlowLayers() {
    this.screens.forEach((screen) => {
      if (!screen.glowVideo) {
        return;
      }

      loadGlowAsset(screen.glowVideo)
        .then((video) => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = (screen.index * 1.37) % video.duration;
          }

          if (video.seeking) {
            video.addEventListener("seeked", () => this.syncVideo(video), { once: true });
          } else {
            this.syncVideo(video);
          }
        })
        .catch((error) => console.error(error));
    });
  }

  updateScreen(name, value) {
    const screen = this.screens.get(name);
    const nextValue = twoDigits(value);

    if (!screen || screen.value === nextValue) {
      return;
    }

    [...nextValue].forEach((character, position) => {
      if (screen.value[position] === character) {
        return;
      }

      const video = screen.digitVideos[position];
      const revision = Number(video.dataset.revision || 0) + 1;
      video.dataset.revision = String(revision);

      loadDigitAsset(video, Number(character))
        .then(() => {
          if (Number(video.dataset.revision) !== revision) {
            return;
          }

          this.syncVideo(video);
          const digitsReady = screen.digitVideos.every(
            (digitVideo) => digitVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
          );

          if (digitsReady) {
            screen.element.classList.add("is-ready");
          }
        })
        .catch((error) => console.error(error));
    });

    screen.value = nextValue;
    screen.element.setAttribute("aria-label", `${name.toUpperCase()}: ${nextValue}`);
  }

  updateCountdown() {
    const values = countdownParts(this.target.getTime());
    this.updateScreen("days", values.days);
    this.updateScreen("hours", values.hours);
    this.updateScreen("minutes", values.minutes);
    this.root.dataset.expired = String(values.expired);
    this.root.setAttribute(
      "aria-label",
      `До события: ${twoDigits(values.days)} дней, ${twoDigits(values.hours)} часов, ${twoDigits(values.minutes)} минут`,
    );

    return values;
  }

  scheduleUpdate() {
    window.clearTimeout(this.timeout);

    if (!this.active || document.hidden) {
      return;
    }

    const now = Date.now();
    const remaining = this.target.getTime() - now;

    if (remaining <= 0) {
      return;
    }

    const nextMinuteBoundary = TIME.minute - (now % TIME.minute) + 32;
    const delay = Math.max(50, Math.min(nextMinuteBoundary, remaining + 32));
    this.timeout = window.setTimeout(() => {
      this.updateCountdown();
      this.scheduleUpdate();
    }, delay);
  }

  syncVideo(video) {
    if (this.active && !document.hidden) {
      playVideo(video);
    } else {
      video.pause();
    }
  }

  syncVisibility() {
    if (this.active && !document.hidden) {
      this.updateCountdown();
      this.videos.forEach(playVideo);
      this.scheduleUpdate();
      return;
    }

    window.clearTimeout(this.timeout);
    this.videos.forEach((video) => video.pause());
  }

  setActive(active) {
    if (this.active === active) {
      if (active) {
        this.updateCountdown();
      }
      return;
    }

    this.active = active;
    this.syncVisibility();
  }

  destroy() {
    window.clearTimeout(this.timeout);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.perspective.destroy();
    this.videos.forEach((video) => video.pause());
  }
}

export function initCountdownTimer(root, config = COUNTDOWN_CONFIG) {
  return root ? new CountdownTimer(root, config) : null;
}
