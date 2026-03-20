# Governance

EnClaws is not trying to be only a more talkative interface. Its goal is to gradually capture how enterprises actually operate in an open, collaborative, and evolvable AI runtime system.
That means it needs not only code, but also clear decision boundaries.

## 1. Governance Goals

Project governance focuses first on the following:

- Long-term maintainability of an enterprise-grade multi-user and multi-task runtime
- Clarity of security boundaries, isolation boundaries, and audit boundaries
- Evolvability of Skills, protocols, memory layers, and deployment models
- Explainable provenance, license compliance, and brand boundaries
- Alignment between community collaboration efficiency and long-term project direction

## 2. Roles

### Project Steward

The initial steward is the repository owner or maintainer, `hashSTACS`.
The steward is responsible for project direction, governance files, release authorization, key role appointments, and final judgment when disputes cannot be resolved otherwise.

### Maintainers

Maintainers handle day-to-day review, merging, releases, label management, roadmap progress, and community collaboration.
Maintainers are expected to be careful with code quality, security boundaries, licensing, and public-facing project behavior.

### Contributors

Contributors include anyone who submits issues, pull requests, documentation, designs, tests, benchmarks, feedback, or other improvements.
The size of a contribution does not determine the amount of respect it deserves.

## 3. Decision Rules

### Ordinary Changes

Documentation, tests, localized fixes, and non-breaking engineering improvements are typically decided through normal maintainer review.

### Changes That Need a Higher Review Threshold

The following changes require a more cautious merge bar:

- Changes related to security boundaries, permission models, tenant isolation, or audit trails
- Changes involving licenses, notices, third-party imports, provenance, or trademark policy
- Breaking changes to public APIs, protocols, configuration models, or data models
- Significant changes that affect the default deployment path, upgrade path, or enterprise operating model
- Changes to Governance, the Code of Conduct, the Security Policy, or the Trademark Policy

For these categories of changes, at least two maintainer approvals are recommended. If there are fewer than two active maintainers, the steward makes the final decision.

### Emergency Security Fixes

For urgent security issues that are realistically exploitable, maintainers may act first and complete documentation immediately after, but should add a repair record and disclosure notes as soon as practical.

## 4. Transparency

Unless security, privacy, compliance, or other confidentiality constraints require otherwise, project decisions should leave a record in one or more of the following places whenever possible:

- Issues
- Pull Requests
- Release Notes
- `CHANGELOG.md`
- ADRs or design notes when needed

## 5. Releases and Versioning

Releases are managed by the maintainers.
Each release should, where practical, explain:

- New capabilities
- Compatibility impact
- Configuration migration points
- Security fixes
- Third-party provenance or license changes, if any

## 6. Role Changes

The steward may add or remove maintainers based on sustained contribution, review quality, collaboration reliability, and project needs.
If the project later publishes a separate maintainer roster, a `MAINTAINERS` file or governance appendix can be added.

## 7. Conduct and Dispute Handling

Community conduct is governed by `CODE_OF_CONDUCT.md`.
Security issues are governed by `SECURITY.md`.
Brand and project-name issues are governed by `TRADEMARKS.md`.

When engineering goals, license boundaries, brand boundaries, and community consensus come into conflict, the order of priority is:

1. Compliance
2. Security
3. Truthful source identification
4. Maintainability
