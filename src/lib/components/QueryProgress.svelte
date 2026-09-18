<script lang="ts">
  /**
   * Progress for a running query, drawn from Trino's split counts.
   *
   * Deliberately *not* a percentage. Trino reports `progressPercentage`, but
   * its denominator is the number of splits discovered so far, which grows
   * while the query runs: the figure walks backwards, sits at 99% for minutes,
   * or reads 40% for a query that has barely started. Everything here is
   * either a count Trino actually reported or a composition of counts, so
   * nothing on screen can claim more than is known:
   *
   *  - the wide bar is *composition*, not completion: it shows how the splits
   *    known right now divide into completed / running / queued;
   *  - the area chart plots those same counts over time, so a growing total
   *    shows up as the top edge climbing -- the goalpost moving is visible
   *    rather than hidden inside a percentage;
   *  - the stage bars share one x-scale, so a stage's width says how much of
   *    the query's work it carries.
   */
  import type { Result } from "$lib/State.svelte";
  import type { QueryStage } from "$lib/trino";
  import { formatBytes, formatCount, formatDuration } from "$lib/format";

  interface Props {
    result: Result;
    /** One-line strip, for when the table below is already showing rows. */
    compact?: boolean;
  }

  let { result, compact = false }: Props = $props();

  let stats = $derived(result.stats);

  const splitsOf = (s: {
    totalSplits: number;
    queuedSplits: number;
    runningSplits: number;
    completedSplits: number;
  }) => {
    const completed = s.completedSplits ?? 0;
    const running = s.runningSplits ?? 0;
    const queued = s.queuedSplits ?? 0;
    const accounted = completed + running + queued;
    // Trino's total should equal the three states summed. Taking the larger of
    // the two keeps the bar honest if it ever does not: the shortfall is drawn
    // as its own unaccounted segment rather than silently rescaling the rest.
    const total = Math.max(s.totalSplits ?? 0, accounted);
    return { completed, running, queued, total, unaccounted: total - accounted };
  };

  let splits = $derived(
    stats ? splitsOf(stats) : { completed: 0, running: 0, queued: 0, total: 0, unaccounted: 0 }
  );

  let stateLabel = $derived.by(() => {
    if (result.canceled) return "Canceled";
    if (result.cancelling) return "Cancelling";
    if (result.error) return "Failed";
    const state = stats?.state;
    if (!state) return "Submitting";
    return state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");
  });

  /**
   * Trino has accepted the query but not scheduled any splits yet: there is
   * nothing to divide up, and a bar of zeroes reads as "stuck at zero" rather
   * than "nothing to show yet".
   */
  let waiting = $derived(splits.total === 0 && !result.completed);

  let waitingLabel = $derived(
    stats?.state === "RUNNING" || stats?.state === "STARTING"
      ? "Scheduling splits…"
      : "Waiting for the cluster — the query has not been scheduled yet."
  );

  type FlatStage = { stage: QueryStage; depth: number };

  const flatten = (stage: QueryStage | undefined, depth = 0, out: FlatStage[] = []) => {
    if (!stage) return out;
    out.push({ stage, depth });
    for (const sub of stage.subStages ?? []) flatten(sub, depth + 1, out);
    return out;
  };

  let stages = $derived(flatten(stats?.rootStage));
  /** One shared scale across the stage bars, so their widths compare. */
  let stageScale = $derived(Math.max(1, ...stages.map((s) => splitsOf(s.stage).total)));

  const stageNumber = (stageId: string) => stageId.split(".").pop() ?? stageId;

  /* --- History ------------------------------------------------------------
   *
   * Two charts on one time axis, because neither measure alone is honest:
   *
   *  - Splits say how much work is scheduled and how much of it has finished,
   *    but a split is coarse. A scan of tpch.sf10.lineitem runs for seconds
   *    with completedSplits stuck at 0/30 -- splits alone draw a working query
   *    as a dead flat line.
   *  - Rows processed move continuously, so they say whether anything is
   *    happening at all, but say nothing about how much is left.
   *
   * Two measures of different scale never share a y-axis, so they are two
   * charts stacked on a shared x, with one linked crosshair over both.
   *
   * The splits y-scale is the largest total seen, so when Trino discovers more
   * splits the whole stack rescales downwards -- which is the point: the
   * goalpost moving is drawn rather than hidden. Fills only, no strokes, so
   * the viewBox can be stretched with `preserveAspectRatio="none"` without
   * distorting any line weights.
   */
  let chart = $derived.by(() => {
    const samples = result.progress;
    if (samples.length < 2) return null;

    const tMax = samples[samples.length - 1].t || 1;
    const splitsMax = Math.max(
      1,
      ...samples.map((s) => Math.max(s.total, s.completed + s.running + s.queued))
    );
    const rowsMax = Math.max(1, ...samples.map((s) => s.rows));

    type Sample = (typeof samples)[number];
    const x = (t: number) => ((t / tMax) * 100).toFixed(2);

    const area = (scale: number, lower: (s: Sample) => number, upper: (s: Sample) => number) => {
      const y = (v: number) => (100 - (v / scale) * 100).toFixed(2);
      const top = samples.map((s) => `${x(s.t)},${y(upper(s))}`);
      const bottom = samples
        .slice()
        .reverse()
        .map((s) => `${x(s.t)},${y(lower(s))}`);
      return top.concat(bottom).join(" ");
    };

    // The boundary of an area is where the reader actually looks, so both
    // charts get a crisp edge on top of the wash. `vector-effect` keeps the
    // stroke 2px however far the viewBox is stretched sideways.
    const line = (scale: number, value: (s: Sample) => number) =>
      samples.map((s) => `${x(s.t)},${(100 - (value(s) / scale) * 100).toFixed(2)}`).join(" ");

    const zero = () => 0;
    const done = (s: Sample) => s.completed;
    const upToRunning = (s: Sample) => s.completed + s.running;
    const upToQueued = (s: Sample) => s.completed + s.running + s.queued;
    const rows = (s: Sample) => s.rows;

    return {
      tMax,
      splitsMax,
      rowsMax,
      completed: area(splitsMax, zero, done),
      running: area(splitsMax, done, upToRunning),
      queued: area(splitsMax, upToRunning, upToQueued),
      // The top of the split stack is the total Trino knows about: drawn as a
      // line because a climbing edge is the whole story the panel is telling.
      knownLine: line(splitsMax, (s) => Math.max(s.total, upToQueued(s))),
      rows: area(rowsMax, zero, rows),
      rowsLine: line(rowsMax, rows)
    };
  });

  let hover: number | null = $state(null);
  let hovered = $derived(hover == null ? null : (result.progress[hover] ?? null));

  function trackHover(event: MouseEvent) {
    const samples = result.progress;
    if (samples.length < 2) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const target = ((event.clientX - rect.left) / rect.width) * samples[samples.length - 1].t;
    let best = 0;
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i].t - target) < Math.abs(samples[best].t - target)) best = i;
    }
    hover = best;
  }

  let hoverX = $derived(
    hovered && chart ? `${Math.min(100, (hovered.t / chart.tMax) * 100)}%` : "0%"
  );

  let summary = $derived(
    `${formatCount(splits.completed)} of ${formatCount(splits.total)} known splits completed, ` +
      `${formatCount(splits.running)} running, ${formatCount(splits.queued)} queued`
  );
