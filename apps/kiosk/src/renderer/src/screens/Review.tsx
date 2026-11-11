import { layoutSize, type FilterId, type KioskState, type Template } from '@pb/core';
import { useEffect, useRef, useState } from 'react';
import { composeLayout } from '../compose/compose';
import { FILTERS } from '../compose/filters';
import { closeSessionImages, loadSessionImages, type SessionImages } from '../compose/session-sheet';
import type { KioskInput } from '../state/useKiosk';

type ReviewState = Extract<KioskState, { name: 'review' }>;

const FILTER_IDS = Object.keys(FILTERS) as FilterId[];
const PREVIEW_SCALE = 0.5;

export function Review({
  state,
  template,
  dispatch,
}: {
  state: ReviewState;
  template: Template;
  dispatch: (e: KioskInput) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<SessionImages | null>(null);
  const { w, h } = layoutSize(template.layout);

  useEffect(() => {
    let cancelled = false;
    let loaded: SessionImages | null = null;
    loadSessionImages({ template, shotIds: state.shots }).then(
      (imgs) => {
        if (cancelled) return closeSessionImages(imgs);
        loaded = imgs;
        setImages(imgs);
      },
      (err: unknown) => console.error('Loading review images failed', err),
    );
    return () => {
      cancelled = true;
      setImages(null);
      if (loaded) closeSessionImages(loaded);
    };
  }, [template, state.shots]);

  // Re-render the layout at half scale whenever the look changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!images || !ctx) return;
    const layoutCanvas = composeLayout({ layout: template.layout, filter: state.filter, ...images });
    ctx.drawImage(layoutCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }, [images, state.filter, template.layout]);

  return (
    <main className="screen review">
      <h1>Pick a look</h1>
      <canvas ref={canvasRef} className="review-preview" width={w * PREVIEW_SCALE} height={h * PREVIEW_SCALE} />
      <div className="filters">
        {FILTER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={state.filter === id}
            onClick={() => dispatch({ type: 'FILTER_SELECTED', filter: id })}
          >
            {FILTERS[id].label}
          </button>
        ))}
      </div>
      <button type="button" className="primary" onClick={() => dispatch({ type: 'CONFIRM', now: Date.now() })}>
        Print
      </button>
    </main>
  );
}
