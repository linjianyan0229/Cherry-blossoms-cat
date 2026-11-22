# Maintenance Notes

Cherry-blossoms-cat starts from the NapCat v4.18.42 source snapshot and uses its own release version series beginning with 0.0.1.

## Baseline

- Upstream release: `v4.18.42`
- Upstream source commit: `9335843246e3b7a17944861f3ac8731a259732c2`
- Archive export date: 2026-11-21
- Reproducible build version: set `NAPCAT_VERSION=4.18.42`

The NapCat release version and the installed QQ/NTQQ client version are separate. Track both when investigating compatibility.

## QQ/NTQQ compatibility checklist

Linux QQ 的官方版本来源、维护清单、检查命令和每个版本的验证步骤见 [LINUX_QQ_MAINTENANCE.md](LINUX_QQ_MAINTENANCE.md)。

When a QQ/NTQQ update changes behavior, identify its full version and build first, then inspect the relevant compatibility surfaces:

1. QQ version/build discovery and AppID/QUA selection in `packages/napcat-core/helper/qq-basic-info.ts` and `packages/napcat-core/external/appid.json`.
2. QQ-native `wrapper.node` discovery and service declarations in `packages/napcat-core/index.ts` and `packages/napcat-core/wrapper.ts`.
3. Build-gated API/service branches using `requireMinNTQQBuild`.
4. OS/architecture native add-on availability and version-specific packet offsets in `packages/napcat-core/packet/` and `packages/napcat-core/external/packet.json`.
5. Focused version/native tests in `packages/napcat-test/`, followed by the remote-only checks in [TESTING.md](TESTING.md).

QQ supplies `wrapper.node`; this repository contains TypeScript declarations/adapters around that native interface, not QQ's native implementation. A TypeScript build alone does not establish compatibility with a newly released QQ client.

## Distribution

The owner has authorized this maintenance line and configured the repository's audience. Preserve the original NapCat license, source provenance, and bundled component license notices in both source and release packages. Do not widen the audience or change licensing without the owner's explicit instructions.

## Branch and release policy

All changes to `main` go through a pull request and require explicit authorization from the owner. GitHub branch protection requires the commit-title check, resolved conversations, and linear history; force pushes, deletion, and administrator bypass are disabled. See [CONTRIBUTING.md](CONTRIBUTING.md) for the mandatory Chinese commit-title format.

GitHub Actions may build and package authorized release tags. Project tests and type checking remain restricted to the designated isolated remote server as documented in [TESTING.md](TESTING.md).

