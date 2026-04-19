import { useCallback } from 'react';

const API_BASE = '/api/zulip';

async function zulipFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${window.__ENV__?.VITE_API_URL || ''}${API_BASE}${path}`;
  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
    ...options,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Zulip API error: ${resp.status}`);
  }

  return resp.json();
}

export function useZulipApi() {
  const getStreams = useCallback(() => {
    return zulipFetch<{ streams: import('../types/zulip').ZulipStream[] }>('/streams');
  }, []);

  const getTopics = useCallback((streamId: number) => {
    return zulipFetch<{ topics: import('../types/zulip').ZulipTopic[] }>(
      `/streams/${streamId}/topics`
    );
  }, []);

  const getMessages = useCallback(
    (narrow: Array<{ operator: string; operand: string | number }>, numBefore = 20, numAfter = 0) => {
      const params = new URLSearchParams({
        narrow: JSON.stringify(narrow),
        num_before: String(numBefore),
        num_after: String(numAfter),
        anchor: 'newest',
      });
      return zulipFetch<{ messages: import('../types/zulip').ZulipMessage[] }>(
        `/messages?${params}`
      );
    },
    []
  );

  const sendMessage = useCallback(
    (params: { type: 'stream' | 'direct'; to: string | number[]; topic?: string; content: string }) => {
      return zulipFetch<{ id: number }>('/messages', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    []
  );

  const addReaction = useCallback((messageId: number, emojiName: string) => {
    return zulipFetch(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji_name: emojiName }),
    });
  }, []);

  const getProfile = useCallback(() => {
    return zulipFetch<{ user_id: number; email: string; full_name: string }>('/users/me');
  }, []);

  return { getStreams, getTopics, getMessages, sendMessage, addReaction, getProfile };
}
