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
        setError(err instanceof Error ? err.message : 'Failed to load');
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
      (!announcementsStream || m.stream_id !== announcementsStream.stream_id)
  );
  const dmMessages = newMessages.filter((m) => m.type === 'private');

  const zulipUrl = window.__ENV__?.VITE_ZULIP_URL || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-50 dark:bg-slate-900">
        <div className="text-center p-8">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <p className="text-slate-600 dark:text-slate-400 mb-2">{t('connectionError')}</p>
          <p className="text-sm text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-slate-50 dark:bg-slate-900">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {t('title')}
          </h1>
          <ConnectionStatus state={connectionState} />
        </div>
        {zulipUrl && (
          <a
            href={zulipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            {t('hub.openFull')}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <AlertsPanel alertsStream={alertsStream} newMessages={alertMessages} />
        <StreamsPanel streams={streams} unreads={unreads} newMessages={streamMessages} />
        <DirectMessagesPanel dmUnreads={dmUnreads} newMessages={dmMessages} />
        <AnnouncementsPanel announcementsStream={announcementsStream} newMessages={announcementMessages} />

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-2">
          {t('poweredBy')}
        </p>
      </div>
    </div>
  );
};

export default CommunicationsHub;
