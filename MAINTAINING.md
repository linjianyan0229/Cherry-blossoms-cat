# Private Maintenance Notes

This private maintenance repository starts from the NapCat v4.18.42 source snapshot.

## Baseline

- Upstream release: `v4.18.42`
- Upstream source commit: `9335843246e3b7a17944861f3ac8731a259732c2`
- Archive export date: 2026-11-21
- Reproducible build version: set `NAPCAT_VERSION=4.18.42`

The NapCat release version and the installed QQ/NTQQ client version are separate. Track both when investigating compatibility.

## QQ/NTQQ compatibility checklist

When a QQ/NTQQ update changes behavior, identify its full version and build first, then inspect the relevant compatibility surfaces:

1. QQ version/build discovery and AppID/QUA selection in `packages/napcat-core/helper/qq-basic-info.ts` and `packages/napcat-core/external/appid.json`.
2. QQ-native `wrapper.node` discovery and service declarations in `packages/napcat-core/index.ts` and `packages/napcat-core/wrapper.ts`.
3. Build-gated API/service branches using `requireMinNTQQBuild`.
4. OS/architecture native add-on availability and version-specific packet offsets in `packages/napcat-core/packet/` and `packages/napcat-core/external/packet.json`.
5. Focused version/native tests in `packages/napcat-test/`, followed by the remote-only checks in [TESTING.md](TESTING.md).

QQ supplies `wrapper.node`; this repository contains TypeScript declarations/adapters around that native interface, not QQ's native implementation. A TypeScript build alone does not establish compatibility with a newly released QQ client.

## Distribution

This repository is a private, personal maintenance line. Do not enable public visibility or distribute source/builds without rechecking the applicable authorization and component licenses. The root NapCat license is retained unchanged; review licenses for bundled components separately.

