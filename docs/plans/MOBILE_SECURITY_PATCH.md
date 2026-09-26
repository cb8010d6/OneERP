# Mobile Metro security patch

Issue 26 came from `image-size@1.2.1`, pulled by Metro 0.83.7 through both Expo and React Native CLI dependency paths. The advisories cover malformed JXL/HEIF and ICNS parser inputs that can hang Node’s event loop.

Expo’s SDK 55 patch releases provide a compatible fix: set Expo to `~55.0.31`, Expo Camera to `~55.0.23`, and React Native to `0.83.10`. Expo 55.0.31 resolves `@expo/metro@55.1.2` and Metro 0.83.8. Aligning React Native to the SDK 55 recommendation also moves its CLI Metro path to 0.83.8. Both paths now share Metro 0.83.8; the lock contains no `image-size` and needs no Metro override. These remain Expo SDK 55, React Native 0.83, and React 19.2 versions.

Metro 0.83.8 replaces `image-size` with its own bounds-checked image-dimension parsers. Its upstream change preserves Metro’s supported asset formats and adds malformed-input tests. See the [Metro 0.83.8 release](https://github.com/react/metro/releases/tag/v0.83.8), [upstream parser change and test plan](https://github.com/react/metro/pull/1860), and [GitHub advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).

## Validation

- Final clean `npm ci` — passed; the earlier `--ignore-scripts` install also passed.
- `npm audit --audit-level=high` — passed; zero vulnerabilities.
- `npm ls metro image-size --all` — Expo and React Native CLI both resolve Metro 0.83.8; no `image-size` entry.
- `CI=1 EXPO_OFFLINE=1 npx expo install --check` — reports dependencies up to date. Offline mode warns that validation is less reliable; the online check could not complete because the configured HTTP proxy timed out.
- `npx tsc --noEmit` — passed.
- `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` and `--platform ios` — both Metro exports passed.

The exports validate JavaScript and asset bundling for both platforms. No native Android/iOS build or device run was performed. Expo SDK 55 targets React Native 0.83 and React 19.2; see the [SDK compatibility table](https://docs.expo.dev/versions/v55.0.0/) and [Expo package validation guidance](https://docs.expo.dev/more/expo-cli/#install).
