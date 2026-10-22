import './i18n';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ExternalLink, MessageCircle } from 'lucide-react';
import type { ZulipStream, ZulipMessage, ZulipUnreadCount, ZulipEvent, ZulipEventQueueResponse } from './types/zulip';
import { useZulipApi } from './hooks/useZulipApi';
import { useZulipEvents } from './hooks/useZulipEvents';
import ConnectionStatus from './components/ConnectionStatus';
import AlertsPanel from './components/AlertsPanel';
import StreamsPanel from './components/StreamsPanel';
import DirectMessagesPanel from './components/DirectMessagesPanel';
import AnnouncementsPanel from './components/AnnouncementsPanel';
import ForumPanel from './components/ForumPanel';

const CommunicationsHub: React.FC = () => {
  const { t } = useTranslation('zulip');
  const { getStreams } = useZulipApi();

  const [streams, setStreams] = useState<ZulipStream[]>([]);
  const [unreads, setUnreads] = useState<ZulipUnreadCount[]>([]);
  const [dmUnreads, setDmUnreads] = useState<{ sender_id: number; unread_message_ids: number[] }[]>([]);
  const [newMessages, setNewMessages] = useState<ZulipMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const newMsgRef = useRef<ZulipMessage[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getStreams();
        setStreams(data.streams);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadingFailed'));
        setLoading(false);
      }
    })();
  }, [getStreams]);

  const onInitialState = useCallback((state: ZulipEventQueueResponse) => {
    setUnreads(state.unread_msgs.streams);
    setDmUnreads(state.unread_msgs.pms);
  }, []);

  const onEvent = useCallback((event: ZulipEvent) => {
    if (event.type === 'message' && event.message) {
      const msg = event.message;
      newMsgRef.current = [...newMsgRef.current, msg];
      setNewMessages([...newMsgRef.current]);
    }
  }, []);

  const { connectionState } = useZulipEvents({
    onEvent,
    onInitialState,
    enabled: !loading && !error,
  });

  const alertsStream = streams.find((s) => s.name.endsWith('-alerts')) || null;
  const announcementsStream = streams.find((s) => s.name === 'platform-announcements') || null;
  const forumStream = streams.find((s) => s.name === 'general-forum') || null;

  const alertMessages = newMessages.filter(
    (m) => m.type === 'stream' && alertsStream && m.stream_id === alertsStream.stream_id
  );
  const announcementMessages = newMessages.filter(
    (m) => m.type === 'stream' && announcementsStream && m.stream_id === announcementsStream.stream_id
  );
  const streamMessages = newMessages.filter(
    (m) =>
      m.type === 'stream' &&
      (!alertsStream || m.stream_id !== alertsStream.stream_id) &&
      (!announcementsStream || m.stream_id !== announcementsStream.stream_id) &&
      (!forumStream || m.stream_id !== forumStream.stream_id)
  );
  const dmMessages = newMessages.filter((m) => m.type === 'private');

  const zulipUrl = window.__ENV__?.VITE_ZULIP_URL || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-nkz-canvas">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-nkz-info border-t-transparent rounded-nkz-full mx-auto mb-3" />
          <p className="text-nkz-sm text-nkz-text-muted">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-nkz-canvas">
        <div className="text-center p-8">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-nkz-text-muted" />
          <p className="text-nkz-text-secondary mb-2">{t('connectionError')}</p>
          <p className="text-nkz-sm text-nkz-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-nkz-canvas">
      <div className="flex items-center justify-between px-4 py-2.5 bg-nkz-surface border-b border-nkz-border shadow-nkz-sm">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-nkz-info" />
          <h1 className="text-nkz-base font-semibold text-nkz-text-primary">
            {t('title')}
          </h1>
          <ConnectionStatus state={connectionState} />
        </div>
        {zulipUrl && (
          <a
            href={zulipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nkz-xs flex items-center gap-1 text-nkz-info hover:text-nkz-info-strong font-medium px-3 py-1.5 rounded-nkz-md hover:bg-nkz-info-soft transition-colors"
          >
            {t('hub.openFull')}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <AlertsPanel alertsStream={alertsStream} newMessages={alertMessages} />
        <StreamsPanel streams={streams} unreads={unreads} newMessages={streamMessages} />
        <ForumPanel forumStream={forumStream} newMessages={newMessages} />
        <DirectMessagesPanel dmUnreads={dmUnreads} newMessages={dmMessages} />
        <AnnouncementsPanel announcementsStream={announcementsStream} newMessages={announcementMessages} />

        <p className="text-center text-nkz-xs text-nkz-text-muted py-2">
          {t('poweredBy')}
        </p>
      </div>
    </div>
  );
};

export default CommunicationsHub;
