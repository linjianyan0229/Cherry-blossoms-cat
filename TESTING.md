# Testing and Build Isolation Rules

## Mandatory location

**All NapCat project code execution must take place on the maintainer-designated remote test server and inside a dedicated, disposable test container there.** This applies to dependency installation, package scripts, type checking, unit tests, builds, smoke tests, and application startup.

Do not execute project code, install project dependencies, or run any project tests/builds on the developer workstation, a production machine, or a GitHub-hosted runner. Do not enable GitHub Actions that run this repository's tests. The upstream workflows are archived under `.github/upstream-workflows-disabled/` and must stay outside `.github/workflows/` unless the test-execution policy is deliberately revised.

## Isolation requirements

Before running a job, verify the destination is the designated test server and use a fresh per-job checkout under a new, dedicated path. The job container must:

- run as an unprivileged UID, with Linux capabilities dropped and `no-new-privileges` enabled;
- use its own Docker bridge network, not host networking and not any network used by existing services;
- have no published ports, Docker socket, SSH agent, privileged mode, or access to production files;
- mount only the checkout and disposable scratch space;
- contain no production `.env`, API tokens, QQ session/profile, NapCat data, logs, or database;
- use only test accounts and test fixtures; never direct integration tests to production endpoints.

Inspect the container's mounts and network attachments before execution. If the server, container, mounts, or target endpoints cannot be shown to be isolated from production, stop without running the job.

## Baseline verification commands

The archived CI used Node 20.x and pnpm 9. For reproducibility, prepare a Node 20 container on the designated remote test host and use pnpm 9 with the committed lockfile. Commands below are examples to run **inside that isolated remote container only**:

```sh
export PNPM_HOME=/tmp/pnpm-home
mkdir -p "$PNPM_HOME"
corepack prepare pnpm@9.15.9 --activate
corepack enable --install-directory "$PNPM_HOME"
export PATH="$PNPM_HOME:$PATH"
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
```

Build validation is also remote-only. Set `NAPCAT_VERSION=4.18.42` when reproducing the archived release. Run only the build target under investigation after type checking and tests pass.

The Linux remote test job does not replace Windows-specific loader checks or a deliberately provisioned, non-production QQ end-to-end test. Do not run those checks on a production QQ account or server.

