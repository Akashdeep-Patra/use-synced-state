import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseSyncedStateOptions<T> {
  name?: string;
  serialize?: (value: T) => unknown;
  deserialize?: (value: unknown) => T;
}

type SyncMessage<T> = {
  type: 'STATE_UPDATE';
  payload: T;
  senderId: string;
};

export function useSyncedState<T>(
  key: string,
  initialValue: T | (() => T),
  options: UseSyncedStateOptions<T> = {}
): [T, (value: T | ((prevState: T) => T)) => Promise<void>] {
  const channelName = options.name ?? `synced-state:${key}`;
  const lockName = `lock:${channelName}`;

  const tabIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2)
  );

  const [state, setState] = useState<T>(() => {
    return typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue;
  });

  const stateRef = useRef<T>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
      return;
    }

    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<SyncMessage<T>>) => {
      const data = event.data;

      if (!data || data.type !== 'STATE_UPDATE' || data.senderId === tabIdRef.current) {
        return;
      }

      const nextValue = options.deserialize
        ? options.deserialize(data.payload)
        : data.payload;

      setState(nextValue);
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [channelName, options.deserialize]);

  const setSyncedState = useCallback(
    async (value: T | ((prevState: T) => T)) => {
      const updateFn = async () => {
        const nextState =
          typeof value === 'function'
            ? (value as (prevState: T) => T)(stateRef.current)
            : value;

        setState(nextState);

        if (channelRef.current) {
          const payload = options.serialize
            ? (options.serialize(nextState) as T)
            : nextState;

          const message: SyncMessage<T> = {
            type: 'STATE_UPDATE',
            payload,
            senderId: tabIdRef.current,
          };

          channelRef.current.postMessage(message);
        }
      };

      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        await navigator.locks.request(lockName, { mode: 'exclusive' }, updateFn);
      } else {
        await updateFn();
      }
    },
    [lockName, options.serialize]
  );

  return [state, setSyncedState];
}
