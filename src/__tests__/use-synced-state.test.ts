import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { JSDOM } from 'jsdom';
import { renderHook, act } from '@testing-library/react';
import { useSyncedState } from '../index';

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = window;
(globalThis as any).document = window.document;
(globalThis as any).HTMLElement = window.HTMLElement;

let originalBroadcastChannel: typeof BroadcastChannel | undefined;
let originalCrypto: Crypto | undefined;
let originalNavigator: Navigator | undefined;
let tabIdCounter = 0;
let channels: MockChannel[] = [];
const channelRegistry = new Map<string, MockChannel[]>();
let lockQueue = Promise.resolve();

class MockChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;

  constructor(name: string) {
    this.name = name;
    this.postMessage = mock((msg: unknown) => {
      const peers = channelRegistry.get(name) ?? [];
      for (const peer of peers) {
        if (peer !== this && peer.onmessage) {
          peer.onmessage({ data: msg } as MessageEvent);
        }
      }
    });
    this.close = mock(() => {
      const peers = channelRegistry.get(name) ?? [];
      channelRegistry.set(
        name,
        peers.filter((peer) => peer !== this)
      );
    });

    if (!channelRegistry.has(name)) {
      channelRegistry.set(name, []);
    }
    channelRegistry.get(name)!.push(this);
    channels.push(this);
  }
}

function setupGlobals() {
  originalBroadcastChannel = globalThis.BroadcastChannel;
  originalCrypto = globalThis.crypto;
  originalNavigator = globalThis.navigator;
  tabIdCounter = 0;
  channels = [];
  channelRegistry.clear();
  lockQueue = Promise.resolve();

  const MockChannelConstructor = MockChannel as unknown as typeof BroadcastChannel;
  globalThis.BroadcastChannel = MockChannelConstructor;
  (window as any).BroadcastChannel = MockChannelConstructor;

  globalThis.crypto = {
    randomUUID: () => `tab-${++tabIdCounter}`,
  } as Crypto;

  globalThis.navigator = {
    locks: {
      request: mock(async (_name: string, _opts: unknown, fn: () => Promise<void>) => {
        const run = lockQueue.then(() => fn());
        lockQueue = run.then(() => undefined, () => undefined);
        await run;
      }),
    },
  } as Navigator;
}

function restoreGlobals() {
  if (originalBroadcastChannel) {
    globalThis.BroadcastChannel = originalBroadcastChannel;
    (window as any).BroadcastChannel = originalBroadcastChannel;
  }
  if (originalCrypto) globalThis.crypto = originalCrypto;
  if (originalNavigator) globalThis.navigator = originalNavigator;
  channelRegistry.clear();
  channels = [];
}

describe('useSyncedState — Core Behavior', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('returns initial value', () => {
    const { result } = renderHook(() => useSyncedState('test-key', 42));
    expect(result.current[0]).toBe(42);
  });

  test('supports functional initializer', () => {
    const { result } = renderHook(() => useSyncedState('test-key', () => ({ count: 0 })));
    expect(result.current[0]).toEqual({ count: 0 });
  });

  test('setSyncedState is async and updates state', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1](5);
    });
    expect(result.current[0]).toBe(5);
  });

  test('functional updater accumulates', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1]((prev) => prev + 1);
      await result.current[1]((prev) => prev + 1);
      await result.current[1]((prev) => prev + 1);
    });
    expect(result.current[0]).toBe(3);
  });

  test('direct value updates work sequentially', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1](100);
      await result.current[1](200);
    });
    expect(result.current[0]).toBe(200);
  });

  test('object state with functional updater', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', { count: 0 }));
    await act(async () => {
      await result.current[1]((prev) => ({ ...prev, count: prev.count + 1 }));
    });
    expect(result.current[0].count).toBe(1);
  });
});

describe('useSyncedState — Options', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('custom channel name via options.name', () => {
    renderHook(() => useSyncedState('my-key', 'val', { name: 'custom-prefix' }));
    expect(channels[0].name).toBe('custom-prefix');
  });

  test('default channel name uses synced-state: prefix', () => {
    renderHook(() => useSyncedState('sync-test', 'value'));
    expect(channels[0].name).toBe('synced-state:sync-test');
  });

  test('serialize/deserialize options', async () => {
    const serialize = mock((val: { data: string }) => JSON.stringify(val));
    const deserialize = mock((val: unknown) => JSON.parse(val as string) as { data: string });

    const { result } = renderHook(() =>
      useSyncedState('test-key', { data: 'hello' }, { serialize, deserialize })
    );

    await act(async () => {
      await result.current[1]({ data: 'world' });
    });

    expect(serialize).toHaveBeenCalledWith({ data: 'world' });
  });
});

