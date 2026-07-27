import { describe, it, expect } from 'vitest';
import { setupState, needsSetup, type SetupStepId } from './setup';

const idsWhere = (
  configs: number,
  mules: number,
  pred: (s: { done: boolean; enabled: boolean }) => boolean,
): SetupStepId[] => setupState(configs, mules).steps.filter(pred).map(s => s.id);

describe('setupState', () => {
  it('always reports the three steps in dependency order', () => {
    expect(setupState(0, 0).steps.map(s => s.id)).toEqual(['config', 'mule', 'torrent']);
  });

  it('starts the user on the config step with nothing set up', () => {
    expect(setupState(0, 0).current).toBe('config');
  });

  it('gates every step behind the one before it', () => {
    expect(idsWhere(0, 0, s => s.enabled)).toEqual(['config']);
    expect(idsWhere(1, 0, s => s.enabled)).toEqual(['config', 'mule']);
    expect(idsWhere(1, 1, s => s.enabled)).toEqual(['config', 'mule', 'torrent']);
  });

  it('advances to the mule step once a config exists', () => {
    expect(setupState(2, 0).current).toBe('mule');
    expect(idsWhere(2, 0, s => s.done)).toEqual(['config']);
  });

  it('advances to the torrent step once a mule is running', () => {
    expect(setupState(1, 1).current).toBe('torrent');
    expect(idsWhere(1, 1, s => s.done)).toEqual(['config', 'mule']);
  });

  it('treats a running mule as proof of the config step, even with none stored', () => {
    // The config can be deleted after its mule is up. The ladder must not
    // reopen a step the user has demonstrably completed.
    const state = setupState(0, 1);
    expect(state.steps[0].done).toBe(true);
    expect(state.current).toBe('torrent');
  });

  it('never marks the torrent step done — it is the action, not a prerequisite', () => {
    expect(setupState(5, 5).steps.at(-1)).toMatchObject({ id: 'torrent', done: false });
  });
});

describe('needsSetup', () => {
  it('is true until a mule is running', () => {
    expect(needsSetup(0)).toBe(true);
    expect(needsSetup(1)).toBe(false);
  });
});
