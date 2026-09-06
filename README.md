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

```mermaid
stateDiagram-v2
    [*] --> Tab A
    [*] --> Tab B
    [*] --> Tab C
    
    state "Local State (useState)" as LocalState {
        [*] --> LocalValue
    }
    
    state "Hook Internals" as HookInternals {
        direction LR
        LocalValue --> stateRef[stateRef]
        stateRef --> setState[setState]
        stateRef --> channelRef[BroadcastChannel]
        stateRef --> lock[navigator.locks]
    }
    
    Tab A --> broadcast[A BroadcastChannel postMessage]
    Tab B --> receive{BroadcastChannel onmessage}
    Tab C --> broadcast
    
    Note right of broadcast: payload tagged with senderId
    Note right of receive: ignores own messages
    
    Tab A --> acquire[navigator.locks.request(lockName, 'exclusive')]
    Tab B --> acquire
    Tab C --> acquire
    
    acquire --> update[updateFn: setState + postMessage]
    update --> [*]
    
    state "Functional Updater" as FuncUpdater {
        direction LR
        prev --> next[(prev) => nextState]
    }
    
    FuncUpdater -->|resolves sequentially| acquire
```

**Key Architectural Safeguards:**

- **Race-Condition Exclusion**: `navigator.locks.request()` with exclusive mode ensures only one tab writes at a time. Functional updaters `(prev) => prev + 1` resolve sequentially across all tabs.

- **Instant Fan-Out**: After acquiring the lock, state updates are broadcast via `channel.postMessage()` to all sibling tabs in parallel through browser IPC.

- **Loop Prevention**: Each tab's `crypto.randomUUID()` generates a unique `senderId`. Broadcast listeners filter out messages from their own tab ID, eliminating echo loops.

- **Stale Closure Safety**: The mutable `stateRef` reference ensures functional updaters always evaluate against the latest state value during fast-succession writes, preventing stale closure bugs.

- **Graceful Degradation**: If `BroadcastChannel` or `navigator.locks` are unavailable (SSR, older browsers), the hook falls back to local-only mode without throwing errors.

## Live Demo

See the blog post: [Let's build a custom React hook for cross-tab state synchronization](https://dev.to/mr_mornin_star/let-s-build-a-custom-react-hook-for-cross-tab-state-synchronization)

## License

MIT