describe('useSyncedState — Cross-Tab Broadcasting', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('each tab instance gets its own channel on the same name', () => {
    renderHook(() => useSyncedState('sync-test', 'hello'));
    renderHook(() => useSyncedState('sync-test', 'world'));
    expect(channels.length).toBe(2);
    expect(channels[0].name).toBe('synced-state:sync-test');
    expect(channels[1].name).toBe('synced-state:sync-test');
  });

  test('syncs state from one tab to another', async () => {
    const tabA = renderHook(() => useSyncedState('sync-test', 0));
    const tabB = renderHook(() => useSyncedState('sync-test', 0));

    await act(async () => {
      await tabA.result.current[1](42);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(tabB.result.current[0]).toBe(42);
  });

  test('ignores own broadcast messages via senderId', async () => {
    const { result } = renderHook(() => useSyncedState('sync-test', 'initial'));
    const channel = channels[0];

    await act(async () => {
      channel.onmessage?.({
        data: { type: 'STATE_UPDATE', payload: 'self-echo', senderId: 'tab-1' },
      } as MessageEvent);
    });

    expect(result.current[0]).toBe('initial');
  });

  test('processes messages from other tabs', async () => {
    const { result } = renderHook(() => useSyncedState('sync-test', 'initial'));
    const channel = channels[0];

    await act(async () => {
      channel.onmessage?.({
        data: { type: 'STATE_UPDATE', payload: 'synced', senderId: 'tab-99' },
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(result.current[0]).toBe('synced');
  });

  test('filters non-STATE_UPDATE messages', async () => {
    const { result } = renderHook(() => useSyncedState('sync-test', 'initial'));
    const channel = channels[0];

    await act(async () => {
      channel.onmessage?.({
        data: { type: 'PING', payload: 'heartbeat' },
      } as MessageEvent);
    });

    expect(result.current[0]).toBe('initial');
  });

  test('handles null data gracefully', async () => {
    const { result } = renderHook(() => useSyncedState('sync-test', 'initial'));
    const channel = channels[0];

    await act(async () => {
      channel.onmessage?.({ data: null } as MessageEvent);
      channel.onmessage?.({ data: undefined } as MessageEvent);
    });

    expect(result.current[0]).toBe('initial');
  });
});

describe('useSyncedState — navigator.locks Integration', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('acquires exclusive lock on write', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1](5);
    });
    expect(globalThis.navigator.locks.request).toHaveBeenCalled();
  });

  test('concurrent writes each go through the lock', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1](1);
      await result.current[1](2);
      await result.current[1](3);
    });
    expect(result.current[0]).toBe(3);
  });
});

describe('useSyncedState — Race-Condition Safety', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('multiple concurrent setSyncedState calls are serialized in one tab', async () => {
    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await Promise.all([
        result.current[1]((prev) => prev + 1),
        result.current[1]((prev) => prev + 1),
        result.current[1]((prev) => prev + 1),
      ]);
    });
    expect(result.current[0]).toBe(3);
  });

  test('cross-tab increments resolve to 2', async () => {
    const tabA = renderHook(() => useSyncedState('race-key', 0));
    const tabB = renderHook(() => useSyncedState('race-key', 0));

    await act(async () => {
      await Promise.all([
        tabA.result.current[1]((prev) => prev + 1),
        tabB.result.current[1]((prev) => prev + 1),
      ]);
      await Promise.resolve();
    });

    expect(tabA.result.current[0]).toBe(2);
    expect(tabB.result.current[0]).toBe(2);
  });
});

describe('useSyncedState — SSR Graceful Degradation', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('works without BroadcastChannel', async () => {
    delete (globalThis as any).BroadcastChannel;
    delete (window as any).BroadcastChannel;

    const { result } = renderHook(() => useSyncedState('test-key', 42));
    expect(result.current[0]).toBe(42);

    await act(async () => {
      await result.current[1](99);
    });
    expect(result.current[0]).toBe(99);
  });

  test('works without navigator.locks', async () => {
    delete (globalThis as any).navigator;

    const { result } = renderHook(() => useSyncedState('test-key', 0));
    await act(async () => {
      await result.current[1](5);
    });
    expect(result.current[0]).toBe(5);
  });

  test('works without crypto.randomUUID', () => {
    globalThis.crypto = { randomUUID: undefined as unknown as () => string } as Crypto;
    const { result } = renderHook(() => useSyncedState('test-key', 'hello'));
    expect(result.current[0]).toBe('hello');
  });
});

describe('useSyncedState — Cleanup', () => {
  beforeEach(() => setupGlobals());
  afterEach(() => restoreGlobals());

  test('BroadcastChannel.close is called on unmount', () => {
    const { unmount } = renderHook(() => useSyncedState('test-key', 'val'));
    expect(channels.length).toBe(1);
    unmount();
    expect(channels[0].close).toHaveBeenCalled();
  });
});
