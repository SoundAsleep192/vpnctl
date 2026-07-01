# vpnctl Documentation

This folder is the long-form source of truth for vpnctl. Keep README short,
keep AGENTS.md operational, and put durable project knowledge here.

## Reading order

1. [Project rules](project-rules.md) - repo-specific rules for humans and agents.
2. [Architecture](architecture.md) - runtime model, data flow, and safety invariants.
3. [Project structure](project-structure.md) - where code, templates, tests, and
   scripts live.
4. [Workflows](workflows.md) - development, install, release, and issue workflow.
5. [Testing](testing.md) - quality gates, unit test style, E2E tier, live validation.
6. [Operations](operations.md) - common local commands, logs, paths, and recovery
   checks.

## Product model

vpnctl protects configured domains and protected agent processes. It currently has
two protection surfaces:

- Host protection: macOS pf, DNS sinkhole, launchd daemons, and sing-box VLESS/Reality.
- Sandbox protection: Docker sidecar VPN namespace with a namespace-local killswitch.

The product should not be described as "AI domains only" unless the text is about the
default seed template. Users can protect any domains they configure.

## Documentation rule

Architecture, workflow, safety, install, and testing changes should update this
folder in the same worktree. If a new behavior is important enough to debug twice,
it is important enough to document once.
