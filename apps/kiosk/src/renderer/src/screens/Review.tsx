import { layoutSize, REVIEW_TIMEOUT_MS, type FilterId, type KioskState, type Template } from '@pb/core';
import { useEffect, useRef, useState } from 'react';
import { shotStore } from '../camera/shot-store';
import { composeLayout } from '../compose/compose';
import { FILTERS, filterCss } from '../compose/filters';
import { closeSessionImages, loadSessionImages, type SessionImages } from '../compose/session-sheet';
import type { KioskInput } from '../state/useKiosk';
import { ActionButton } from '../theme/components/ActionButton';
import { Backdrop } from '../theme/components/Backdrop';
import { BannerTitle } from '../theme/components/BannerTitle';
import { FramedCard } from '../theme/components/FramedCard';
import { TimerPill } from '../theme/components/TimerPill';
import { FlashBolt } from '../theme/decor/FlashBolt';
import { Sparkle } from '../theme/decor/Sparkle';
import { useRemainingMs } from '../theme/time';

type ReviewState = Extract<KioskState, { name: 'review' }>;

const FILTER_IDS = Object.keys(FILTERS) as FilterId[];
const PREVIEW_SCALE = 0.5;

/** An object URL for `blob` (shot 1, for the filter tiles), revoked when it changes or on unmount. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

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
  const remainingMs = useRemainingMs(state.enteredAt + REVIEW_TIMEOUT_MS);
  const thumbUrl = useObjectUrl(shotStore.get(state.shots[0] ?? ''));

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
    <main className="stage review">
      <Backdrop kind="paper" />
      <div className="topbar review__top">
        <TimerPill remainingMs={remainingMs} />
        <Sparkle size="8vmin" fill="var(--lime)" wobble />
      </div>
      <div className="title-row review__title">
        <BannerTitle tone="tangerine" tilt={-2}>
          Pick a look
        </BannerTitle>
        <FlashBolt size="7vmin" fill="var(--aqua)" wobble />
      </div>
      {/* The card takes the layout's aspect ratio so the polaroid hugs the strip/4R instead of letterboxing it. */}
      <FramedCard polaroid className="review__card" style={{ aspectRatio: `${w} / ${h}` }}>
        <canvas ref={canvasRef} className="review-preview" width={w * PREVIEW_SCALE} height={h * PREVIEW_SCALE} />
      </FramedCard>
      <div className="filter-tray review__tray">
        {FILTER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="filter-tile"
            aria-pressed={state.filter === id}
            onClick={() => dispatch({ type: 'FILTER_SELECTED', filter: id })}
          >
            <span className="filter-tile__thumb">
              {thumbUrl && <img src={thumbUrl} alt="" style={{ filter: filterCss(id) }} />}
            </span>
            <span className="filter-tile__label">{FILTERS[id].label}</span>
            <svg className="filter-tile__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        ))}
      </div>
      <ActionButton className="review__action" onClick={() => dispatch({ type: 'CONFIRM', now: Date.now() })}>
        Print
      </ActionButton>
    </main>
  );
}
