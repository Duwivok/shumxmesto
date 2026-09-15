import { initCountdownTimer } from "./timer.js?v=20260914cold1";
import { initTimerScreenBackground } from "./timer-background.js?v=20260915allwebp1";
import { initNavigation } from "./navigation.js?v=20260914focus1";
import { RSVP_CONFIG } from "./rsvp-config.js?v=20260915count1";
import { createRsvpController } from "./rsvp.js?v=20260914preview1";
import { createRsvpCountController } from "./rsvp-count.js?v=20260915count1";
import { digitAssetUrl } from "./assets-loader.js?v=20260914cold1";

const PAGES = new Set(["home", "lineup", "bar", "rsvp", "geo"]);

const app = document.querySelector("[data-app]");
const backgrounds = [...document.querySelectorAll("[data-background]")];
const barImages = [...document.querySelectorAll("[data-bar-image]")];
const barAnimationImages = [...document.querySelectorAll("[data-bar-animation-image]")];
const barVideos = [...document.querySelectorAll("[data-bar-video]")];
const geoLockOverlay = document.querySelector("[data-geo-lock-overlay]");
const geoLockImage = document.querySelector("[data-geo-lock-image]");
const geoHints = document.querySelector("[data-geo-hints]");
const geoHintBackdrop = document.querySelector("[data-geo-hint-backdrop]");
const geoHintPhone = document.querySelector("[data-geo-hint-phone]");
const geoHintImage = document.querySelector("[data-geo-hint-image]");
const geoHintZones = [...document.querySelectorAll("[data-geo-zone]")];
const navigationUnderlay = document.querySelector("[data-navigation-underlay]");
const navigation = initNavigation(document.querySelector("[data-navigation]"), (page) => showPage(page));
const timerGlow = document.querySelector("[data-timer-glow]");
const timerGlowImage = document.querySelector("[data-timer-glow-image]");
const timerGlowVideo = document.querySelector("[data-timer-glow-video]");
const cigaretteButton = document.querySelector("[data-cigarette]");
const cigaretteIdleImage = document.querySelector("[data-cigarette-idle]");
const cigaretteIdleVideo = document.querySelector("[data-cigarette-idle-video]");
const cigaretteImage = document.querySelector("[data-cigarette-image]");
const cigaretteVideo = document.querySelector("[data-cigarette-video]");
const cigaretteDefaultLabel = cigaretteButton.getAttribute("aria-label");
const rsvpCount = document.querySelector("[data-rsvp-count]");
const rsvpCountDigits = [...document.querySelectorAll("[data-rsvp-count-digit]")];
const timerBackgroundImage = document.querySelector("[data-timer-background-image]");
let countdownTimer = null;
const timerScreenBackground = initTimerScreenBackground(timerBackgroundImage);
let timerGlowInitialized = false;
let pageRequestId = 0;
let cigarettePlaybackId = 0;
let cigaretteResetTimer = 0;
let cigaretteHasBeenPressed = false;
let cigaretteIdleImageReadyPromise = null;
let cigaretteIdleVideoReadyPromise = null;
let cigaretteAnimationReadyPromise = null;
let cigaretteIdleVideoObjectUrl = "";
let cigaretteAnimationVideoObjectUrl = "";
let cigaretteIdleStarting = false;
let cigaretteIdleImagePlaybackId = 0;
let barImagesReadyPromise = null;
let barAnimationImagesReadyPromise = null;
let barVideosPrepared = false;
let geoLockAssetsPromise = null;
let geoStateRequestId = 0;
let geoHintAssetsPromise = null;
let geoHintLastTrigger = null;
let animatedImagePlaybackId = 0;

const CIGARETTE_IMAGE_ANIMATION_DURATION = 3000;
const CIGARETTE_VIDEO_ANIMATION_DURATION = 3000;
const CIGARETTE_VIDEO_END_GRACE = 1000;

function supportsWebmVideo(video) {
  return typeof video?.canPlayType === "function"
    && video.canPlayType('video/webm; codecs="vp9"') !== "";
}

const barAnimationFormat = "image";
let cigaretteAnimationFormat = "image";

barAnimationImages.forEach((image) => {
  image.closest("[data-bar-cocktail]")?.setAttribute("data-animation-format", barAnimationFormat);
});
cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;

