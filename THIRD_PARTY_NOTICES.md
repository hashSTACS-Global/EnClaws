# Third-Party Notices

This file supplements the top-level `LICENSE` and `NOTICE` files and records copyright, license, and provenance information for direct upstreams, rewritten sources, and key reference implementations used by EnClaws.

## 1. General Principles

- The EnClaws repository as a whole is distributed under the Apache License 2.0.
- For code, documentation, scripts, or substantial portions imported from third-party projects, the original copyright notices, license texts, and required attribution notices must be preserved.
- When a file imported from upstream is modified, maintainers should add a clear notice in the file header, file comments, or an equally visible location, such as `modified by EnClaws contributors`.
- When adding a new third-party source, please update this file, `NOTICE`, and the `LICENSES/third-party/` directory together.

## 2. Immediate Upstreams

### 2.1 openclaw/openclaw

- Project name: OpenClaw - Personal AI Assistant
- Repository: <https://github.com/openclaw/openclaw>
- License published by the upstream repository: MIT License
- Copyright notice in the upstream license: `Copyright (c) 2025 Peter Steinberger`

**Role in EnClaws**

According to the EnClaws project description, OpenClaw is an important foundation for this project. EnClaws extends that foundation toward enterprise-grade containerized management, multi-user isolation, layered memory, skill sharing, and audit capabilities.

### 2.2 luolin-ai/openclawWeComzh

- Project name: openclawWeComzh
- Repository: <https://github.com/luolin-ai/openclawWeComzh>
- Repository relationship: marked on GitHub as `forked from openclaw/openclaw`
- License published by the upstream repository: MIT License
- Copyright notice in the upstream license: `Copyright (c) 2025 Peter Steinberger`

**Role in EnClaws**

According to the EnClaws project description, openclawWeComzh provides important reference material and implementation grounding for Chinese-language usage, WeCom adaptation, and enterprise IM scenarios.

## 3. Retention Requirements When Importing Upstream Code

When maintainers import, rewrite, or transplant code from upstream projects, they should at least:

1. Preserve the original copyright and license header in the upstream file, if present.
2. Add a clear modification notice to files changed by EnClaws.
3. Avoid removing copyright, trademark, authorship, or attribution notices that still apply to the file.
4. If a file has been completely rewritten and no longer contains substantial upstream expression, the no-longer-applicable notice may be removed after confirmation, but it is still recommended to preserve provenance in commit history or in this file.

## 4. License Text: openclaw/openclaw (MIT)

```text
MIT License

Copyright (c) 2025 Peter Steinberger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. License Text: luolin-ai/openclawWeComzh (MIT)

```text
MIT License

Copyright (c) 2025 Peter Steinberger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 6. No Upstream Endorsement

The provenance and acknowledgments in this file are included solely for compliance, attribution, and source-identification purposes. They do not imply endorsement, warranty, partnership, or sponsorship of EnClaws by any upstream maintainer, organization, or brand.

Third-party project names, logos, and trademarks remain the property of their respective owners.
