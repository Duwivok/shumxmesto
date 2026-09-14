import { initCountdownTimer } from "./timer.js?v=20260914cold1";
import { initTimerScreenBackground } from "./timer-background.js?v=20260913background1";
import { initNavigation } from "./navigation.js?v=20260914carousel1";

const PAGES = new Set(["home", "lineup", "bar", "rsvp", "geo"]);

const app = document.querySelector("[data-app]");
const backgrounds = [...document.querySelectorAll("[data-background]")];
const navigation = initNavigation(document.querySelector("[data-navigation]"), (page) => showPage(page));
const timerGlow = document.querySelector("[data-timer-glow]");
const timerGlowImage = document.querySelector("[data-timer-glow-image]");
const timerGlowVideo = document.querySelector("[data-timer-glow-video]");
const cigaretteButton = document.querySelector("[data-cigarette]");
const cigarettePoster = document.querySelector("[data-cigarette-poster]");
const cigaretteIdleImage = document.querySelector("[data-cigarette-idle]");
const cigaretteImage = document.querySelector("[data-cigarette-image]");
const cigaretteVideo = document.querySelector("[data-cigarette-video]");
const timerBackgroundVideo = document.querySelector("[data-timer-background-video]");
let countdownTimer = null;
const timerScreenBackground = initTimerScreenBackground(timerBackgroundVideo);
let timerGlowInitialized = false;
let pageRequestId = 0;
let cigarettePlaybackId = 0;
let cigaretteResetTimer = 0;
let cigaretteIdleLoopTimer = 0;
let cigaretteHasBeenPressed = false;
let cigaretteIdleIntroHasStarted = false;

const CIGARETTE_ANIMATION_DURATION = 4000;
const CIGARETTE_IDLE_INTRO_DURATION = 2300;

function isAppleMobileDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const cigaretteAnimationFormat = isAppleMobileDevice() ? "image" : "video";
cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;

function finishCigaretteAnimation() {
  window.clearTimeout(cigaretteResetTimer);
  cigaretteImage.onload = null;
  cigaretteImage.onerror = null;
  cigaretteButton.classList.add("is-playing");
}

function stopCigaretteIdle({ discard = false } = {}) {
  window.clearTimeout(cigaretteIdleLoopTimer);
  cigaretteIdleLoopTimer = 0;
  cigaretteIdleImage.onload = null;
  cigaretteIdleImage.onerror = null;
  cigaretteButton.classList.remove("is-idle");

  if (discard) {
    cigaretteIdleImage.removeAttribute("src");
  }
}

function startCigaretteIdleLoop() {
  if (cigaretteHasBeenPressed || app.dataset.page !== "rsvp") {
    return;
  }

  cigaretteIdleImage.onload = () => {
    cigaretteIdleImage.onload = null;

    if (!cigaretteHasBeenPressed && app.dataset.page === "rsvp") {
      cigaretteButton.classList.add("is-idle");
    }
  };
  cigaretteIdleImage.onerror = () => stopCigaretteIdle({ discard: true });
  cigaretteIdleImage.src = cigaretteIdleImage.dataset.loopSrc;
}

function startCigaretteIdle() {
  if (
    cigaretteHasBeenPressed
    || cigaretteButton.classList.contains("is-playing")
    || cigaretteIdleImage.hasAttribute("src")
  ) {
    return;
  }

  const showIntro = !cigaretteIdleIntroHasStarted;
  cigaretteIdleIntroHasStarted = true;

  cigaretteIdleImage.onload = () => {
    cigaretteIdleImage.onload = null;

    if (!cigaretteHasBeenPressed && app.dataset.page === "rsvp") {
      cigaretteButton.classList.add("is-idle");

      if (showIntro) {
        cigaretteIdleLoopTimer = window.setTimeout(() => {
          cigaretteIdleLoopTimer = 0;
          startCigaretteIdleLoop();
        }, CIGARETTE_IDLE_INTRO_DURATION);
      }
    }
  };
  cigaretteIdleImage.onerror = () => {
    if (showIntro) {
      startCigaretteIdleLoop();
    } else {
      stopCigaretteIdle({ discard: true });
    }
  };
  cigaretteIdleImage.src = showIntro
    ? cigaretteIdleImage.dataset.introSrc
    : cigaretteIdleImage.dataset.loopSrc;
}

function restartCigaretteAnimation() {
  const playbackId = ++cigarettePlaybackId;

  cigaretteHasBeenPressed = true;
  stopCigaretteIdle({ discard: true });
  window.clearTimeout(cigaretteResetTimer);

  if (cigaretteAnimationFormat === "image") {
    cigaretteVideo.pause();
    cigaretteButton.classList.remove("is-playing");
    cigaretteImage.onload = null;
    cigaretteImage.onerror = null;
    cigaretteImage.removeAttribute("src");
    cigaretteImage.onload = () => {
      if (playbackId !== cigarettePlaybackId) {
        return;
      }

      cigaretteButton.classList.add("is-playing");
      cigaretteResetTimer = window.setTimeout(
        finishCigaretteAnimation,
        CIGARETTE_ANIMATION_DURATION,
      );
    };
    cigaretteImage.onerror = () => {
      if (playbackId === cigarettePlaybackId) {
        cigaretteButton.classList.remove("is-playing");
      }
    };
    cigaretteImage.src = `${cigaretteImage.dataset.src}#play-${playbackId}`;
    return;
  }

  cigaretteVideo.pause();

  if (!cigaretteVideo.hasAttribute("src")) {
    cigaretteVideo.src = cigaretteVideo.dataset.src;
    cigaretteVideo.preload = "auto";
    cigaretteVideo.load();
  }

  try {
    cigaretteVideo.currentTime = 0;
  } catch (error) {
    console.debug("Cigarette video is not ready to seek yet", error);
  }

  const playRequest = cigaretteVideo.play();

  if (playRequest) {
    playRequest
      .then(() => {
        if (playbackId === cigarettePlaybackId) {
          cigaretteButton.classList.add("is-playing");
        }
      })
      .catch((error) => {
        if (playbackId === cigarettePlaybackId) {
          cigaretteButton.classList.remove("is-playing");
        }

        console.error("Could not play the cigarette animation", error);
      });
  } else {
    cigaretteButton.classList.add("is-playing");
  }
}