</script>

{#snippet segments(s: typeof splits, label: boolean)}
  {#if s.completed > 0}
    <div
      class="seg completed"
      style:flex-grow={s.completed}
      title={label ? `${formatCount(s.completed)} splits completed` : undefined}
    ></div>
  {/if}
  {#if s.running > 0}
    <div
      class="seg running"
      style:flex-grow={s.running}
      title={label ? `${formatCount(s.running)} splits running` : undefined}
    ></div>
  {/if}
  {#if s.queued > 0}
    <div
      class="seg queued"
      style:flex-grow={s.queued}
      title={label ? `${formatCount(s.queued)} splits queued` : undefined}
    ></div>
  {/if}
  {#if s.unaccounted > 0}
    <div
      class="seg unaccounted"
      style:flex-grow={s.unaccounted}
      title={label ? `${formatCount(s.unaccounted)} splits not yet in any state` : undefined}
    ></div>
  {/if}
{/snippet}

{#if compact}
  <!-- The result rail directly above already carries state, elapsed and rows,
       so the strip only adds what the rail has no room for: the splits. -->
  <div class="strip" role="img" aria-label={summary}>
    <div class="bar thin">
      {@render segments(splits, true)}
    </div>
    <span class="counts">
      {formatCount(splits.completed)} / {formatCount(splits.total)} splits
    </span>
  </div>
{:else}
  <div class="progress">
    <header>
      <span class="state" class:failed={result.error}>{stateLabel}</span>
      {#if stats?.queuedTimeMillis}
        <span class="muted">queued {formatDuration(stats.queuedTimeMillis)}</span>
      {/if}
      <span class="spacer"></span>
      {#if result.queryId}
        <span class="query-id" title="Trino query id">{result.queryId}</span>
      {/if}
    </header>

    {#if waiting}
      <p class="waiting">{waitingLabel}</p>
    {:else}
      <section class="overall">
        <div class="bar" role="img" aria-label={summary}>
          {@render segments(splits, true)}
        </div>
        <div class="legend">
          <span class="key"
            ><i class="swatch completed"></i>Completed
            <b>{formatCount(splits.completed)}</b></span
          >
          <span class="key"
            ><i class="swatch running"></i>Running <b>{formatCount(splits.running)}</b></span
          >
          <span class="key"
            ><i class="swatch queued"></i>Queued <b>{formatCount(splits.queued)}</b></span
          >
          <span class="spacer"></span>
          <!-- "known" is the honest word: this total is what Trino has
               scheduled so far, not the work the query will end up doing. -->
          <span class="muted">of {formatCount(splits.total)} splits known so far</span>
        </div>
      </section>

      {#if chart}
        <section
          class="history"
          onmousemove={trackHover}
          onmouseleave={() => (hover = null)}
          role="group"
          aria-label="Query progress over time"
        >
          <div class="axis">
            <span class="muted">Splits</span>
            <span class="spacer"></span>
            <span class="muted tick">{formatCount(chart.splitsMax)}</span>
          </div>
          <div class="plot" role="img" aria-label={summary}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon class="area queued" points={chart.queued} />
              <polygon class="area running" points={chart.running} />
              <polygon class="area completed" points={chart.completed} />
              <polyline
                class="line known"
                points={chart.knownLine}
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div class="axis">
            <span class="muted">Rows processed</span>
            <span class="spacer"></span>
            <span class="muted tick">{formatCount(chart.rowsMax)}</span>
          </div>
          <div
            class="plot"
            role="img"
            aria-label="{formatCount(stats?.processedRows)} rows processed so far"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon class="area rows" points={chart.rows} />
              <polyline
                class="line rows"
                points={chart.rowsLine}
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div class="axis">
            <span class="muted tick">0s</span>
            <span class="spacer"></span>
            <span class="muted tick">{formatDuration(chart.tMax)}</span>
          </div>

          {#if hovered}
            <!-- One crosshair across both plots: the two measures are only
                 worth stacking if they can be read at the same instant. -->
            <div class="crosshair" style:left={hoverX}></div>
            <div class="readout" class:right={hovered.t > chart.tMax / 2} style:left={hoverX}>
              <div class="when">{formatDuration(hovered.t)}</div>
              <div><i class="swatch completed"></i>{formatCount(hovered.completed)} completed</div>
              <div><i class="swatch running"></i>{formatCount(hovered.running)} running</div>
              <div><i class="swatch queued"></i>{formatCount(hovered.queued)} queued</div>
              <div class="muted">{formatCount(hovered.total)} splits known</div>
              <div class="muted">{formatCount(hovered.rows)} rows processed</div>
            </div>
          {/if}
        </section>
      {/if}
    {/if}

    <!-- Outside the `waiting` branch: Trino publishes the stage tree a beat
         before it schedules any splits, and the shape of the plan is worth
         seeing during that beat. -->
    {#if stages.length > 0}
      <section class="stages">
        <div class="stage-row head">
          <span>Stage</span>
          <span class="bar-col"></span>
          <span class="num">Splits</span>
          <span class="num">Rows</span>
        </div>
        {#each stages as { stage, depth } (stage.stageId)}
          {@const s = splitsOf(stage)}
          <div class="stage-row">
            <span class="name" style:padding-left="{depth * 0.9}em">
              <span class="dot" class:done={stage.done} class:failed={stage.failedTasks > 0}></span>
              {stageNumber(stage.stageId)}
              <span class="stage-state">{stage.state.toLowerCase()}</span>
            </span>
            <span class="bar-col">
              <span class="bar stage" style:width="{(s.total / stageScale) * 100}%">
                {@render segments(s, false)}
              </span>
            </span>
            <span class="num">{formatCount(s.completed)} / {formatCount(s.total)}</span>
            <span class="num">{formatCount(stage.processedRows)}</span>
          </div>
        {/each}
      </section>
    {/if}

    <footer>
      <!-- While the query runs this counts rows at every stage they pass
           through, so a join reports each input row more than once; on the
           settling chunk Trino restates it as raw input rows and the figure
           can drop. "Processed" is the wording that stays true either way. -->
      <span title="Counted at every stage a row passes through; restated as input rows at the end.">
        <b>{formatCount(stats?.processedRows)}</b> rows processed
      </span>
      <span><b>{formatBytes(stats?.processedBytes)}</b> processed</span>
      <!-- Zero for connectors that generate their data (tpch, tpcds), where
           reporting "0 B read" beside a busy query reads as a bug. -->
      {#if stats?.physicalInputBytes}
        <span><b>{formatBytes(stats.physicalInputBytes)}</b> read from storage</span>
      {/if}
      <span><b>{formatDuration(stats?.cpuTimeMillis)}</b> CPU</span>
      <span><b>{formatBytes(stats?.peakMemoryBytes)}</b> peak memory</span>
      {#if stats?.spilledBytes}
        <span><b>{formatBytes(stats.spilledBytes)}</b> spilled</span>
      {/if}
      {#if stats?.nodes}
        <span><b>{formatCount(stats.nodes)}</b> {stats.nodes === 1 ? "node" : "nodes"}</span>
      {/if}
    </footer>
  </div>
{/if}

<style>
  /* One hue, three steps: the split states are stages of the same pipeline,
     not unrelated categories, so a sequential ramp reads in the right order.
     Position in the stack is fixed and the legend names each step, so identity
     never rests on colour alone. */
  .progress,
  .strip {
    --split-completed: var(--accent);
    --split-running: color-mix(in oklab, var(--accent) 42%, var(--s0));
    --split-queued: color-mix(in oklab, var(--accent) 20%, var(--s0));
    --split-unaccounted: var(--s2);

    /* The bars are small marks and carry the saturated fills; the areas are
       large regions and get washes of the same ramp, so a chart that is one
       flat colour for twenty seconds -- which is exactly what a long-running
       split does -- stays quiet instead of shouting. */
    --area-completed: color-mix(in oklab, var(--accent) 60%, var(--s0));
    --area-running: color-mix(in oklab, var(--accent) 26%, var(--s0));
    --area-queued: color-mix(in oklab, var(--accent) 11%, var(--s0));
    --area-rows: color-mix(in oklab, var(--fg) 10%, var(--s0));
    --line-rows: color-mix(in oklab, var(--fg) 55%, var(--s0));
  }

  .spacer {
    flex: 1;
  }

  .muted {
    color: var(--fg-3);
  }

  /* --- Bars --- */

  .bar {
    display: flex;
    /* The 2px gap is the surface doing the separating -- no borders on the
       segments, which would add ink that is not data. */
    gap: 2px;
    height: 20px;
    border-radius: var(--r-kbd);
    overflow: hidden;
    background: transparent;
  }

  .bar.thin {
    height: 6px;
    flex: 1;
  }

  .bar.stage {
    height: 11px;
    border-radius: 2px;
    min-width: 3px;
  }

  .seg {
    flex-basis: 0;
    /* A stage holding a handful of splits next to one holding a hundred
       thousand would otherwise round away to nothing. */
    min-width: 2px;
  }

  .seg.completed,
  .swatch.completed {
    background: var(--split-completed);
  }

  .seg.running,
  .swatch.running {
    background: var(--split-running);
  }

  .seg.queued,
  .swatch.queued {
    background: var(--split-queued);
  }

  .area.completed {
    fill: var(--area-completed);
  }

  .area.running {
    fill: var(--area-running);
  }

  .area.queued {
    fill: var(--area-queued);
  }

  .seg.unaccounted {
    background: var(--split-unaccounted);
  }

  .swatch {
    display: inline-block;
    width: 0.7em;
    height: 0.7em;
    border-radius: 2px;
    margin-right: 0.4em;
    vertical-align: baseline;
  }

  /* --- Compact strip --- */

  /* A second rail under the result rail: same band, same hairline, so the two
     read as one header rather than as a stripe stuck on the table. */
  .strip {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: var(--h-rail);
    padding: 0 12px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--s1);
    white-space: nowrap;
  }

  .strip .counts {
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  /* --- Panel --- */

  .progress {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-content: start;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  /* Body size, not a third one: the system has two, and weight is what marks
     this as the heading. */
  .state {
    font-weight: 600;
  }

  .state.failed {
    color: var(--error);
  }

  .query-id {
    font: var(--text-sm) / var(--leading-sm) var(--font-mono);
    color: var(--fg-3);
    user-select: text;
  }

  .waiting {
    margin: 0;
    color: var(--fg-3);
  }

  .overall {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }

  .legend {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }

  /* Values sit in ink, never in the series colour; the swatch beside them
     carries identity. */
  .key b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  /* --- History chart --- */

  .history {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
  }

  .axis {
    display: flex;
    align-items: baseline;
    font: var(--text-sm) / var(--leading-sm) var(--font);
  }

  .tick {
    font-variant-numeric: tabular-nums;
  }

  /* A second measure never shares the split ramp: rows are a different thing
     being counted, so they get ink rather than a fourth blue that would read
     as a fourth split state. One series, so no legend -- the label says it. */
  .area.rows {
    fill: var(--area-rows);
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .line.known {
    stroke: var(--split-running);
  }

  .line.rows {
    stroke: var(--line-rows);
  }

  .plot {
    height: 4.5em;
    /* Hairline, solid, one step off the surface: the scale's ceiling and its
       baseline, nothing else. */
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .plot svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .crosshair {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--fg-3);
    pointer-events: none;
  }

  .readout {
    position: absolute;
    top: 0;
    margin-left: 0.6em;
    padding: 0.5em 0.7em;
    background: var(--s0);
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    box-shadow: var(--shadow);
    pointer-events: none;
    white-space: nowrap;
    font: var(--text-sm) / var(--leading-sm) var(--font);
    font-variant-numeric: tabular-nums;
    z-index: 1;
  }

  .readout.right {
    margin-left: 0;
    transform: translateX(calc(-100% - 0.6em));
  }

  .readout .when {
    font-weight: 600;
    margin-bottom: 0.3em;
  }

  /* --- Stages --- */

  .stages {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }

  .stage-row {
    display: grid;
    grid-template-columns: minmax(7em, 10em) minmax(3em, 1fr) 6em 4.5em;
    align-items: center;
    gap: 12px;
    font: var(--text-sm) / var(--leading-sm) var(--font);
  }

  .stage-row.head {
    color: var(--fg-3);
    padding-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }

  .stage-row .name {
    display: flex;
    align-items: center;
    gap: 0.4em;
    overflow: hidden;
    white-space: nowrap;
  }

  .stage-state {
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--split-running);
  }

  .dot.done {
    background: var(--split-completed);
  }

  .dot.failed {
    background: var(--error);
  }

  .bar-col {
    display: flex;
    min-width: 0;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  .stage-row.head .num {
    color: var(--fg-3);
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--fg-3);
    font: var(--text-sm) / var(--leading-sm) var(--font);
  }

  footer b {
    font-weight: 600;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }
</style>