function useCigaretteImageFallback() {
  if (cigaretteAnimationFormat === "image") {
    return;
  }

  cigaretteAnimationFormat = "image";
  cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;
  cigaretteButton.classList.remove("is-idle");
  cigaretteIdleVideoReadyPromise = null;
  cigaretteAnimationReadyPromise = null;
  cigaretteIdleVideo.pause();
  cigaretteIdleVideo.removeAttribute("src");
  cigaretteIdleVideo.load();
  cigaretteVideo.pause();
  cigaretteVideo.removeAttribute("src");
  cigaretteVideo.load();

  if (cigaretteIdleVideoObjectUrl) {
    URL.revokeObjectURL(cigaretteIdleVideoObjectUrl);
    cigaretteIdleVideoObjectUrl = "";
  }
  if (cigaretteAnimationVideoObjectUrl) {
    URL.revokeObjectURL(cigaretteAnimationVideoObjectUrl);
    cigaretteAnimationVideoObjectUrl = "";
  }

  if (!cigaretteHasBeenPressed && app.dataset.page === "rsvp") {
    startCigaretteIdle();
  }
  prepareCigaretteAnimation().catch((error) => console.error(error));
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

async function loadCigaretteVideo(video, source) {
  // Fully buffer these short alpha videos before exposing them. This avoids a
  // cold mobile connection changing the authored playback speed mid-shot.
  const response = await fetch(source, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Could not preload the cigarette animation: ${response.status}`);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  video.src = objectUrl;
  video.preload = "auto";
  video.load();

  try {
    await waitForVideoData(video);
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return objectUrl;
}

function prepareCigaretteIdleImage() {
  if (cigaretteIdleImageReadyPromise) {
    return cigaretteIdleImageReadyPromise;
  }

  const preparation = (async () => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.src = cigaretteIdleImage.dataset.src;
    await imageReady(image);
    try {
      await image.decode?.();
    } catch (error) {
      // Some WebKit versions animate WebP correctly but reject decode().
      console.debug("The cigarette preview is loaded but was not pre-decoded", error);
    }
  })();

  const readyPromise = preparation.catch((error) => {
    if (cigaretteIdleImageReadyPromise === readyPromise) {
      cigaretteIdleImageReadyPromise = null;
    }
    throw error;
  });
  cigaretteIdleImageReadyPromise = readyPromise;
  return cigaretteIdleImageReadyPromise;
}

function prepareCigaretteIdleVideo() {
  if (cigaretteIdleVideoReadyPromise) {
    return cigaretteIdleVideoReadyPromise;
  }

  const preparation = loadCigaretteVideo(
    cigaretteIdleVideo,
    cigaretteIdleVideo.dataset.src,
  ).then((objectUrl) => {
    if (cigaretteAnimationFormat !== "video") {
      cigaretteIdleVideo.removeAttribute("src");
      cigaretteIdleVideo.load();
      URL.revokeObjectURL(objectUrl);
      return;
    }
    cigaretteIdleVideoObjectUrl = objectUrl;
  });

  const readyPromise = preparation.catch((error) => {
    if (cigaretteIdleVideoReadyPromise === readyPromise) {
      cigaretteIdleVideoReadyPromise = null;
    }
    throw error;
  });
  cigaretteIdleVideoReadyPromise = readyPromise;
  return cigaretteIdleVideoReadyPromise;
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
    const readyPromise = preparation.catch((error) => {
      if (cigaretteAnimationReadyPromise === readyPromise) {
        cigaretteAnimationReadyPromise = null;
      }
      throw error;
    });
    cigaretteAnimationReadyPromise = readyPromise;
    return cigaretteAnimationReadyPromise;
  }

  const preparation = loadCigaretteVideo(
    cigaretteVideo,
    cigaretteVideo.dataset.src,
  ).then((objectUrl) => {
    if (cigaretteAnimationFormat !== "video") {
      cigaretteVideo.removeAttribute("src");
      cigaretteVideo.load();
      URL.revokeObjectURL(objectUrl);
      return;
    }
    cigaretteAnimationVideoObjectUrl = objectUrl;
  });
  const readyPromise = preparation.catch((error) => {
    if (cigaretteAnimationReadyPromise === readyPromise) {
      cigaretteAnimationReadyPromise = null;
    }
    throw error;
  });
  cigaretteAnimationReadyPromise = readyPromise;

  return cigaretteAnimationReadyPromise;
}

function finishCigaretteAnimation() {
  window.clearTimeout(cigaretteResetTimer);
  cigaretteResetTimer = 0;
  cigaretteImage.onload = null;
  cigaretteImage.onerror = null;
  cigaretteButton.classList.add("is-playing");
}

function waitForCigaretteImageAnimation() {
  return new Promise((resolve) => {
    cigaretteResetTimer = window.setTimeout(() => {
      finishCigaretteAnimation();
      resolve();
    }, CIGARETTE_IMAGE_ANIMATION_DURATION);
  });
}

function waitForCigaretteVideoEnd(playbackId) {
  return new Promise((resolve) => {
    let settled = false;
    const duration = Number.isFinite(cigaretteVideo.duration) && cigaretteVideo.duration > 0
      ? cigaretteVideo.duration * 1000
      : CIGARETTE_VIDEO_ANIMATION_DURATION;

    const complete = () => {
      if (settled) {
        return;
      }

      settled = true;
      cigaretteVideo.removeEventListener("ended", complete);
      window.clearTimeout(cigaretteResetTimer);
      cigaretteResetTimer = 0;
      if (playbackId === cigarettePlaybackId) {
        finishCigaretteAnimation();
      }
      resolve();
    };

    cigaretteVideo.addEventListener("ended", complete, { once: true });
    cigaretteResetTimer = window.setTimeout(
      complete,
      duration + CIGARETTE_VIDEO_END_GRACE,
    );
  });
}

function stopCigaretteIdle({ discard = false } = {}) {
  cigaretteIdleImage.onload = null;
  cigaretteIdleImage.onerror = null;
  cigaretteIdleVideo.pause();
  cigaretteButton.classList.remove("is-idle");

  if (discard) {
    cigaretteIdleImage.removeAttribute("src");
  }
}

function startCigaretteIdle() {
  if (
    cigaretteHasBeenPressed
    || document.hidden
    || cigaretteButton.classList.contains("is-playing")
    || cigaretteButton.classList.contains("is-idle")
  ) {
    return;
  }

  if (cigaretteAnimationFormat === "video") {
    if (cigaretteIdleStarting) {
      return;
    }

    cigaretteIdleStarting = true;
    prepareCigaretteIdleVideo()
      .then(async () => {
        if (
          cigaretteAnimationFormat !== "video"
          || cigaretteHasBeenPressed
          || app.dataset.page !== "rsvp"
        ) {
          return;
        }

        try {
          cigaretteIdleVideo.currentTime = 0;
        } catch (error) {
          console.debug("Cigarette preview is not ready to seek yet", error);
        }

        await cigaretteIdleVideo.play();
        if (!cigaretteHasBeenPressed && app.dataset.page === "rsvp") {
          cigaretteButton.classList.add("is-idle");
        }
      })
      .catch((error) => {
        if (cigaretteAnimationFormat === "video") {
          console.warn("Could not play the cigarette preview; using image fallback", error);
          useCigaretteImageFallback();
        }
      })
      .finally(() => {
        cigaretteIdleStarting = false;
      });
    return;
  }

  if (cigaretteIdleStarting) {
    return;
  }

  if (cigaretteIdleImage.hasAttribute("src")) {
    cigaretteButton.classList.add("is-idle");
    return;
  }

  cigaretteIdleStarting = true;
  prepareCigaretteIdleImage()
    .then(async () => {
      if (
        cigaretteAnimationFormat !== "image"
        || cigaretteHasBeenPressed
        || document.hidden
        || app.dataset.page !== "rsvp"
      ) {
        return;
      }

      cigaretteIdleImage.src = `${cigaretteIdleImage.dataset.src}#play-${++cigaretteIdleImagePlaybackId}`;
      await imageReady(cigaretteIdleImage);
      if (!cigaretteHasBeenPressed && !document.hidden && app.dataset.page === "rsvp") {
        cigaretteButton.classList.add("is-idle");
      }
    })
    .catch((error) => {
      stopCigaretteIdle({ discard: true });
      console.warn("Could not play the cigarette preview", error);
    })
    .finally(() => {
      cigaretteIdleStarting = false;
    });
}

