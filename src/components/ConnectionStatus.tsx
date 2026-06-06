import React from 'react';
import { useTranslation } from '@nekazari/sdk';
import type { ConnectionState } from '../types/zulip';

interface Props {
  state: ConnectionState;
}

const STATUS_STYLES: Record<ConnectionState, { dot: string; textKey: string }> = {
  connected: { dot: 'bg-nkz-success', textKey: 'hub.connected' },
  reconnecting: { dot: 'bg-nkz-warning animate-pulse', textKey: 'hub.reconnecting' },
  error: { dot: 'bg-nkz-danger', textKey: 'hub.disconnected' },
};

const ConnectionStatus: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation('zulip');
  const { dot, textKey } = STATUS_STYLES[state];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-nkz-xs text-nkz-text-muted">{t(textKey)}</span>
    </div>
  );
};

export default ConnectionStatus;
