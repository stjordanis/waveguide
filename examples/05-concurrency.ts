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

import { pipe } from "fp-ts/lib/pipeable";
import * as wave from "../src/wave";
import * as waver from "../src/waver";
import * as managed from "../src/managed";
import * as consoleIO from "../src/console";
import * as https from "https";

/**
 * waveguide also has support for concurrency where it is possible to execute 2 IOs in parallel.
 * This can be done for a number of reasons.
 * 
 * Let us suppose that you are interested in the result of both IOs but they can proceed in parallel.
 * For this exercise we will "benchmark" google and bing and see which one can respond to a search result faster.
 * Lets start by writing a little timing helper
 * We want a way of getting the current time
 */
const now = waver.encaseWave(wave.sync(() => process.hrtime.bigint()));

/**
 * We also want a way of wrapping an IO so that we can see how long its execution took
 */
function time<R, E, O>(io: WaveR<R, E, O>): WaveR<R, E, readonly [O, bigint]> {
  // zipWith, zip happen in order with no parallelism
  return waver.zipWith(
    waver.contravaryR(now),
    waver.zip(io, waver.contravaryR(now)),
    (start, [o, end]) => [o, end - start] as const
  );
}

/**
 * Also, recall the implementation of fetch that we had in 03-environment.ts
 */
import { fetch, agent } from "./common";
import { WaveR } from "../src/waver";

interface Info {host: string; q: string}
type TimeInfo = readonly [ Info, bigint ];
type CompareInfo = readonly [ TimeInfo, TimeInfo ];

function compare(q: string): WaveR<https.Agent, Error, CompareInfo> {
  // We time the query
  const google = time(
    // We don't care so much about what the body is, just the host so we use as to coerce
    waver.as(
      fetch(`https://www.google.com/search?q=${q}`), 
      {host: "google", q}
    )
  );

  const bing = time(
    waver.as(
      fetch(`https://www.bing.com/search?q=${q}`),
      {host: "bing", q}
    )
  );
    // Now that we have both queries for our benchmark we can run them both to get the winner
    // We use parZip instead of zip
    // There are parallel versions of many combinators like zip, zipWith, applyFirst, applySecond, etc.
    // We also add an onInterrupted action which will be useful later
  return waver.onInterrupted(
    waver.parZip(google, bing), 
    waver.encaseWaveR(consoleIO.log(`cancelling comparison of ${q}`))
  );
}


const rt: WaveR<https.Agent, Error, void> =
    pipe(
      compare("referential+transparency"),
      waver.chainWith((results): WaveR<https.Agent, Error, void> => {
        const l = consoleIO.log(`${results[0][0].host} took ${results[0][1]}, ${results[1][0].host} took ${results[1][1]}`);
        const w = waver.encaseWave(l);
        return w;
      })
    );

const versus = managed.provideTo(agent as managed.Managed<Error, https.Agent>, rt)


/**
 * It is also possible to race many fibers in parallel so that we only get the first one completed
 * 
 */
const firstVersusIO = ["referential+transparency", "monad", "functor", "haskell", "scala", "purescript", "lenses"]
  .map(compare)
// When we race IOs, the loser is automatically cancelled immediately
  .reduce((left, right) => waver.race(left, right));
        
const printResults = waver.chain(firstVersusIO, (results) => waver.encaseWaveR(consoleIO.log(`winning query was ${results[0][0].q}`)));

const log = 
        managed.provideTo(agent as managed.Managed<Error, https.Agent>, printResults);

wave.run(wave.applySecond(versus, log));
