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

function getBroadcastChannel(): typeof BroadcastChannel | null {
  if (typeof globalThis === 'undefined' || !('BroadcastChannel' in globalThis)) {
    return null;
  }
  return globalThis.BroadcastChannel as typeof BroadcastChannel;
}

function getNavigatorLocks(): Navigator['locks'] | null {
  if (typeof globalThis === 'undefined' || !('navigator' in globalThis)) {
    return null;
  }
  const nav = globalThis.navigator as Navigator;
  return 'locks' in nav ? nav.locks : null;
}

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
  const applyQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const BroadcastChannelImpl = getBroadcastChannel();
    if (!BroadcastChannelImpl) {
      return;
    }

    const channel = new BroadcastChannelImpl(channelName);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<SyncMessage<T>>) => {
      const data = event.data;

      if (!data || data.type !== 'STATE_UPDATE' || data.senderId === tabIdRef.current) {
        return;
      }

      const nextValue = options.deserialize
        ? options.deserialize(data.payload)
        : (data.payload as T);

      applyQueueRef.current = applyQueueRef.current.then(() => {
        stateRef.current = nextValue;
        setState(nextValue);
      });
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [channelName, options.deserialize]);

  const setSyncedState = useCallback(
    async (value: T | ((prevState: T) => T)) => {
      const updateFn = async () => {
        // Wait for any in-flight cross-tab messages to apply before reading state
        await applyQueueRef.current;

        const nextState =
          typeof value === 'function'
            ? (value as (prevState: T) => T)(stateRef.current)
            : value;

        stateRef.current = nextState;
        setState(nextState);

        if (channelRef.current) {
          const payload = options.serialize
            ? options.serialize(nextState)
            : nextState;

          const message: SyncMessage<T> = {
            type: 'STATE_UPDATE',
            payload: payload as T,
            senderId: tabIdRef.current,
          };

          channelRef.current.postMessage(message);
        }
      };

      const locks = getNavigatorLocks();
      if (locks) {
        await locks.request(lockName, { mode: 'exclusive' }, updateFn);
      } else {
        await updateFn();
      }
    },
    [lockName, options.serialize]
  );

  return [state, setSyncedState];
}
