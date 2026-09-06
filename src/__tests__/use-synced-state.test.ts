import { describe, test, expect, beforeEach } from 'bun:test';
import { useSyncedState } from './index';

describe('useSyncedState', () => {
  test('returns initial value', () => {
    const result = useSyncedState('test-key', 42);
    expect(result[0]).toBe(42);
  });

  test('supports functional initializer', () => {
    const result = useSyncedState('test-key', () => ({ count: 0 }));
    expect(result[0]).toEqual({ count: 0 });
  });

  test('setSyncedState is async', async () => {
    const result = useSyncedState('test-key', 0);
    const setFn = result[1];
    expect(typeof setFn).toBe('function');
    await setFn(5);
    expect(result[0]).toBe(5);
  });

  test('supports functional updater', async () => {
    const result = useSyncedState('test-key', 0);
    const setFn = result[1];
    await setFn((prev) => prev + 1);
    expect(result[0]).toBe(1);
  });

  test('custom options work', () => {
    const result = useSyncedState('test-key', 'hello', {
      name: 'custom-channel',
      serialize: (val) => JSON.stringify(val),
      deserialize: (val) => JSON.parse(val as string),
    });
    expect(result[0]).toBe('hello');
  });

  test('BroadcastChannel integration exists when available', () => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const result = useSyncedState('sync-test', 'value');
      expect(result[0]).toBe('value');
    }
  });
});
