import { useEffect, useRef, useCallback, useState } from 'react';
import type { ZulipEvent, ZulipEventQueueResponse, ConnectionState } from '../types/zulip';

const API_BASE = '/api/zulip';

function apiUrl(path: string): string {
  return `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) throw new Error(`Event API error: ${resp.status}`);
  return resp.json();
}

interface UseZulipEventsOptions {
  onEvent: (event: ZulipEvent) => void;
  onInitialState?: (state: ZulipEventQueueResponse) => void;
  enabled?: boolean;
}

export function useZulipEvents({ onEvent, onInitialState, enabled = true }: UseZulipEventsOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const queueRef = useRef<{ queueId: string; lastEventId: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const backoffRef = useRef(1000);

  const register = useCallback(async () => {
    try {
      const data = await fetchJson<ZulipEventQueueResponse>(
        apiUrl('/events/register'),
        {
          method: 'POST',
          body: JSON.stringify({
            event_types: JSON.stringify(['message', 'update_message', 'subscription', 'reaction']),
            apply_markdown: true,
            all_public_streams: false,
          }),
        }
      );
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
      const data = await fetchJson<{ events: ZulipEvent[] }>(
        apiUrl(`/events?${params}`),
        { signal: abortRef.current.signal }
      );

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

      setTimeout(async () => {
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
