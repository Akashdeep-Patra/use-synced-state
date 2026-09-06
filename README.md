# use-synced-state

[![npm](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/Akashdeep-Patra/use-synced-state)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](https://github.com/Akashdeep-Patra/use-synced-state/blob/main/LICENSE)

Production-ready React custom hook for synchronized cross-tab state management. Combines **BroadcastChannel** for zero-latency fan-out state syncing with **navigator.locks** for deterministic write coordination and race-condition safety.

## Installation

```bash
bun add use-synced-state
```

Or copy the hook directly into your project.

## Usage

```tsx
import { useSyncedState } from 'use-synced-state';

function Dashboard() {
  const [count, setCount] = useSyncedState('my-key', 0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount((prev) => prev + 1)}>
        Increment
      </button>
    </div>
  );
}
```

When you click the button in one tab, every other open tab updates instantly.

## API

```ts
function useSyncedState<T>(
  key: string,
  initialValue: T | (() => T),
  options?: UseSyncedStateOptions<T>
): [T, (value: T | ((prevState: T) => T)) => Promise<void>]
```

### Options

| Option | Description |
|---|---|
| `name` | Custom channel/lock prefix |
| `serialize` | Custom serialization function |
| `deserialize` | Custom deserialization function |

## Architecture

- **Race-Condition Exclusion** (`navigator.locks`): Every write acquires an exclusive mutex, ensuring functional updaters resolve sequentially across all tabs.
- **Instant Fan-Out** (`BroadcastChannel`): State updates are broadcast to every listening context in parallel via browser IPC.
- **Loop Prevention** (`senderId`): Each tab has a unique ID (`crypto.randomUUID()`). Outgoing messages are tagged and incoming messages from the same tab are ignored.
- **Stale Closure Safety** (`stateRef`): A mutable reference ensures functional updaters always evaluate against the latest values.
- **Browser Graceful Degradation**: Falls back to local-only mode when `BroadcastChannel` or `navigator.locks` are unavailable (e.g., SSR environments).

## Live Demo

See the blog post: [Let's build a custom React hook for cross-tab state synchronization](https://dev.to/mr_mornin_star/let-s-build-a-custom-react-hook-for-cross-tab-state-synchronization)

## License

MIT
