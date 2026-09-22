import { useEffect } from 'react';
import { retryDelay } from '../../lib/navigation';
import { PartyError } from './api';

export function usePolling(
  enabled: boolean,
  poll: (signal: AbortSignal) => Promise<{ stop?: boolean; delay?: number } | void>,
  onError: (error: unknown) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    let failures = 0;
    let nextAt = 0;

    const schedule = (delay: number) => {
      nextAt = Date.now() + delay;
      if (!document.hidden) timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (controller.signal.aborted || document.hidden || stopped || running) return;
      running = true;
      let delay = 3000;
      try {
        const result = await poll(controller.signal);
        failures = 0;
        stopped = result?.stop ?? false;
        delay = result?.delay ?? 3000;
      } catch (error) {
        if (!controller.signal.aborted) {
          onError(error);
          failures++;
          delay = retryDelay(failures, error instanceof PartyError ? error.retryAfterMs : 0);
          stopped = error instanceof PartyError && [401, 403, 404, 410].includes(error.status);
        }
      } finally {
        running = false;
        if (!stopped && !controller.signal.aborted) schedule(delay);
      }
    };
    const visible = () => {
      clearTimeout(timer);
      if (!document.hidden && !running && !stopped) timer = setTimeout(tick, Math.max(0, nextAt - Date.now()));
    };
    document.addEventListener('visibilitychange', visible);
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, poll, onError]);
}
