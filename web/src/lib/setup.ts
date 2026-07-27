/**
 * First-run dependency chain.
 *
 * Smuggler can only be operated in one direction — upload a VPN config, deploy
 * a mule, then add a torrent — but the UI opens on Torrents, which is correct
 * for every day after the first and a dead end on the first. Each step used to
 * announce its own failure *after* the user committed to it ("No running mules
 * — deploy one first") without routing anywhere.
 *
 * Kept as a pure function so the ordering and gating rules are testable without
 * a DOM: the component around it only renders what this returns.
 */

export type SetupStepId = 'config' | 'mule' | 'torrent';

export interface SetupStep {
  id: SetupStepId;
  /** Prerequisite satisfied — the user has already done this. */
  done: boolean;
  /** Reachable now: every earlier step is done. */
  enabled: boolean;
}

export interface SetupState {
  steps: SetupStep[];
  /** First step still to do, or null once a torrent can be added. */
  current: SetupStepId | null;
}

/**
 * @param configCount      stored VPN configs
 * @param runningMuleCount mules currently in the `running` state
 */
export function setupState(configCount: number, runningMuleCount: number): SetupState {
  const hasConfig = configCount > 0;
  const hasMule = runningMuleCount > 0;

  // A step is "done" only through its own prerequisite, never inherited: a mule
  // can be running while its config has since been deleted, and the ladder
  // should still read as complete rather than reopening step 1.
  const steps: SetupStep[] = [
    { id: 'config',  done: hasConfig || hasMule, enabled: true },
    { id: 'mule',    done: hasMule,              enabled: hasConfig },
    { id: 'torrent', done: false,                enabled: hasMule },
  ];

  return { steps, current: steps.find(s => !s.done && s.enabled)?.id ?? null };
}

/**
 * True while the user still cannot add a torrent at all.
 *
 * Only the mule matters: a config with no mule is as blocking as no config,
 * and a running mule makes the chain complete regardless of what is stored.
 */
export function needsSetup(runningMuleCount: number): boolean {
  return runningMuleCount === 0;
}
