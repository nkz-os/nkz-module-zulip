import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { Hash, ChevronDown, ChevronUp } from 'lucide-react';
import type { ZulipStream, ZulipMessage, ZulipUnreadCount } from '../types/zulip';
import StreamDetail from './StreamDetail';

interface Props {
  streams: ZulipStream[];
  unreads: ZulipUnreadCount[];
  newMessages: ZulipMessage[];
}

const StreamsPanel: React.FC<Props> = ({ streams, unreads, newMessages }) => {
  const { t } = useTranslation('zulip');
  const [expanded, setExpanded] = useState(true);
  const [openStreamId, setOpenStreamId] = useState<number | null>(null);

  const regularStreams = streams.filter(
    (s) => !s.name.endsWith('-alerts') && s.name !== 'platform-announcements'
  );

  const getUnreadCount = (streamId: number) => {
    return unreads
      .filter((u) => u.stream_id === streamId)
      .reduce((sum, u) => sum + u.unread_message_ids.length, 0);
  };

  return (
    <div className="border border-nkz-border rounded-nkz-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-nkz-canvas hover:bg-nkz-surface-sunken transition-colors"
      >
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-nkz-info" />
          <span className="text-nkz-sm font-semibold text-nkz-text-primary">
            {t('streams.title')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-nkz-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-nkz-text-muted" />
        )}
      </button>
      {expanded && (
        <div className="bg-nkz-surface">
          {regularStreams.length === 0 ? (
            <p className="text-nkz-sm text-nkz-text-muted p-4 text-center">{t('streams.empty')}</p>
          ) : (
            regularStreams.map((stream) => {
              const count = getUnreadCount(stream.stream_id);
              const isOpen = openStreamId === stream.stream_id;
              return (
                <div key={stream.stream_id}>
                  <button
                    onClick={() => setOpenStreamId(isOpen ? null : stream.stream_id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-nkz-canvas transition-colors border-b border-nkz-border last:border-b-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash className="w-3.5 h-3.5 text-nkz-text-muted flex-shrink-0" />
                      <span className="text-nkz-sm text-nkz-text-primary truncate">
                        {stream.name.replace(/^tenant-[^-]+-/, '')}
                      </span>
                    </div>
                    {count > 0 && (
                      <span className="px-1.5 py-0.5 text-nkz-xs font-medium bg-nkz-info text-nkz-text-on-accent rounded-nkz-full flex-shrink-0">
                        {count}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <StreamDetail
                      streamId={stream.stream_id}
                      streamName={stream.name}
                      newMessages={newMessages}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default StreamsPanel;
