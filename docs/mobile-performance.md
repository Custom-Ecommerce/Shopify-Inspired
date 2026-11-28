# Phone apps: performance and release checks (seller app)

## Budgets

| What | Budget | Measured |
| --- | --- | --- |
| Cold start to the dashboard, installed release build, 2 GB RAM Android | under 3 s | **not measured yet** (owner) |
| Scrolling the orders list (200+ rows loaded) | no visible stutter; janky frames under 10 % | **not measured yet** (owner) |
| Memory after browsing orders and products | under 300 MB (PSS) | **not measured yet** (owner) |
| JavaScript bundle (Hermes bytecode) | watch for growth | 4.0 MB (seller), plus about 25 KB of images and 0.6 MB of fonts (Poppins, 4 weights) (`expo export`, 2026-11-27, S9-UI; it was 3.7 MB before the icons and the new components) |

## What the code does for speed

- Hermes bytecode and the New Architecture (Expo SDK 58 defaults). Release builds shrink code and resources with R8 (`app.json`, `expo-build-properties`).
- Lists are FlashList 2 (it measures rows itself: no estimated size is given or needed), with record ids as keys, memoised rows and stable `renderItem`.
- Product photos are asked for at the size shown (Cloudinary transformation) and kept on the phone (`expo-image`, disk cache).
- Nothing waits at start: the saved session is read without a network; push registration (2 s) and sending queued changes (1.5 s) come after the first screen.
- The saved cache shows the last data at once, then refreshes.

## How to measure on a low-end phone

Expo Go numbers are not release numbers: it is a development bundle. Use an installed build (`eas build --platform android --profile preview`).

Any phone, without a computer:

1. Settings tab, "Last start to first screen": the time from the app's code starting to the dashboard with data.
2. Force-stop the app, start a stopwatch as you tap the icon, stop it when the dashboard shows numbers. Take the median of 5 runs. This is the cold start.

With Android platform-tools (no Android Studio), USB debugging on:

```
adb shell am force-stop com.markazify.seller
adb shell am start -W -n com.markazify.seller/.MainActivity      # TotalTime = time to the first window
adb shell dumpsys gfxinfo com.markazify.seller reset
#  now scroll the orders list for 20 seconds
adb shell dumpsys gfxinfo com.markazify.seller                   # "Janky frames"
adb shell dumpsys meminfo com.markazify.seller                   # "TOTAL PSS"
```

Write the numbers into the table above, with the phone's model and Android version.

## Release checks

| Check | State |
| --- | --- |
| No debug switch in `app.json` or `eas.json`; a release build refuses a non-https server address | tested |
| Nothing is written to the console by the app or `packages/mobile-kit`; tokens only in encrypted storage | tested |
| R8 code and resource shrinking on | set in `app.json`; takes effect in an EAS build, not verifiable here |
| Android 8.0 (API 26) and newer: `minSdkVersion` 26 | set; try it on an Android 8 phone before release |
| No access to the phone's files (storage permissions blocked) | tested |
| Backups: cached data excluded (`allowBackup: false`) | tested |
