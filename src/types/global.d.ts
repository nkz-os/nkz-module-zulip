declare interface Window {
  __NKZ__?: {
    register: (config: {
      id: string;
      viewerSlots?: Record<string, unknown>;
      main?: React.ComponentType;
      version?: string;
    }) => void;
  };
  __ENV__?: {
    VITE_ZULIP_URL?: string;
    VITE_API_URL?: string;
    [key: string]: string | undefined;
  };
}

declare module '*.json' {
  const value: Record<string, string>;
  export default value;
}
