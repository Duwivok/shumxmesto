import { initCountdownTimer } from "./timer.js?v=20260914cold1";
import { initTimerScreenBackground } from "./timer-background.js?v=20260915allwebp1";
import { initNavigation } from "./navigation.js?v=20260914focus1";
import { RSVP_CONFIG } from "./rsvp-config.js?v=20260914preview1";
import { createRsvpController } from "./rsvp.js?v=20260914preview1";

const PAGES = new Set(["home", "lineup", "bar", "rsvp", "geo"]);

const app = document.querySelector("[data-app]");
const backgrounds = [...document.querySelectorAll("[data-background]")];
const barImages = [...document.querySelectorAll("[data-bar-image]")];
const barAnimationImages = [...document.querySelectorAll("[data-bar-animation-image]")];
const barVideos = [...document.querySelectorAll("[data-bar-video]")];
const geoLockOverlay = document.querySelector("[data-geo-lock-overlay]");
const geoLockImage = document.querySelector("[data-geo-lock-image]");
const geoEyeToggle = document.querySelector("[data-geo-eye-toggle]");
const navigationUnderlay = document.querySelector("[data-navigation-underlay]");
const navigation = initNavigation(document.querySelector("[data-navigation]"), (page) => showPage(page));
const timerGlow = document.querySelector("[data-timer-glow]");
const timerGlowImage = document.querySelector("[data-timer-glow-image]");
const timerGlowVideo = document.querySelector("[data-timer-glow-video]");
const cigaretteButton = document.querySelector("[data-cigarette]");
const cigarettePoster = document.querySelector("[data-cigarette-poster]");
const cigaretteIdleImage = document.querySelector("[data-cigarette-idle]");
const cigaretteImage = document.querySelector("[data-cigarette-image]");
const cigaretteVideo = document.querySelector("[data-cigarette-video]");
const cigaretteDefaultLabel = cigaretteButton.getAttribute("aria-label");
const timerBackgroundImage = document.querySelector("[data-timer-background-image]");
let countdownTimer = null;
const timerScreenBackground = initTimerScreenBackground(timerBackgroundImage);
let timerGlowInitialized = false;
let pageRequestId = 0;
let cigarettePlaybackId = 0;
let cigaretteResetTimer = 0;
let cigaretteIdleLoopTimer = 0;
let cigaretteHasBeenPressed = false;
let cigaretteIdleIntroHasStarted = false;
let cigaretteAnimationReadyPromise = null;
let barImagesReadyPromise = null;
let barAnimationImagesReadyPromise = null;
let barVideosPrepared = false;
let geoLockAssetsPromise = null;
let animatedImagePlaybackId = 0;

const CIGARETTE_ANIMATION_DURATION = 4000;
const CIGARETTE_IDLE_INTRO_DURATION = 2300;

function supportsWebmVideo(video) {
  return typeof video?.canPlayType === "function"
    && video.canPlayType('video/webm; codecs="vp9"') !== "";
}

const barAnimationFormat = "image";
let cigaretteAnimationFormat = "image";

barVideos.forEach((video) => {
  video.closest("[data-bar-cocktail]")?.setAttribute("data-animation-format", barAnimationFormat);
});
cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;

function useCigaretteImageFallback() {
  cigaretteAnimationFormat = "image";
  cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;
  cigaretteAnimationReadyPromise = null;
  cigaretteVideo.pause();
  cigaretteVideo.removeAttribute("src");
  cigaretteVideo.load();
}

function waitForVideoData(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };
    const handleLoadedData = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not decode the cigarette animation"));
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function prepareCigaretteAnimation() {
  if (cigaretteAnimationReadyPromise) {
    return cigaretteAnimationReadyPromise;
  }

  if (cigaretteAnimationFormat === "image") {
    const preparation = (async () => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "high";
      image.src = cigaretteImage.dataset.src;
      await imageReady(image);
      try {
        await image.decode?.();
      } catch (error) {
        // Some WebKit versions load animated WebP correctly but reject decode().
        console.debug("The cigarette image is loaded but was not pre-decoded", error);
      }
    })();
    cigaretteAnimationReadyPromise = preparation.catch((error) => {
      cigaretteAnimationReadyPromise = null;
      throw error;
    });
    return cigaretteAnimationReadyPromise;
  }

  const preparation = (async () => {
    // Download the short clip completely before assigning it to <video>.
    // A Blob-backed source cannot run out of network buffer mid-animation.
    const response = await fetch(cigaretteVideo.dataset.src, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`Could not preload the cigarette animation: ${response.status}`);
    }

    const blob = await response.blob();
    cigaretteVideo.src = URL.createObjectURL(blob);
    cigaretteVideo.preload = "auto";
    cigaretteVideo.load();
    await waitForVideoData(cigaretteVideo);
  })();
  cigaretteAnimationReadyPromise = preparation.catch((error) => {
    cigaretteAnimationReadyPromise = null;
    throw error;
  });

  return cigaretteAnimationReadyPromise;
}

