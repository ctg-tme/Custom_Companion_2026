import { describe, expect, it } from 'vitest';
import { groupConfigLeaves, humanizeConfigForReview, humanizeConfigSegment } from './config-presentation';
import type { ConfigLeaf } from './types';

function leaf(path: Array<string | number>): ConfigLeaf {
  return { path, value: '', start: 0, end: 0 };
}

describe('Config presentation', () => {
  it('turns implementation keys into user-facing labels', () => {
    expect(humanizeConfigSegment('CompanionDeviceInformation')).toBe('Companion Device Information');
    expect(humanizeConfigSegment('CompanionBoardInformation')).toBe('Companion Device Information');
    expect(humanizeConfigSegment('urlOverride')).toBe('URL Override');
    expect(humanizeConfigSegment('pin')).toBe('PIN');
    expect(humanizeConfigSegment('userGuidance')).toBe('User Guidance');
    expect(humanizeConfigSegment(0)).toBe('Item 1');
  });

  it('humanizes current mode keys in the review-only configuration summary', () => {
    const source = {
      CompanionDeviceInformation: { host: 'companion.example.com' },
      UserInterface: {
        WebWidget: {
          Standalone: { userGuidance: 'Visible Standalone copy' },
          Paired: { userGuidance: 'Visible Paired copy' },
        },
      },
    };

    expect(humanizeConfigForReview(source)).toEqual({
      'Companion Device Information': { Host: 'companion.example.com' },
      'User Interface': {
        'Web Widget': {
          Standalone: { 'User Guidance': 'Visible Standalone copy' },
          Paired: { 'User Guidance': 'Visible Paired copy' },
        },
      },
    });
    expect(source).toHaveProperty('CompanionDeviceInformation');
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
