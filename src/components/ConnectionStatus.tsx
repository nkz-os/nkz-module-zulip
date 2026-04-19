import React from 'react';
import { useTranslation } from '@nekazari/sdk';
import type { ConnectionState } from '../types/zulip';

interface Props {
  state: ConnectionState;
}

const STATUS_STYLES: Record<ConnectionState, { dot: string; textKey: string }> = {
  connected: { dot: 'bg-green-500', textKey: 'hub.connected' },
  reconnecting: { dot: 'bg-yellow-500 animate-pulse', textKey: 'hub.reconnecting' },
  error: { dot: 'bg-red-500', textKey: 'hub.disconnected' },
};

const ConnectionStatus: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation('zulip');
  const { dot, textKey } = STATUS_STYLES[state];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-xs text-slate-500 dark:text-slate-400">{t(textKey)}</span>
    </div>
  );
};

export default ConnectionStatus;