function finishCigaretteAnimation() {
  window.clearTimeout(cigaretteResetTimer);
  cigaretteImage.onload = null;
  cigaretteImage.onerror = null;
  cigaretteButton.classList.add("is-playing");
}

function waitForCigaretteAnimation() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, CIGARETTE_ANIMATION_DURATION);
  });
}

async function playCigaretteAnimationCycle() {
  await restartCigaretteAnimation();
  await waitForCigaretteAnimation();
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

async function restartCigaretteAnimation() {
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
    try {
      await prepareCigaretteAnimation();
    } catch (error) {
      console.error(error);
      return;
    }

    if (playbackId !== cigarettePlaybackId || app.dataset.page !== "rsvp") {
      return;
    }

    cigaretteImage.onerror = () => {
      if (playbackId === cigarettePlaybackId) {
        cigaretteButton.classList.remove("is-playing");
      }
    };
    cigaretteButton.classList.add("is-playing");
    cigaretteImage.src = `${cigaretteImage.dataset.src}#play-${playbackId}`;
    cigaretteResetTimer = window.setTimeout(
      finishCigaretteAnimation,
      CIGARETTE_ANIMATION_DURATION,
    );
    return;
  }

  cigaretteVideo.pause();

  try {
    await prepareCigaretteAnimation();
  } catch {
    useCigaretteImageFallback();
    return restartCigaretteAnimation();
  }

  if (playbackId !== cigarettePlaybackId || app.dataset.page !== "rsvp") {
    return;
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

async function loadAnimatedImage(image, source) {
  // Warm animated WebP in a detached image before exposing the real element.
  // On a cold iPhone launch, showing the first decode directly can stretch the
  // animation timeline. Starting a fresh instance from the warmed cache keeps
  // playback at its authored speed, as with the RSVP cigarette animation.
  const preloader = new Image();
  preloader.decoding = "async";
  preloader.fetchPriority = image.fetchPriority || "auto";
  preloader.src = source;
  await imageReady(preloader);
  try {
    await preloader.decode?.();
  } catch (error) {
    // Some WebKit versions animate WebP correctly but reject decode().
    console.debug("The animated image is loaded but was not pre-decoded", error);
  }

  image.src = `${source}#play-${++animatedImagePlaybackId}`;
  await imageReady(image);
  return image;
}

function ensureHomeExperience() {
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
  prepareCigaretteAnimation().catch((error) => console.error(error));
  startCigaretteIdle();
}

function prepareBarImages() {
  if (barImagesReadyPromise) {
    return barImagesReadyPromise;
  }

  const preparation = Promise.all(
    barImages.map((image) => loadDecodedImage(
      image,
      image.dataset.src,
      { highPriority: image.dataset.barImage === "back" },
    )),
  );

  barImagesReadyPromise = preparation.catch((error) => {
    barImagesReadyPromise = null;
    throw error;
  });
  return barImagesReadyPromise;
}

function prepareBarVideos() {
  if (barVideosPrepared || !barVideos.length) {
    return;
  }

  barVideosPrepared = true;
  barVideos.forEach((video) => {
    const cocktail = video.closest("[data-bar-cocktail]");

    if (!supportsWebmVideo(video)) {
      return;
    }

    video.addEventListener("playing", () => cocktail?.classList.add("is-playing"));
    video.addEventListener("error", () => {
      cocktail?.classList.remove("is-playing");
      console.warn(`Could not load the bar animation: ${video.dataset.src}`);
    });
    video.src = video.dataset.src;
    video.preload = "auto";
    video.load();
  });
}

function prepareBarAnimationImages() {
  if (barAnimationImagesReadyPromise) {
    return barAnimationImagesReadyPromise;
  }

  const preparation = Promise.all(
    barAnimationImages.map(async (image) => {
      const cocktail = image.closest("[data-bar-cocktail]");
      try {
        await loadAnimatedImage(image, image.dataset.src);
        cocktail?.classList.add("is-playing");
      } catch (error) {
        cocktail?.classList.remove("is-playing");
        console.warn(`Could not load the bar animation: ${image.dataset.src}`, error);
      }
    }),
  );

  barAnimationImagesReadyPromise = preparation.catch((error) => {
    barAnimationImagesReadyPromise = null;
    throw error;
  });
  return barAnimationImagesReadyPromise;
}

function syncBarPlayback() {
  if (barAnimationFormat === "image") {
    if (app.dataset.page === "bar" && !document.hidden) {
      prepareBarAnimationImages().catch((error) => console.error(error));
    }
    return;
  }

  if (!barVideos.length) {
    return;
  }

  if (app.dataset.page !== "bar" || document.hidden) {
    barVideos.forEach((video) => video.pause());
    return;
  }

  prepareBarVideos();
  barVideos.forEach((video) => {
    if (!video.src) {
      return;
    }

    const playRequest = video.play();
    playRequest?.catch((error) => {
      if (error.name === "AbortError" || app.dataset.page !== "bar" || document.hidden) {
        return;
      }
      video.closest("[data-bar-cocktail]")?.classList.remove("is-playing");
      console.warn("Could not autoplay a bar animation; keeping its poster", error);
    });
  });
}

function prepareGeoLockAssets() {
  if (!geoLockAssetsPromise) {
    geoLockImage.fetchPriority = "high";
    geoLockAssetsPromise = loadAnimatedImage(geoLockImage, geoLockImage.dataset.src).catch((error) => {
      geoLockAssetsPromise = null;
      throw error;
    });
  }
  return geoLockAssetsPromise;
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
  syncBarPlayback();

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
  const pageAssets = nextPage === "bar"
    ? [prepareBarImages()]
    : [loadDecodedImage(background, background.dataset.src, { highPriority: true })];

  if (navigationUnderlay?.dataset.navigationUnderlay === nextPage) {
    pageAssets.push(
      loadDecodedImage(navigationUnderlay, navigationUnderlay.dataset.src)
        .then(() => navigationUnderlay.classList.add("is-ready")),
    );
  }

  navigation.setPage(nextPage);

  if (updateUrl && window.location.hash !== `#${nextPage}`) {
    window.history.pushState({ page: nextPage }, "", `#${nextPage}`);
  }

  try {
    await Promise.all(pageAssets);
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

  showTimerGlowImage();
}

const rsvpController = createRsvpController({
  ...RSVP_CONFIG,
  enabled: !RSVP_CONFIG.previewHostnames.includes(window.location.hostname),
  getStorage: () => window.localStorage,
  fetchRequest: (...argumentsList) => window.fetch(...argumentsList),
  cryptoProvider: window.crypto,
  playAnimation: playCigaretteAnimationCycle,
  openChannel: (url) => window.location.assign(url),
});

cigaretteButton.addEventListener("click", async () => {
  if (rsvpController.isInFlight()) {
    return;
  }

  cigaretteButton.setAttribute("aria-label", cigaretteDefaultLabel);
  cigaretteButton.setAttribute("aria-busy", "true");
  const result = await rsvpController.activate();
  cigaretteButton.removeAttribute("aria-busy");

  if (!result.ok) {
    cigaretteButton.setAttribute(
      "aria-label",
      result.reason === "preview-disabled"
        ? "Предварительный просмотр: подтверждение участия отключено"
        : result.reason === "channel-not-configured"
          ? "Ссылка на Telegram-канал пока не настроена"
          : "Не удалось подтвердить участие. Нажмите ещё раз, чтобы повторить",
    );
  } else {
    cigaretteButton.setAttribute("aria-label", cigaretteDefaultLabel);
  }
});
cigaretteVideo.addEventListener("ended", finishCigaretteAnimation);

window.addEventListener("popstate", () => showPage(pageFromHash(), { updateUrl: false }));
window.addEventListener("hashchange", () => showPage(pageFromHash(), { updateUrl: false }));
document.addEventListener("visibilitychange", syncTimerGlowPlayback);
document.addEventListener("visibilitychange", syncBarPlayback);

geoEyeToggle.addEventListener("click", async () => {
  const locked = app.dataset.geoLocked !== "true";
  if (locked) {
    try {
      await prepareGeoLockAssets();
    } catch (error) {
      console.error("Could not load the locked Geo preview", error);
      return;
    }
  }
  app.dataset.geoLocked = String(locked);
  geoLockOverlay.setAttribute("aria-hidden", String(!locked));
  geoEyeToggle.setAttribute("aria-pressed", String(locked));
  geoEyeToggle.setAttribute(
    "aria-label",
    locked ? "Показать открытую версию Гео" : "Показать закрытую версию Гео",
  );
});

showPage(pageFromHash(), { updateUrl: false });
