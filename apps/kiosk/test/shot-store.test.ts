import { describe, expect, it } from 'vitest';
import { createShotStore } from '../src/renderer/src/camera/shot-store';

describe('shotStore', () => {
  it('puts blobs under unique ids and gets them back', () => {
    const store = createShotStore();
    const a = new Blob(['a'], { type: 'image/jpeg' });
    const b = new Blob(['b'], { type: 'image/jpeg' });
    const idA = store.put(a);
    const idB = store.put(b);
    expect(idA).not.toBe(idB);
    expect(store.get(idA)).toBe(a);
    expect(store.get(idB)).toBe(b);
    expect(store.size()).toBe(2);
  });

  it('returns undefined for unknown ids', () => {
    expect(createShotStore().get('nope')).toBeUndefined();
  });

  it('clear drops every shot', () => {
    const store = createShotStore();
    const id = store.put(new Blob(['a']));
    store.clear();
    expect(store.get(id)).toBeUndefined();
    expect(store.size()).toBe(0);
  });
});
