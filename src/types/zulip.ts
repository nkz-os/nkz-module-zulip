export interface ZulipStream {
  stream_id: number;
  name: string;
  description: string;
  invite_only: boolean;
  is_muted: boolean;
}

export interface ZulipTopic {
  name: string;
  max_id: number;
}

export interface ZulipMessage {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  avatar_url: string;
  content: string;
  content_type: string;
  timestamp: number;
  stream_id: number;
  subject: string;
  display_recipient: string | ZulipDMRecipient[];
  type: 'stream' | 'private';
  flags: string[];
}

export interface ZulipDMRecipient {
  id: number;
  email: string;
  full_name: string;
}

export interface ZulipUnreadCount {
  stream_id: number;
  topic: string;
  unread_message_ids: number[];
}

export interface ZulipEvent {
  type: string;
  id: number;
  message?: ZulipMessage;
  [key: string]: unknown;
}

export interface ZulipEventQueueResponse {
  queue_id: string;
  last_event_id: number;
  unread_msgs: {
    streams: ZulipUnreadCount[];
    pms: { sender_id: number; unread_message_ids: number[] }[];
    count: number;
  };
}

export type ConnectionState = 'connected' | 'reconnecting' | 'error';
