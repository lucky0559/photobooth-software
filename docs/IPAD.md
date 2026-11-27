# iPad Trial: Setup and Test

This guide prepares the static Photobooth Trial build for a client to test in Safari on an iPad with its camera and a Canon SELPHY printer.

## Build and host

From the repository root, run:

```sh
pnpm --filter kiosk build:web
```

The upload-ready static site is `apps/kiosk/dist-web/`. Upload the **contents** of that folder to the root of a static HTTPS site. Keep the generated files and paths together. The app uses relative asset paths and a service worker, so it can also live in a subfolder when the host serves that folder with a trailing slash.

The site must use HTTPS for camera permission and offline installation. No backend, Supabase credentials, PayMongo account, or server process is needed. No public URL has been configured in this repository; hosting and sending the URL remain separate steps.

### Recommended one-off host: Cloudflare Pages

Cloudflare Pages Direct Upload accepts a prebuilt folder and serves the project at a `.pages.dev` URL. For this trial:

1. Sign in to the Cloudflare dashboard and open **Workers & Pages**.
2. Choose **Create application → Get started → Drag and drop your files**.
3. Choose a unique project name such as `photobooth-ipad-trial`.
4. Drag the `apps/kiosk/dist-web/` folder into the upload area, then deploy. The resulting `https://<project-name>.pages.dev` URL is the one to open on the iPad.
5. For later builds, choose **Create a new deployment** and upload the folder again.

See [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and its [HTTPS Pages URL example](https://developers.cloudflare.com/pages/configuration/preview-deployments/). Direct Upload projects cannot later be converted to Git integration; create a separate Git-integrated project if automatic deployments are needed.

## Install on the iPad

1. Use an iPad running iPadOS 16.4 or newer; iPadOS 17 or newer is recommended.
2. Connect the iPad and Canon SELPHY to the same Wi-Fi network. Avoid guest Wi-Fi that blocks devices from seeing one another.
3. Open the hosted HTTPS URL in Safari while online and wait for the Photobooth Trial screen to load.
4. In Safari, use **Share → Add to Home Screen**, then open the new Home Screen icon for kiosk-style testing. The app works in portrait and landscape and reflows when the iPad rotates.
5. For a counter-side test, enable **Settings → Accessibility → Guided Access** and start it from the Home Screen app with the iPad's side or Home button shortcut.
6. Do not use Private Browsing. Keep Safari website data enabled; clearing it can reset local settings and restart the local trial.

## First-run setup

1. Create a 4–8 digit staff PIN and keep it with the test operator.
2. In Setup, tap **Enable camera** and allow Safari camera access. The front camera is selected by default; choose another listed camera if needed.
3. Confirm the demo settings and tap **Print test page**.
4. Wait until the test sheet is ready, then tap **Open AirPrint print sheet**. In Apple's print sheet, select the Canon SELPHY, choose 4×6 paper, portrait orientation and borderless printing if the printer offers it. Start with one copy.
5. Check that the border is visible and the image is centred on the 4×6 sheet. Safari reports when the print sheet closes; it cannot confirm that paper physically came out.

If the printer does not appear, confirm that the iPad and SELPHY are on the same Wi-Fi network and that the printer is ready. Printer setup menus vary by SELPHY model; use the instructions for the client's exact model.

## Guest-flow test

- Tap through the payment screen. The web trial is a demo: **no payment is taken**, and the screen continues automatically.
- Allow camera access if Safari asks again, take the configured shots, and review the result.
- Try the Black & White and Warm looks, then continue to print. Each sheet needs a guest tap to open the AirPrint sheet. The print uses the bundled project `Sample strip` artwork; photos have no `TRIAL` footer.
- In AirPrint, confirm the Canon SELPHY, 4×6 paper size, orientation, borderless setting and copy count.
- Finish at the delivery screen. Its QR code is a demo placeholder and **does not download a guest photo**.
- Rotate between portrait and landscape during setup and the guest flow. Confirm every screen remains visible, the camera preview fills its frame, and no filter or action button is clipped.

## What to report

Please send back the iPad model and iPadOS version, whether Safari or the Home Screen icon was used, the SELPHY model and Wi-Fi setup, whether camera permission worked, and a photo of the printed test sheet. Note any missing printer choices, print-sheet settings, cropping, white borders, delays, blank screens or console/error messages.

## Trial limits

The trial ends 72 hours after first launch and also ends if the system clock is moved back by more than 10 minutes. It runs locally in that Safari site context. Clearing site data or using a different browser context can start a fresh trial. Settings, PIN, overlays, photos and the local queue use Safari storage; Safari may clear website data, so keep the site data during the test. Offline app-shell loading is supported after the first successful online load, but camera access and AirPrint still require the iPad's normal browser and network permissions.

This is a static demo build, not the production payment or photo-download service. The Canon SELPHY AirPrint workflow, borderless output, orientation changes and physical iPad behavior still need confirmation on the client's hardware.