function pageFromHash() {
  const page = window.location.hash.slice(1).toLowerCase();
  return PAGES.has(page) ? page : "home";
}

async function loadDecodedImage(image, source, { highPriority = false } = {}) {
  if (highPriority) {
    image.fetchPriority = "high";
  }

  if (image.getAttribute("src") !== source) {
    image.src = source;
  }

  await imageReady(image);
  await image.decode?.();
  return image;
}

function ensureHomeExperience() {
  if (!timerBackgroundVideo.poster) {
    timerBackgroundVideo.poster = timerBackgroundVideo.dataset.poster;
  }

  if (!countdownTimer) {
    countdownTimer = initCountdownTimer(document.querySelector("[data-countdown]"));
  }

  if (!timerGlowInitialized) {
    timerGlowInitialized = true;
    initTimerGlow();
  }
}

function prepareRsvpAssets() {
  if (!cigarettePoster.hasAttribute("src")) {
    cigarettePoster.src = cigarettePoster.dataset.src;
  }
  startCigaretteIdle();
}

function commitPage(nextPage) {
  app.dataset.page = nextPage;
  backgrounds.forEach((background) => {
    background.classList.toggle("is-active", background.dataset.background === nextPage);
  });

  if (nextPage === "home") {
    ensureHomeExperience();
  }
  countdownTimer?.setActive(nextPage === "home");
  timerScreenBackground?.setActive(nextPage === "home");
  syncTimerGlowPlayback();

  if (nextPage === "rsvp") {
    prepareRsvpAssets();
  } else {
    cigaretteVideo.pause();
    if (!cigaretteHasBeenPressed) {
      stopCigaretteIdle({ discard: true });
    }
  }
}

async function showPage(page, { updateUrl = true } = {}) {
  const nextPage = PAGES.has(page) ? page : "home";
  const requestId = ++pageRequestId;
  const background = backgrounds.find((item) => item.dataset.background === nextPage);

  navigation.setPage(nextPage);

  if (updateUrl && window.location.hash !== `#${nextPage}`) {
    window.history.pushState({ page: nextPage }, "", `#${nextPage}`);
  }

  try {
    await loadDecodedImage(background, background.dataset.src, { highPriority: true });
  } catch (error) {
    console.error(error);
  }

  if (requestId === pageRequestId) {
    commitPage(nextPage);
  }
}

function imageReady(image) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error(`Не удалось загрузить ${image.src}`));
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`Не удалось загрузить ${image.src}`)),
      { once: true },
    );
  });
}

function showTimerGlowImage() {
  timerGlow.classList.remove("is-ready");
  timerGlow.dataset.animationFormat = "image";
  timerGlowVideo.onloadeddata = null;
  timerGlowVideo.onerror = null;
  timerGlowVideo.pause();
  timerGlowVideo.removeAttribute("src");
  timerGlowVideo.load();

  if (!timerGlowImage.src) {
    timerGlowImage.src = timerGlowImage.dataset.src;
  }

  imageReady(timerGlowImage)
    .then(() => timerGlow.classList.add("is-ready"))
    .catch((error) => console.error(error));
}

function showTimerGlowVideo() {
  timerGlow.dataset.animationFormat = "video";
  timerGlowVideo.onloadeddata = () => {
    timerGlow.classList.add("is-ready");
    timerGlowVideo.onloadeddata = null;
  };
  timerGlowVideo.onerror = showTimerGlowImage;
  timerGlowVideo.src = timerGlowVideo.dataset.src;
  timerGlowVideo.preload = "auto";
  timerGlowVideo.load();
  syncTimerGlowPlayback();
}

function syncTimerGlowPlayback() {
  if (!timerGlowVideo || timerGlow?.dataset.animationFormat !== "video") {
    return;
  }

  if (app.dataset.page !== "home" || document.hidden) {
    timerGlowVideo.pause();
    return;
  }

  const playRequest = timerGlowVideo.play();

  if (playRequest) {
    playRequest.catch((error) => {
      // Leaving the home page while play() is pending is an expected pause.
      if (error.name === "AbortError" || app.dataset.page !== "home" || document.hidden) {
        return;
      }
      console.warn("Could not autoplay the timer glow video; using image fallback", error);
      showTimerGlowImage();
    });
  }
}

function initTimerGlow() {
  if (!timerGlow || !timerGlowImage || !timerGlowVideo) {
    return;
  }

  if (isAppleMobileDevice()) {
    showTimerGlowImage();
    return;
  }

  showTimerGlowVideo();
}

cigaretteButton.addEventListener("click", restartCigaretteAnimation);
cigaretteVideo.addEventListener("ended", finishCigaretteAnimation);

window.addEventListener("popstate", () => showPage(pageFromHash(), { updateUrl: false }));
window.addEventListener("hashchange", () => showPage(pageFromHash(), { updateUrl: false }));
document.addEventListener("visibilitychange", syncTimerGlowPlayback);

showPage(pageFromHash(), { updateUrl: false });
