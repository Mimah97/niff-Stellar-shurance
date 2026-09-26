'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config, DriveStep } from 'driver.js';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_COMPLETED_KEY = 'onboarding.tour.completed';

const TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="dashboard"]',
    popover: {
      title: 'Welcome to your dashboard',
      description:
        'This is where you track balances, activity and everything happening in your account.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="purchase"]',
    popover: {
      title: 'Buy crypto',
      description:
        'Start a purchase here. Pick an asset, choose a payment method and confirm the order.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="purchase-method"]',
    popover: {
      title: 'Choose how to pay',
      description:
        'Select a saved payment method or add a new one. You can review fees before confirming.',
      side: 'top',
      align: 'start',
    },
  },
  {
    element: '[data-tour="purchase-confirm"]',
    popover: {
      title: 'Confirm your purchase',
      description:
        'Double-check the amount and fees, then confirm. You can always cancel before this step.',
      side: 'top',
      align: 'start',
    },
  },
];

function hasCompletedTour(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    return window.localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
}

function markTourCompleted(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
  } catch {
    // Storage may be unavailable (private mode); the tour will simply show again.
  }
}

function clearTourCompleted(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(TOUR_COMPLETED_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Restart the onboarding tour from anywhere (e.g. the settings page).
 * Clears the completion flag and dispatches an event the mounted tour listens for.
 */
export function restartOnboardingTour(): void {
  clearTourCompleted();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('onboarding:tour:restart'));
  }
}

export interface OnboardingTourProps {
  /**
   * When true the tour starts automatically on first visit.
   * Defaults to true.
   */
  autoStart?: boolean;
}

/**
 * First-visit guided tour of the dashboard and purchase flow.
 *
 * - Starts automatically on first visit (unless `autoStart` is false).
 * - Can be skipped at any time; skipping marks the tour as completed.
 * - Can be restarted from settings via `restartOnboardingTour()`.
 */
export default function OnboardingTour({ autoStart = true }: OnboardingTourProps) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const [mounted, setMounted] = useState(false);

  const startTour = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Only include steps whose target element is present on the current page.
    const steps = TOUR_STEPS.filter((step) => {
      if (!step.element || typeof step.element !== 'string') {
        return true;
      }
      return document.querySelector(step.element) !== null;
    });

    if (steps.length === 0) {
      return;
    }

    const config: Config = {
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      allowClose: true,
      overlayColor: 'rgba(0, 0, 0, 0.6)',
      steps,
      onDestroyed: () => {
        markTourCompleted();
      },
    };

    driverRef.current?.destroy();
    const tour = driver(config);
    driverRef.current = tour;
    tour.drive();
  }, []);

  useEffect(() => {
    setMounted(true);

    if (autoStart && !hasCompletedTour()) {
      // Defer so target elements have a chance to render.
      const timer = window.setTimeout(startTour, 400);
      return () => window.clearTimeout(timer);
    }
  }, [autoStart, startTour]);

  useEffect(() => {
    const handleRestart = () => {
      startTour();
    };

    window.addEventListener('onboarding:tour:restart', handleRestart);
    return () => {
      window.removeEventListener('onboarding:tour:restart', handleRestart);
    };
  }, [startTour]);

  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return null;
}
