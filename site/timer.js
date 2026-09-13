import {
  loadDigitAsset,
  preloadDigitAssets,
} from "./assets-loader.js?v=20260913";
import { PerspectiveLayout } from "./perspective.js?v=20260913";

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
    if (Number.isNaN(this.target.getTime())) {
      throw new Error(`Некорректная дата таймера: ${config.targetLocalDateTime}`);
    }

    root.dataset.targetLocal = config.targetLocalDateTime;
    root.querySelectorAll("[data-timer-screen]").forEach((element) => {
      const name = element.dataset.timerScreen;
      this.screens.set(name, {
        element,
        value: "",
        digitImages: [...element.querySelectorAll("[data-timer-digit]")],
      });
    });

    this.perspective = new PerspectiveLayout(root.closest(".scene"), root);
    this.handleVisibilityChange = () => this.syncVisibility();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    this.updateCountdown();
    runWhenIdle(() => preloadDigitAssets());
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

      const image = screen.digitImages[position];
      const revision = Number(image.dataset.revision || 0) + 1;
      image.dataset.revision = String(revision);

      loadDigitAsset(image, Number(character))
        .then(() => {
          if (Number(image.dataset.revision) !== revision) {
            return;
          }

          const digitsReady = screen.digitImages.every(
            (digitImage) => digitImage.complete && digitImage.naturalWidth > 0,
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

  syncVisibility() {
    if (this.active && !document.hidden) {
      this.updateCountdown();
      this.scheduleUpdate();
      return;
    }

    window.clearTimeout(this.timeout);
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
  }
}

export function initCountdownTimer(root, config = COUNTDOWN_CONFIG) {
  return root ? new CountdownTimer(root, config) : null;
}
