import { describe, expect, it } from 'vitest';
import { trialEndedUrl } from '../src/main/trial-ended-page';

const PREFIX = 'data:text/html;charset=utf-8,';

describe('trialEndedUrl', () => {
  const url = trialEndedUrl();
  const html = decodeURIComponent(url.slice(PREFIX.length));

  it('is a text/html data URL', () => {
    expect(url.startsWith(PREFIX)).toBe(true);
  });

  it('says the trial ended and who to contact', () => {
    expect(html).toContain('Trial ended');
    expect(html).toContain('Thank you for trying Photobooth.');
    expect(html).toContain('Please contact your vendor to continue.');
  });

  it('is a static page with no script or external reference', () => {
    expect(html.toLowerCase()).toContain('<!doctype html>');
    for (const bad of ['<script', 'javascript:', 'http://', 'https://']) expect(html.toLowerCase()).not.toContain(bad);
  });
});
