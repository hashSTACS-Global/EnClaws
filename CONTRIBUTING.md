# Contributing to EnClaws

Thank you for helping turn an enterprise-grade digital assistant container platform from concept into a system that can actually run, be audited, and evolve.

This repository is still in an early public stage. The directory layout, build process, and development workflow may continue to evolve.
If some implementations, scaffolding, or internal modules have not yet been fully opened, please explain your intent in an Issue or PR first and we will try to keep the collaboration boundary clear.

## 1. Areas Where Contributions Are Welcome

We especially welcome contributions in the following areas:

- Container orchestration, job scheduling, and runtime isolation
- Multi-user identity awareness, tenant boundaries, and session isolation
- Layered memory, memory distillation, experience upgrades, and organizational knowledge accumulation
- Skill standards, sharing, governance, and compatibility layers
- Auditability, replay, state monitoring, cost governance, and risk controls
- Enterprise IM, WeCom, webhooks, channel integrations, and gateway adapters
- Documentation, tests, examples, deployment scripts, observability, and SRE-related work

## 2. What to Do Before a Larger Change

Before starting a larger change, please do the following:

1. Search existing Issues and PRs to avoid duplicate work.
2. If the change is substantial, open a discussion-style Issue first and explain the problem, approach, and expected impact.
3. Discuss breaking changes, license or trademark-related changes, and security-boundary changes before you start implementing.
4. If you plan to import code from an upstream project, identify the source repository, path, and license in the Issue or PR in advance.

## 3. Contribution Principles

We hope contributions will follow these engineering priorities:

1. **Isolation first**  
   One core value of EnClaws is an enterprise-grade multi-user, multi-task, multi-container runtime. Any design that could break tenant, identity, or session boundaries must be examined first.
2. **Auditability first**  
   Changes that affect behavior, evidence trails, accountability, or cost visibility should be recorded, replayable, and explainable whenever practical.
3. **Principle of least surprise**  
   Configuration, defaults, permission boundaries, and automation should not behave like hidden stage machinery.
4. **Compatibility and migration notes**  
   If a change affects configuration, environment variables, deployment, Skill interfaces, or message protocols, include migration notes.
5. **Documentation and implementation should move together**  
   If user-visible behavior changes, update the documentation too. Do not let the non-README docs become a disconnected lighthouse.

## 4. Pull Request Expectations

Please keep each PR focused on a single topic when possible. A good PR should usually:

- Explain what changed and why
- Include reproduction steps, comparison results, screenshots, or logs when behavior changes
- Describe migration and rollback steps if deployment or configuration changes are involved
- Add or update the necessary tests
- Avoid mixing unrelated refactors, formatting-only edits, or renames into the same PR
- Never include secrets, tokens, customer data, production configuration, or sensitive logs

The following commit prefixes are recommended, but not required:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `build:`
- `chore:`

## 5. Upstream Code and License Compliance

EnClaws has clear upstream references and derivative relationships, so contributors are expected to be honest about provenance.

If your PR copies, rewrites, ports, or substantially references content from a third-party project, please:

1. State the source repository, file paths, commit hash, or version in the PR description.
2. Confirm license compatibility and preserve the original copyright and license notices.
3. Add a clear modification notice to upstream-derived files that were changed.
4. Update `THIRD_PARTY_NOTICES.md`, `NOTICE`, and `LICENSES/third-party/` where needed.
5. Do not remove upstream authorship, copyright, trademark, or attribution notices that still apply.

## 6. Default License for Contributions

Unless you explicitly state otherwise at the time of submission and the maintainers explicitly accept a different arrangement, any code, documentation, or other copyrightable contribution you submit to this repository is contributed under the repository's top-level license.

That also means you should make sure you have the right to submit the contribution and that it does not introduce undisclosed third-party restrictions.

## 7. Do Not Report Security Issues Publicly

If you found a **security vulnerability**, do not file a public Issue.
Please follow the process described in `SECURITY.md` instead.

## 8. Communication Language

Chinese and English are both welcome.
Clarity and completeness matter more than the language itself.

## 9. Trademarks and Branding

If your change affects the project name, logo, package name, outward-facing marketing copy, derivative distribution naming, or brand presentation, please also read `TRADEMARKS.md`.
Open source code does not mean open season on branding.
