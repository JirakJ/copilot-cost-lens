# Local Braces security backport

`braces-3.0.4-security.1.tgz` is a local fork of published Braces 3.0.3, not an
upstream release. It backports the depth checks from the **open, unmerged**
[upstream PR 72](https://github.com/micromatch/braces/pull/72), pinned to commit
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, for CVE-2026-93687 /
GHSA-vfj7-8cjw-p6xm. Five implementation files and the upstream README are
replaced by checksum-pinned files; only the package version is changed otherwise.
The original MIT license is retained in the archive and `braces-LICENSE`.

Parsing and recursive AST traversal reject nesting above 100, including attempts
to raise `maxDepth` above that limit. Very deeply nested patterns now throw a
controlled error. This is a compatibility boundary for callers that used such
patterns. Normal patterns pass the upstream suite and the installed-package
regression retained in the workspace security audit.

Keep this directory's archive, recipe, provenance and license together. Run
`python3 vendor/build_braces.py` from the project root to fetch the pinned public
sources and reproduce the archive byte for byte. After a frozen dependency
installation, the workspace audit script can verify the installed package using
`node developer-id-rotation-20261002/test-braces.mjs /absolute/project/path`. Do not substitute a version-only
change for the actual code patch. The original 3.0.3 version was queried directly
against OSV to check for additional inherited advisories.

Review and replace this backport when an official fixed release is published.
The local version is intentionally distinct and must never be described as a
publisher-issued 3.0.4 release.
