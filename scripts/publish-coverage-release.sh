#!/usr/bin/env bash
# Replaces unit.json or e2e.json on the coverage-badges release.
# A release asset is not a git commit, so a coverage change does not add one.
set -euo pipefail

file="${1:?usage: publish-coverage-release.sh <unit.json|e2e.json>}"
tag=coverage-badges

if ! gh release view "$tag" >/dev/null 2>&1; then
  # The other coverage job may create the release at the same moment.
  gh release create "$tag" \
    --latest=false \
    --title "Coverage badges" \
    --notes "Shields.io reads these files. CI replaces them when coverage changes. That is not a git commit." \
    || gh release view "$tag" >/dev/null
fi

gh release upload "$tag" "$file" --clobber
echo "Published $(basename "$file") to $tag"