function syncCigaretteIdlePlayback() {
  if (cigaretteHasBeenPressed) {
    return;
  }

  if (app.dataset.page !== "rsvp" || document.hidden) {
    stopCigaretteIdle({ discard: cigaretteAnimationFormat === "image" });
    return;
  }

  startCigaretteIdle();
}

async function restartCigaretteAnimation() {
  const playbackId = ++cigarettePlaybackId;

  cigaretteHasBeenPressed = true;
  window.clearTimeout(cigaretteResetTimer);

  if (cigaretteAnimationFormat === "image") {
    stopCigaretteIdle({ discard: true });
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
    await waitForCigaretteImageAnimation();
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

  stopCigaretteIdle({ discard: true });
  try {
    cigaretteVideo.currentTime = 0;
  } catch (error) {
    console.debug("Cigarette video is not ready to seek yet", error);
  }

  cigaretteButton.classList.add("is-playing");
  try {
    await cigaretteVideo.play();
  } catch (error) {
    if (playbackId === cigarettePlaybackId) {
      cigaretteButton.classList.remove("is-playing");
    }
    console.warn("Could not play the cigarette animation; using image fallback", error);
    useCigaretteImageFallback();
    return restartCigaretteAnimation();
  }

  await waitForCigaretteVideoEnd(playbackId);
}

function playCigaretteAnimationCycle() {
  return restartCigaretteAnimation();
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
  prepareCigaretteAnimation().catch((error) => {
    if (cigaretteAnimationFormat === "video") {
      console.warn("Could not preload the cigarette animation; using image fallback", error);
      useCigaretteImageFallback();
    } else {
      console.error(error);
    }
  });
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

function applyGeoState(hidden) {
  if (hidden) {
    closeGeoHint({ restoreFocus: false });
  }
  app.dataset.geoLocked = String(hidden);
  geoLockOverlay.setAttribute("aria-hidden", String(!hidden));
  if (!hidden && app.dataset.page === "geo") {
    prepareGeoHintAssets().catch((error) => console.error("Could not preload Geo hints", error));
  }
  syncGeoHintAvailability();
}

async function refreshGeoState() {
  const requestId = ++geoStateRequestId;
  let hidden = true;
  try {
    const response = await fetch("/api/geo-state", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok || typeof result.hidden !== "boolean") {
      throw new Error("Invalid Geo state response");
    }
    hidden = result.hidden;
  } catch (error) {
    console.warn("Could not refresh the Geo state; keeping the blur enabled", error);
  }

  if (hidden) {
    try {
      await prepareGeoLockAssets();
    } catch (error) {
      console.error("Could not load the locked Geo view", error);
    }
  }
  if (requestId === geoStateRequestId) {
    applyGeoState(hidden);
  }
}

function geoHintsAreAvailable() {
  return app.dataset.page === "geo" && app.dataset.geoLocked !== "true";
}

function syncGeoHintAvailability() {
  const available = geoHintsAreAvailable() && !geoHints.classList.contains("is-open");
  geoHintZones.forEach((zone) => {
    zone.setAttribute("tabindex", available ? "0" : "-1");
    zone.setAttribute("aria-disabled", String(!available));
  });
}

function prepareGeoHintAssets() {
  if (geoHintAssetsPromise) {
    return geoHintAssetsPromise;
  }

  const sources = [...new Set(geoHintZones.map((zone) => zone.dataset.phoneSrc))];
  const preparation = Promise.all(
    sources.map((source) => {
      const image = new Image();
      image.decoding = "async";
      return loadDecodedImage(image, source);
    }),
  ).then(() => undefined);

  geoHintAssetsPromise = preparation.catch((error) => {
    geoHintAssetsPromise = null;
    throw error;
  });
  return geoHintAssetsPromise;
}

function openGeoHint(zone) {
  if (!geoHintsAreAvailable()) {
    return;
  }

  const hintNumber = zone.dataset.geoZone;
  geoHintLastTrigger = zone;
  geoHintImage.src = zone.dataset.phoneSrc;
  geoHintPhone.setAttribute("aria-label", `Подсказка ${hintNumber}`);
  geoHintPhone.setAttribute("aria-hidden", "false");
  geoHintBackdrop.setAttribute("tabindex", "0");
  geoHints.dataset.activeHint = hintNumber;
  geoHints.classList.add("is-open");
  syncGeoHintAvailability();
  geoHintPhone.focus({ preventScroll: true });
}

function closeGeoHint({ restoreFocus = true } = {}) {
  if (!geoHints.classList.contains("is-open")) {
    return;
  }

  geoHints.classList.remove("is-open");
  delete geoHints.dataset.activeHint;
  geoHintPhone.setAttribute("aria-hidden", "true");
  geoHintBackdrop.setAttribute("tabindex", "-1");
  syncGeoHintAvailability();

  if (restoreFocus && geoHintsAreAvailable()) {
    geoHintLastTrigger?.focus({ preventScroll: true });
  }
}

function commitPage(nextPage) {
  app.dataset.page = nextPage;
  if (nextPage !== "geo" || app.dataset.geoLocked === "true") {
    closeGeoHint({ restoreFocus: false });
  }
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
    cigaretteIdleVideo.pause();
    stopCigaretteIdle({ discard: !cigaretteHasBeenPressed });
  }

  if (nextPage === "geo" && app.dataset.geoLocked !== "true") {
    prepareGeoHintAssets().catch((error) => console.error("Could not preload Geo hints", error));
  }
  syncGeoHintAvailability();
}

async function showPage(page, { updateUrl = true } = {}) {
  const nextPage = PAGES.has(page) ? page : "home";
  const requestId = ++pageRequestId;
  const background = backgrounds.find((item) => item.dataset.background === nextPage);
  const pageAssets = nextPage === "bar"
    ? [prepareBarImages()]
    : nextPage === "geo"
      ? [
          loadDecodedImage(background, background.dataset.src, { highPriority: true }),
          refreshGeoState(),
        ]
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

function renderRsvpCount(value) {
  [...value].forEach((character, position) => {
    const image = rsvpCountDigits[position];
    const source = digitAssetUrl(Number(character));
    if (image.dataset.assetSource !== source) {
      image.dataset.assetSource = source;
      image.src = source;
    }
  });
  rsvpCount.setAttribute("aria-label", `Подтвердили участие: ${value}`);
}

const rsvpCountController = createRsvpCountController({
  endpoint: RSVP_CONFIG.countEndpoint,
  storageKey: RSVP_CONFIG.countStorageKey,
  getStorage: () => window.localStorage,
  fetchRequest: (...argumentsList) => window.fetch(...argumentsList),
  renderCount: renderRsvpCount,
});
rsvpCountController.load();

cigaretteButton.addEventListener("click", async () => {
  if (rsvpController.isInFlight()) {
    return;
  }

  rsvpCountController.freeze();
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

geoHintZones.forEach((zone) => {
  zone.addEventListener("click", () => openGeoHint(zone));
  zone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openGeoHint(zone);
  });
});

geoHintBackdrop.addEventListener("click", () => closeGeoHint());
geoHintPhone.addEventListener("click", () => closeGeoHint());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGeoHint();
    return;
  }

  if (event.key === "Tab" && geoHints.classList.contains("is-open")) {
    event.preventDefault();
    const nextFocus = document.activeElement === geoHintBackdrop
      ? geoHintPhone
      : geoHintBackdrop;
    nextFocus.focus({ preventScroll: true });
  }
});

window.addEventListener("popstate", () => showPage(pageFromHash(), { updateUrl: false }));
window.addEventListener("hashchange", () => showPage(pageFromHash(), { updateUrl: false }));
document.addEventListener("visibilitychange", syncTimerGlowPlayback);
document.addEventListener("visibilitychange", syncBarPlayback);
document.addEventListener("visibilitychange", syncCigaretteIdlePlayback);
document.addEventListener("visibilitychange", () => {
  if (app.dataset.page === "geo" && !document.hidden) {
    void refreshGeoState();
  }
});

window.setInterval(() => {
  if (app.dataset.page === "geo" && !document.hidden) {
    void refreshGeoState();
  }
}, 10_000);

showPage(pageFromHash(), { updateUrl: false });
