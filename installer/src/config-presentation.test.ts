import { describe, expect, it } from 'vitest';
import { groupConfigLeaves, humanizeConfigSegment } from './config-presentation';
import type { ConfigLeaf } from './types';

function leaf(path: Array<string | number>): ConfigLeaf {
  return { path, value: '', start: 0, end: 0 };
}

describe('Config presentation', () => {
  it('turns implementation keys into user-facing labels', () => {
    expect(humanizeConfigSegment('CompanionBoardInformation')).toBe('Companion Board Information');
    expect(humanizeConfigSegment('urlOverride')).toBe('URL Override');
    expect(humanizeConfigSegment('defaultPin')).toBe('Default PIN');
    expect(humanizeConfigSegment('info2')).toBe('Info 2');
    expect(humanizeConfigSegment(0)).toBe('Item 1');
  });

  it('builds a heading hierarchy from nested object paths', () => {
    const tree = groupConfigLeaves([
      leaf(['version']),
      leaf(['UserInterface', 'WebWidget', 'urlOverride']),
      leaf(['UserInterface', 'WebWidget', 'weather', 'mode']),
    ]);

    expect(tree.leaves.map((item) => item.path)).toEqual([['version']]);
    expect(tree.children[0]?.label).toBe('User Interface');
    expect(tree.children[0]?.children[0]?.label).toBe('Web Widget');
    expect(tree.children[0]?.children[0]?.children[0]?.label).toBe('Weather');
  });
});
