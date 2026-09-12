import { initCountdownTimer } from "./timer.js";

const PAGES = new Set(["home", "lineup", "bar", "rsvp"]);

const app = document.querySelector("[data-app]");
const backgrounds = [...document.querySelectorAll("[data-background]")];
const navigationButtons = [...document.querySelectorAll("[data-target]")];
const cigaretteButton = document.querySelector("[data-cigarette]");
const cigaretteVideo = document.querySelector("[data-cigarette-video]");
const countdownTimer = initCountdownTimer(document.querySelector("[data-countdown]"));
let cigarettePlaybackId = 0;

function resetCigaretteAnimation() {
  cigarettePlaybackId += 1;
  cigaretteVideo.pause();

  try {
    cigaretteVideo.currentTime = 0;
  } catch (error) {
    console.debug("Cigarette video is not ready to seek yet", error);
  }

  cigaretteButton.classList.remove("is-playing");
}

function restartCigaretteAnimation() {
  const playbackId = ++cigarettePlaybackId;

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

const preloadedImages = [...backgrounds, document.querySelector(".navigation-art")];

Promise.all(preloadedImages.map(imageReady))
  .catch((error) => console.error(error))
  .finally(() => {
    app.dataset.ready = "true";
  });
