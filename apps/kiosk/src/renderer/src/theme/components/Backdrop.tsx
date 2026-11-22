import { FilmStrip } from '../decor/FilmStrip';
import { HalftoneField } from '../decor/HalftoneField';

/**
 * `film` = Attract (ink, drifting film band, halftone), `darkroom` = Capture/Output (ink, faint halftone),
 * `paper` = Review (paper, halftone corners), `stripes` = Payment/Delivery (tangerine stripes over paper).
 */
export type BackdropKind = 'film' | 'darkroom' | 'paper' | 'stripes';

/** Full-screen decorative background, drawn behind the screen's content. Never interactive. */
export function Backdrop({ kind }: { kind: BackdropKind }) {
  return (
    <div className={`backdrop backdrop--${kind}`} aria-hidden="true">
      {kind === 'film' && (
        <>
          <HalftoneField fill="var(--tangerine)" size="38vmin" className="backdrop__dots backdrop__dots--tl" />
          <div className="backdrop__band">
            {/* Three identical runs of six frames; the band slides by one run and loops seamlessly. */}
            <FilmStrip frames={18} size="100%" className="backdrop__film" />
          </div>
          <HalftoneField fill="var(--lime)" size="44vmin" className="backdrop__dots backdrop__dots--br" />
        </>
      )}
      {kind === 'darkroom' && <HalftoneField fill="var(--ink-2)" size="70vmin" className="backdrop__dots backdrop__dots--br" />}
      {kind === 'paper' && (
        <>
          <HalftoneField fill="var(--aqua)" size="44vmin" className="backdrop__dots backdrop__dots--tl" />
          <HalftoneField fill="var(--tangerine)" size="44vmin" className="backdrop__dots backdrop__dots--br" />
        </>
      )}
    </div>
  );
}
