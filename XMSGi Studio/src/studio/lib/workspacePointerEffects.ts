import type { PointerEvent } from 'react';

type IconRimMotion = {
  currentAngle: number;
  targetAngle: number;
  lastFrameTime: number | null;
  frameId: number | null;
  fadeFrameId: number | null;
  currentGlowStrength: number;
  currentBeamSpread: number;
};

const iconRimMotions = new WeakMap<HTMLButtonElement, IconRimMotion>();
const ICON_RIM_MAX_SPEED = 420;
const ICON_RIM_CENTER_DEAD_ZONE = 3;
const ICON_GLOW_ACTIVATION_DISTANCE = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function updateGlassPointer(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
}

export function clearGlassPointer(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.removeProperty('--pointer-x');
  event.currentTarget.style.removeProperty('--pointer-y');
  event.currentTarget.style.removeProperty('--beam-x');
  event.currentTarget.style.removeProperty('--beam-y');
  event.currentTarget.style.removeProperty('--beam-shift-x');
  event.currentTarget.style.removeProperty('--beam-shift-y');
  event.currentTarget.style.setProperty('--glow-strength', '0');
  event.currentTarget.style.setProperty('--beam-spread', '0.35');
  event.currentTarget.style.setProperty('--rim-angle', '0deg');
}

export function clearIconRimPointer(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;

  const button = event.currentTarget;
  let motion = iconRimMotions.get(button);

  if (!motion) {
    motion = {
      currentAngle: 0,
      targetAngle: 0,
      lastFrameTime: null,
      frameId: null,
      fadeFrameId: null,
      currentGlowStrength: 0,
      currentBeamSpread: 0.35,
    };
    iconRimMotions.set(button, motion);
  }

  if (motion.frameId !== null) {
    window.cancelAnimationFrame(motion.frameId);
    motion.frameId = null;
    motion.lastFrameTime = null;
  }

  if (motion.fadeFrameId !== null) {
    window.cancelAnimationFrame(motion.fadeFrameId);
    motion.fadeFrameId = null;
  }

  motion.currentGlowStrength = Number(button.style.getPropertyValue('--glow-strength') || motion.currentGlowStrength || 0);
  motion.currentBeamSpread = Number(button.style.getPropertyValue('--beam-spread') || motion.currentBeamSpread || 0.35);

  const fadeDurationMs = 520;
  let fadeStartTime: number | null = null;

  const animateFadeOut = (timestamp: number) => {
    if (fadeStartTime === null) {
      fadeStartTime = timestamp;
    }

    const elapsed = timestamp - fadeStartTime;
    const progress = Math.min(elapsed / fadeDurationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const glowStrength = motion!.currentGlowStrength * (1 - eased);
    const beamSpread = motion!.currentBeamSpread + (0.35 - motion!.currentBeamSpread) * (1 - eased);

    button.style.setProperty('--glow-strength', glowStrength.toFixed(3));
    button.style.setProperty('--beam-spread', beamSpread.toFixed(3));
    button.style.setProperty('--rim-opacity', (Math.max(glowStrength, 0) * 0.9).toFixed(3));

    if (progress < 1) {
      motion!.fadeFrameId = window.requestAnimationFrame(animateFadeOut);
      return;
    }

    button.style.setProperty('--glow-strength', '0');
    button.style.setProperty('--beam-spread', '0.35');
    button.style.setProperty('--rim-angle', '0deg');
    button.style.setProperty('--rim-opacity', '0');
    motion!.fadeFrameId = null;
  };

  motion.fadeFrameId = window.requestAnimationFrame(animateFadeOut);
}

export function updateIconRimPointer(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch') return;

  const button = event.currentTarget;
  const bounds = button.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const pointerX = clamp(x, 0, bounds.width);
  const pointerY = clamp(y, 0, bounds.height);
  const offsetX = pointerX - bounds.width / 2;
  const offsetY = pointerY - bounds.height / 2;

  const distanceToEdge = Math.min(
    pointerX,
    bounds.width - pointerX,
    pointerY,
    bounds.height - pointerY,
  );
  const glowStrength = clamp(
    (ICON_GLOW_ACTIVATION_DISTANCE - Math.max(distanceToEdge, 0)) / ICON_GLOW_ACTIVATION_DISTANCE,
    0,
    1,
  );
  const beamSpread = 0.7 + glowStrength * 1.8;
  event.currentTarget.style.setProperty('--pointer-x', `${pointerX}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${pointerY}px`);
  event.currentTarget.style.setProperty('--glow-strength', glowStrength.toFixed(3));
  event.currentTarget.style.setProperty('--beam-spread', beamSpread.toFixed(3));
  event.currentTarget.style.setProperty('--rim-opacity', (glowStrength * 0.9).toFixed(3));

  if (Math.hypot(offsetX, offsetY) < ICON_RIM_CENTER_DEAD_ZONE) return;

  const rimAngle = Math.atan2(offsetY, offsetX) * 180 / Math.PI + 90;
  let motion = iconRimMotions.get(button);

  if (!motion) {
    motion = {
      currentAngle: rimAngle,
      targetAngle: rimAngle,
      lastFrameTime: null,
      frameId: null,
      fadeFrameId: null,
      currentGlowStrength: glowStrength,
      currentBeamSpread: beamSpread,
    };
    iconRimMotions.set(button, motion);
    button.style.setProperty('--rim-angle', `${rimAngle}deg`);
    return;
  }

  motion.targetAngle = rimAngle;
  motion.currentGlowStrength = glowStrength;
  motion.currentBeamSpread = beamSpread;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (motion.frameId !== null) window.cancelAnimationFrame(motion.frameId);
    motion.currentAngle = motion.targetAngle;
    motion.lastFrameTime = null;
    motion.frameId = null;
    button.style.setProperty('--rim-angle', `${motion.currentAngle}deg`);
    return;
  }

  if (motion.frameId !== null) return;

  const animateRim = (timestamp: number) => {
    const elapsed = motion?.lastFrameTime === null
      ? 16
      : Math.min(timestamp - motion.lastFrameTime, 18);
    motion!.lastFrameTime = timestamp;

    const rawDifference = motion!.targetAngle - motion!.currentAngle;
    const difference = ((rawDifference + 540) % 360) - 180;
    const easedStep = difference * (1 - Math.exp(-elapsed / 26));
    const maxStep = ICON_RIM_MAX_SPEED * elapsed / 1000;
    const step = Math.sign(difference || 1) * Math.min(Math.abs(easedStep), maxStep);
    motion!.currentAngle += step;

    if (Math.abs(difference) < 0.45) {
      motion!.currentAngle = motion!.targetAngle;
      motion!.frameId = null;
      motion!.lastFrameTime = null;
    } else {
      motion!.frameId = window.requestAnimationFrame(animateRim);
    }

    button.style.setProperty('--rim-angle', `${motion!.currentAngle}deg`);
  };

  motion.frameId = window.requestAnimationFrame(animateRim);
}
