const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Trial ended</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 32px;
    background: #000; color: #fff; font-family: system-ui, sans-serif; text-align: center; padding: 48px; }
  h1 { font-size: 96px; margin: 0; }
  p { font-size: 48px; margin: 0; color: #cfcfcf; }
</style>
</head>
<body>
<h1>Trial ended</h1>
<p>Thank you for trying Photobooth.</p>
<p>Please contact your vendor to continue.</p>
</body>
</html>`;

/** Static page shown in place of the app once the trial has ended (no script, no external references). */
export function trialEndedUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`;
}
