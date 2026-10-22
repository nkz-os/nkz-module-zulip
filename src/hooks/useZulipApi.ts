import { useCallback } from 'react';

const API_BASE = '/api/zulip';

// ------------------------------------------------------------------
// Header merge helper — handles Headers objects correctly
// ------------------------------------------------------------------
function mergeHeaders(
  defaults: Record<string, string>,
  extra?: HeadersInit,
): Record<string, string> {
  const result = { ...defaults };
  if (!extra) return result;
  if (extra instanceof Headers) {
    extra.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(extra)) {
    for (const [key, value] of extra) {
      result[key.toLowerCase()] = value;
    }
  } else {
    for (const key of Object.keys(extra)) {
      result[key.toLowerCase()] = (extra as Record<string, string>)[key];
    }
  }
  return result;
}

// ------------------------------------------------------------------
// Core fetch wrapper — form-encoded by default, JSON for GET
// ------------------------------------------------------------------
async function zulipFetch<T>(
  path: string,
  options: RequestInit = {},
  contentType: 'json' | 'form' = 'form',
): Promise<T> {
  const url = `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;

  const headers = mergeHeaders(
    contentType === 'json'
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/x-www-form-urlencoded' },
    options.headers,
  );

  const resp = await fetch(url, {
    credentials: 'include',
    headers,
    ...options,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || body.msg || `Zulip API error: ${resp.status}`);
  }

  return resp.json();
}

// ------------------------------------------------------------------
// Hook
// ------------------------------------------------------------------
export function useZulipApi() {
  const getStreams = useCallback(() => {
    return zulipFetch<{ streams: import('../types/zulip').ZulipStream[] }>(
      '/streams',
      {},
      'json',
    );
  }, []);

  const getTopics = useCallback((streamId: number) => {
    return zulipFetch<{ topics: import('../types/zulip').ZulipTopic[] }>(
      `/streams/${streamId}/topics`,
      {},
      'json',
    );
  }, []);

  const getMessages = useCallback(
    (
      narrow: Array<{ operator: string; operand: string | number }>,
      numBefore = 20,
      numAfter = 0,
    ) => {
      const params = new URLSearchParams({
        narrow: JSON.stringify(narrow),
        num_before: String(numBefore),
        num_after: String(numAfter),
        anchor: 'newest',
      });
      return zulipFetch<{ messages: import('../types/zulip').ZulipMessage[] }>(
        `/messages?${params}`,
        {},
        'json',
      );
    },
    [],
  );

  const sendMessage = useCallback(
    (params: {
      type: 'stream' | 'direct';
      to: string | number[];
      topic?: string;
      content: string;
    }) => {
      const body = new URLSearchParams({
        type: params.type,
        to: typeof params.to === 'string' ? params.to : JSON.stringify(params.to),
        content: params.content,
      });
      if (params.topic) body.set('topic', params.topic);
      return zulipFetch<{ id: number }>('/messages', {
        method: 'POST',
        body,
      });
    },
    [],
  );

  const addReaction = useCallback((messageId: number, emojiName: string) => {
    const body = new URLSearchParams({ emoji_name: emojiName });
    return zulipFetch(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body,
    });
  }, []);

  const getProfile = useCallback(() => {
    return zulipFetch<{ user_id: number; email: string; full_name: string }>(
      '/users/me',
      {},
      'json',
    );
  }, []);

  return { getStreams, getTopics, getMessages, sendMessage, addReaction, getProfile };
}
