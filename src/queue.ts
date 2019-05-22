// Copyright 2019 Ryan Zeigler
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Either, fold, left, right } from "fp-ts/lib/Either";
import { identity, pipeOp } from "fp-ts/lib/function";
import { getOrElse, option } from "fp-ts/lib/Option";
import { pipeable } from "fp-ts/lib/pipeable";
import { Deferred, makeDeferred } from "./deferred";
import { IO, succeed, unit } from "./io";
import { makeRef, Ref } from "./ref";
import { natNumber } from "./sanity";
import { makeSemaphore } from "./semaphore";
import { Dequeue, empty, of } from "./support/dequeue";
import { Fn1, Fn2 } from "./support/types";
import { makeTicket, ticketExit, ticketUse } from "./ticket";

export interface ConcurrentQueue<A> {
  readonly take: IO<never, A>;
  offer(a: A): IO<never, void>;
}

type State<A> = Either<Dequeue<Deferred<never, A>>, Dequeue<A>>;
const initial = <A>(): State<A> => right(empty());

const pipeableOpt = pipeable(option);

class ConcurrentQueueImpl<A> implements ConcurrentQueue<A> {
  public readonly take: IO<never, A>;
  constructor(public readonly state: Ref<State<A>>,
              public readonly factory: IO<never, Deferred<never, A>>,
              public readonly overflowStrategy: Fn2<Dequeue<A>, A, Dequeue<A>>,
              // This is effect that precedes offering
              // in the case of a boudned queue it is responsible for acquiring the semaphore
              public readonly offerGate: IO<never, void>,
              // This is the function that wraps the constructed take IO action
              // In the case of a bounded queue, it is responsible for releasing the semaphore and re-acquiring
              // it on interrupt
              public readonly takeGate: Fn1<IO<never, A>, IO<never, A>>) {
      this.take = takeGate(factory.chain((latch) =>
        this.state.modify((current) =>
          pipeOp(
            current,
            fold(
              (waiting) => [
                makeTicket(latch.wait, this.cleanupLatch(latch)),
                left(waiting.offer(latch)) as State<A>
              ] as const,
              (ready) =>
                pipeOp(
                  ready.take(),
                  pipeableOpt.map(([next, q]) =>
                    [makeTicket(succeed(next), unit), right(q) as State<A>] as const),
                  getOrElse(() => [
                    makeTicket(latch.wait, this.cleanupLatch(latch)),
                    left(of(latch)) as State<A>
                  ] as const)
                )
            )
          )
        ).bracketExit(ticketExit, ticketUse)
      ));
  }
  public offer(a: A): IO<never, void> {
    return this.offerGate.applySecond(this.state.modify((current) =>
      pipeOp(
        current,
        fold(
          (waiting) =>
            pipeOp(
              waiting.take(),
              pipeableOpt.map(([next, q]) => [next.succeed(a), left(q) as State<A>] as const),
              getOrElse(() => [unit, right(this.overflowStrategy(empty(), a)) as State<A>] as const)
            ),
          (available) => [unit, right(this.overflowStrategy(available, a)) as State<A>] as const
        )
      )
    ).flatten().uninterruptible());
  }

  private cleanupLatch(latch: Deferred<never, A>): IO<never, void> {
    return this.state.update((current) =>
      pipeOp(
        current,
        fold(
          (waiting) => left(waiting.filter((item) => item !== latch)),
          (available) => right(available) as State<A>
        )
      )
    ).unit();
  }
}

const unboundedOffer = <A>(queue: Dequeue<A>, a: A): Dequeue<A> => queue.offer(a);

const slidingOffer = (n: number) => <A>(queue: Dequeue<A>, a: A): Dequeue<A> =>
  queue.size() >= n ?
    pipeOp(queue.take(),
      pipeableOpt.map((t) => t[1]),
      getOrElse(() => queue))
    .offer(a) :
    queue.offer(a);

const droppingOffer = (n: number) => <A>(queue: Dequeue<A>, a: A): Dequeue<A> =>
  queue.size() >= n ? queue : queue.offer(a);

export function unboundedQueue<A>(): IO<never, ConcurrentQueue<A>> {
  return makeRef(initial<A>())
    .map((ref) => new ConcurrentQueueImpl(ref, makeDeferred<never, A>(), unboundedOffer, unit, identity));
}

const natCapacity = natNumber(new Error("Die: capacity must be a natural number"));

export function slidingQueue<A>(capacity: number): IO<never, ConcurrentQueue<A>> {
  return natCapacity(capacity)
    .applySecond(
      makeRef(initial<A>())
        .map((ref) => new ConcurrentQueueImpl(ref, makeDeferred<never, A>(), slidingOffer(capacity), unit, identity))
    );
}

export function droppingQueue<A>(capacity: number): IO<never, ConcurrentQueue<A>> {
  return natCapacity(capacity)
    .applySecond(
      makeRef(initial<A>())
        .map((ref) => new ConcurrentQueueImpl(ref, makeDeferred<never, A>(), droppingOffer(capacity), unit, identity))
    );
}

export function boundedQueue<A>(capacity: number): IO<never, ConcurrentQueue<A>> {
  return natCapacity(capacity)
    .applySecond(
      makeRef(initial<A>()).zip(makeSemaphore(capacity))
        .map(([ref, sem]) =>
          new ConcurrentQueueImpl(ref, makeDeferred<never, A>(), unboundedOffer, sem.acquire, (inner) =>
            // Before take, we must release the semaphore. If we are interrupted we should re-acquire the item
            sem.release.bracketExit((_, exit) => exit._tag === "interrupted" ? sem.acquire : unit, (_) => inner)
          )
        )
    );
}
