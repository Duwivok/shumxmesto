export function initNavigation(navigation, onSelect) {
  const track = navigation.querySelector(".navigation-track");
  const buttons = [...navigation.querySelectorAll("[data-target]")];
  const motions = buttons.map((button) => button.querySelector(".nav-button-motion"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let selected = Math.max(0, buttons.findIndex((button) => button.hasAttribute("aria-current")));
  let gesture = null;
  let drag = 0;
  let suppressClick = false;

  const clampIndex = (index) => Math.max(0, Math.min(buttons.length - 1, index));
  const pitch = () => track.firstElementChild.getBoundingClientRect().width;

  function render() {
    const step = pitch();
    const position = selected - drag / step;
    track.style.setProperty("--nav-offset", `${((buttons.length - 1) / 2 - position) * step}px`);

    buttons.forEach((button, index) => {
      const proximity = Math.max(0, 1 - Math.abs(index - position));
      const weight = proximity * proximity * (3 - 2 * proximity);
      button.style.setProperty("--nav-scale", 0.88 + 0.52 * weight);
      button.style.setProperty("--nav-lift", `${-14 * step / 70 * weight}px`);
      button.style.opacity = 0.82 + 0.18 * weight;
      button.style.filter = `brightness(${0.95 + 0.05 * weight})`
        + (weight > 0.92 ? " drop-shadow(0 6px 18px rgba(255,46,147,.45))" : "");
      button.style.zIndex = Math.round(weight * 10) + 1;
      button.tabIndex = index === selected ? 0 : -1;
      if (index === selected) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function stopGesture() {
    const pointerId = gesture?.pointerId;
    gesture = null;
    drag = 0;
    navigation.classList.remove("is-dragging");
    if (pointerId !== undefined && navigation.hasPointerCapture(pointerId)) {
      navigation.releasePointerCapture(pointerId);
    }
  }

  function select(index, { notify = true, animate = true, focus = false } = {}) {
    const next = clampIndex(index);
    const changed = next !== selected;
    stopGesture();
    selected = next;
    render();

    if (changed) {
      motions.forEach((motion) => motion.classList.remove("is-crumpling"));
      if (animate && !reducedMotion.matches) {
        void motions[selected].offsetWidth;
        motions[selected].classList.add("is-crumpling");
      }
    }
    if (focus) buttons[selected].focus({ preventScroll: true });
    if (notify && changed) onSelect(buttons[selected].dataset.target);
  }

  motions.forEach((motion) => {
    motion.addEventListener("animationend", (event) => {
      if (event.target === motion) motion.classList.remove("is-crumpling");
    });
  });

  navigation.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || gesture) return;
    navigation.dataset.inputMethod = "pointer";
    suppressClick = false;
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      button: event.target.closest(".nav-button"),
      moved: false,
    };
  });

  navigation.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const distance = event.clientX - gesture.x;
    if (!gesture.moved && Math.abs(distance) <= 6) return;
    if (!gesture.moved) {
      gesture.moved = true;
      navigation.setPointerCapture(event.pointerId);
      navigation.classList.add("is-dragging");
      motions.forEach((motion) => motion.classList.remove("is-crumpling"));
    }
    const step = pitch();
    const max = selected * step;
    const min = -(buttons.length - 1 - selected) * step;
    drag = distance > max ? max + (distance - max) * 0.3
      : distance < min ? min + (distance - min) * 0.3 : distance;
    render();
  });

  window.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    suppressClick = gesture.moved;
    if (!gesture.moved) {
      const releasedButton = document.elementFromPoint(event.clientX, event.clientY)?.closest(".nav-button");
      const index = buttons.indexOf(gesture.button);
      // Commit a tap on release; mobile browsers may omit the compatibility
      // click after a captured swipe. Suppress it when it is emitted.
      suppressClick = true;
      if (index !== -1 && releasedButton === gesture.button) {
        select(index, { focus: true });
      } else {
        stopGesture();
      }
      return;
    }
    const focus = navigation.contains(document.activeElement);
    select(Math.round(selected - drag / pitch()), { focus });
  });

  function cancelGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    suppressClick = gesture.moved;
    stopGesture();
    render();
  }
  window.addEventListener("pointercancel", cancelGesture);
  navigation.addEventListener("lostpointercapture", (event) => {
    // Touch starts with implicit capture on the pressed icon. Transferring
    // capture to the whole carousel must not cancel that ongoing swipe.
    if (event.target === navigation) cancelGesture(event);
  });

  buttons.forEach((button, index) => {
    button.addEventListener("click", (event) => {
      if (suppressClick && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      select(index, { focus: true });
    });
  });

  // Safari can match :focus-visible after focus() in a touch handler. Track
  // input explicitly so taps stay unoutlined and Tab restores keyboard focus.
  document.addEventListener("keydown", (event) => {
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      navigation.dataset.inputMethod = "keyboard";
    }
  }, { capture: true });

  navigation.addEventListener("keydown", (event) => {
    const target = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target, { focus: true });
  });

  new ResizeObserver(() => {
    stopGesture();
    render();
  }).observe(navigation);
  render();

  return {
    setPage(page) {
      const index = buttons.findIndex((button) => button.dataset.target === page);
      if (index !== -1) select(index, { notify: false, animate: false });
    },
  };
}
