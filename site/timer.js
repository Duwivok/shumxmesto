import {
  loadDigitAsset,
  loadImageAsset,
} from "./assets-loader.js?v=20260914cold1";
import { PerspectiveLayout } from "./perspective.js?v=20260914spill1";
import { timerWord } from "./timer-words.js?v=20260914cold1";

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

async function decodedImage(request) {
  const image = await request;
  await image.decode?.();
  return image;
}

class CountdownTimer {
  constructor(root, config) {
    this.root = root;
    this.target = new Date(config.targetLocalDateTime);
    this.active = false;
    this.destroyed = false;
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
        requestedValue: null,
        revision: 0,
        digitImages: [...element.querySelectorAll("[data-timer-digit]")],
        wordImage: element.querySelector("[data-timer-word]"),
        word: null,
      });
    });

    this.perspective = new PerspectiveLayout(root.closest(".scene"), root);
    this.handleVisibilityChange = () => this.syncVisibility();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    this.updateCountdown();
  }

  updateScreen(name, value) {
    const screen = this.screens.get(name);
    const nextValue = twoDigits(value);

    if (!screen || screen.requestedValue === nextValue) {
      return screen?.pending;
    }

    screen.requestedValue = nextValue;
    const revision = ++screen.revision;
    const word = timerWord(name, value);
    // Decode replacements off the page. Publish the number and its word in
    // one DOM update so slow downloads cannot leave mismatched declensions.
    const digitRequests = [...nextValue].map((character, position) => {
      if (screen.value[position] === character) {
        return null;
      }

      const image = new Image();
      image.dataset.timerDigit = "";
      return decodedImage(loadDigitAsset(image, Number(character)));
    });

    let wordRequest = null;
    if (screen.word?.source !== word.source) {
      const image = new Image();
      image.className = "timer-word";
      image.dataset.timerWord = "";
      wordRequest = decodedImage(loadImageAsset(image, word.source));
    }

    screen.pending = Promise.all([...digitRequests, wordRequest])
      .then(([firstDigit, secondDigit, wordImage]) => {
        if (this.destroyed || screen.revision !== revision) {
          return;
        }

        [firstDigit, secondDigit].forEach((image, position) => {
          if (image) {
            screen.digitImages[position].replaceWith(image);
            screen.digitImages[position] = image;
          }
        });
        if (wordImage) {
          screen.wordImage.replaceWith(wordImage);
          screen.wordImage = wordImage;
        }
        screen.value = nextValue;
        screen.word = word;
        screen.element.setAttribute("aria-label", `${nextValue} ${word.text}`);
        screen.element.classList.add("is-ready");
        const labels = [...this.screens.values()]
          .filter((item) => item.word)
          .map((item) => `${item.value} ${item.word.text}`);
        this.root.setAttribute("aria-label", `До события: ${labels.join(", ")}`);
      })
      .catch((error) => {
        if (this.destroyed || screen.revision !== revision) {
          return;
        }
        // Keep the last complete number/word pair and allow the next update
        // to retry, instead of flashing an empty or partly loaded screen.
        screen.requestedValue = null;
        console.error(error);
      });
    return screen.pending;
  }

  updateCountdown() {
    const values = countdownParts(this.target.getTime());
    this.updateScreen("days", values.days);
    this.updateScreen("hours", values.hours);
    this.updateScreen("minutes", values.minutes);
    this.root.dataset.expired = String(values.expired);

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
    this.destroyed = true;
    window.clearTimeout(this.timeout);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.perspective.destroy();
  }
}

export function initCountdownTimer(root, config = COUNTDOWN_CONFIG) {
  return root ? new CountdownTimer(root, config) : null;
}
