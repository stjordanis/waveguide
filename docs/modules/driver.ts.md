---
title: driver.ts
nav_order: 3
parent: Modules
---

---

<h2 class="text-delta">Table of contents</h2>

- [Driver (interface)](#driver-interface)
- [FrameType (type alias)](#frametype-type-alias)
- [RegionFrameType (type alias)](#regionframetype-type-alias)
- [makeDriver (function)](#makedriver-function)

---

# Driver (interface)

**Signature**

```ts
export interface Driver<E, A> {
  start(run: Wave<E, A>): void
  interrupt(): void
  onExit(f: FunctionN<[Exit<E, A>], void>): Lazy<void>
  exit(): Option<Exit<E, A>>
}
```

# FrameType (type alias)

**Signature**

```ts
export type FrameType = Frame | FoldFrame | RegionFrameType
```

# RegionFrameType (type alias)

**Signature**

```ts
export type RegionFrameType = InterruptFrame
```

# makeDriver (function)

**Signature**

```ts
export function makeDriver<E, A>(runtime: Runtime = defaultRuntime): Driver<E, A> { ... }
```
