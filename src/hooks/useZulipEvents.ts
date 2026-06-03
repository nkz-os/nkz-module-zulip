import { useEffect, useRef, useCallback, useState } from 'react';
import type { ZulipEvent, ZulipEventQueueResponse, ConnectionState } from '../types/zulip';

const API_BASE = '/api/zulip';

function apiUrl(path: string): string {
  return `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;
}

interface UseZulipEventsOptions {
  onEvent: (event: ZulipEvent) => void;
  onInitialState?: (state: ZulipEventQueueResponse) => void;
  enabled?: boolean;
}

export function useZulipEvents({
  onEvent,
  onInitialState,
  enabled = true,
}: UseZulipEventsOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const queueRef = useRef<{ queueId: string; lastEventId: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const backoffRef = useRef(1000);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback(async () => {
    try {
      // Zulip expects form-encoded POST for /register
      const body = new URLSearchParams({
        event_types: JSON.stringify([
          'message',
          'update_message',
          'subscription',
          'reaction',
        ]),
        apply_markdown: 'true',
        all_public_streams: 'false',
      });

      const resp = await fetch(apiUrl('/events/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!resp.ok) throw new Error(`Register error: ${resp.status}`);
      const data: ZulipEventQueueResponse = await resp.json();

      queueRef.current = { queueId: data.queue_id, lastEventId: data.last_event_id };
      backoffRef.current = 1000;
      setConnectionState('connected');
      onInitialState?.(data);
      return true;
    } catch {
      setConnectionState('error');
      return false;
    }
  }, [onInitialState]);

  const poll = useCallback(async () => {
    if (!queueRef.current || !mountedRef.current) return;

    const { queueId, lastEventId } = queueRef.current;
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({
        queue_id: queueId,
        last_event_id: String(lastEventId),
      });
      const resp = await fetch(apiUrl(`/events?${params}`), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: abortRef.current.signal,
      });

      if (!resp.ok) throw new Error(`Poll error: ${resp.status}`);
      const data: { events: ZulipEvent[] } = await resp.json();

      if (!mountedRef.current) return;

      for (const event of data.events) {
        queueRef.current!.lastEventId = event.id;
        onEvent(event);
      }

      backoffRef.current = 1000;
      setConnectionState('connected');

      if (mountedRef.current) poll();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;

      setConnectionState('reconnecting');

      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current = delay * 2;

      // Clear any existing timer before setting new one
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        if (!mountedRef.current) return;
        const ok = await register();
        if (ok && mountedRef.current) poll();
      }, delay);
    }
  }, [onEvent, register]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setConnectionState('error');
      return;
    }

    (async () => {
      const ok = await register();
      if (ok && mountedRef.current) poll();
    })();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (queueRef.current) {
        const params = new URLSearchParams({ queue_id: queueRef.current.queueId });
        fetch(apiUrl(`/events?${params}`), {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => {});
        queueRef.current = null;
      }
    };
  }, [enabled, register, poll]);

  return { connectionState };
}
