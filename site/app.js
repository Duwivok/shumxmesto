import { initCountdownTimer } from "./timer.js";

const PAGES = new Set(["home", "lineup", "bar", "rsvp"]);

const app = document.querySelector("[data-app]");
const backgrounds = [...document.querySelectorAll("[data-background]")];
const navigationArtwork = [...document.querySelectorAll("[data-navigation]")];
const navigationButtons = [...document.querySelectorAll("[data-target]")];
const cigaretteButton = document.querySelector("[data-cigarette]");
const cigaretteImage = document.querySelector("[data-cigarette-image]");
const cigaretteVideo = document.querySelector("[data-cigarette-video]");
const countdownTimer = initCountdownTimer(document.querySelector("[data-countdown]"));
let cigarettePlaybackId = 0;
let cigaretteResetTimer = 0;

const CIGARETTE_ANIMATION_DURATION = 4000;

function isAppleMobileDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const cigaretteAnimationFormat = isAppleMobileDevice() ? "image" : "video";
cigaretteButton.dataset.animationFormat = cigaretteAnimationFormat;

if (cigaretteAnimationFormat === "image") {
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.type = "image/webp";
  preload.href = cigaretteImage.dataset.src;
  document.head.append(preload);
} else {
  cigaretteVideo.src = cigaretteVideo.dataset.src;
  cigaretteVideo.preload = "auto";
  cigaretteVideo.load();
}

function resetCigaretteAnimation() {
  cigarettePlaybackId += 1;
  window.clearTimeout(cigaretteResetTimer);
  cigaretteVideo.pause();
  cigaretteImage.onload = null;
  cigaretteImage.onerror = null;
  cigaretteImage.removeAttribute("src");

  try {
    cigaretteVideo.currentTime = 0;
  } catch (error) {
    console.debug("Cigarette video is not ready to seek yet", error);
  }

  cigaretteButton.classList.remove("is-playing");
}

function restartCigaretteAnimation() {
  const playbackId = ++cigarettePlaybackId;

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
        resetCigaretteAnimation,
        CIGARETTE_ANIMATION_DURATION,
      );
    };
    cigaretteImage.onerror = () => {
      if (playbackId === cigarettePlaybackId) {
        resetCigaretteAnimation();
      }
    };
    cigaretteImage.src = `${cigaretteImage.dataset.src}#play-${playbackId}`;
    return;
  }

  cigaretteVideo.pause();

  try {
    cigaretteVideo.currentTime = 0;
  } catch (error) {
    console.debug("Cigarette video is not ready to seek yet", error);
  }

  cigaretteButton.classList.add("is-playing");

  const playRequest = cigaretteVideo.play();

  if (playRequest) {
    playRequest.catch((error) => {
      if (playbackId === cigarettePlaybackId) {
        cigaretteButton.classList.remove("is-playing");
      }

      console.error("Could not play the cigarette animation", error);
    });
  }
}

function pageFromHash() {
  const page = window.location.hash.slice(1).toLowerCase();
  return PAGES.has(page) ? page : "home";
}

function showPage(page, { updateUrl = true } = {}) {
  const nextPage = PAGES.has(page) ? page : "home";

  if (nextPage !== "rsvp") {
    resetCigaretteAnimation();
  }

  app.dataset.page = nextPage;
  countdownTimer?.setActive(nextPage === "home");

  backgrounds.forEach((background) => {
    background.classList.toggle("is-active", background.dataset.background === nextPage);
  });

  navigationArtwork.forEach((artwork) => {
    artwork.classList.toggle("is-active", artwork.dataset.navigation === nextPage);
  });

  navigationButtons.forEach((button) => {
    if (button.dataset.target === nextPage) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (updateUrl && window.location.hash !== `#${nextPage}`) {
    window.history.pushState({ page: nextPage }, "", `#${nextPage}`);
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

navigationButtons.forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.target));
});

cigaretteButton.addEventListener("click", restartCigaretteAnimation);
cigaretteVideo.addEventListener("ended", resetCigaretteAnimation);

window.addEventListener("popstate", () => showPage(pageFromHash(), { updateUrl: false }));

showPage(pageFromHash(), { updateUrl: false });

const preloadedImages = [...backgrounds, ...navigationArtwork];

Promise.all(preloadedImages.map(imageReady))
  .catch((error) => console.error(error))
  .finally(() => {
    app.dataset.ready = "true";
  });
