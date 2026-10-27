#!/usr/bin/env bash
# Puts the design system the usage page is built on into web/assets/: the styles and fonts of
# @openlinkos/ui, and each brand's marks (favicon and logos) from @openlinkos/vitepress-theme. The two
# packages share one version. The page's own files (site.css, head.js, site.js) and the neutral marks
# (brands/neutral/) are left alone.
# Run it only when upgrading the design system and commit the result: serving the page needs neither Node
# nor a build. The icons the page uses are inlined in web/index.html (Lucide, from @openlinkos/ui's
# icons.json); add new ones there by hand.
# Usage: scripts/vendor-ui.sh [version]. Requires curl, tar and openssl.
set -euo pipefail

VERSION="${1:-0.5.1}"
DEST="${DEST:-web/assets}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# fetch <package> <dir>: downloads @openlinkos/<package>@VERSION, checks its integrity, and unpacks it
# into <dir> (as npm packs it, under package/). Prints the integrity.
fetch() {
  local meta tarball integrity got
  meta="$(curl -fsSL "https://registry.npmjs.org/@openlinkos/$1/$VERSION")"
  # dist.tarball and dist.integrity each appear only once in the version metadata
  tarball="$(grep -o '"tarball":"[^"]*"' <<<"$meta" | head -n 1 | cut -d'"' -f4)"
  integrity="$(grep -o '"integrity":"[^"]*"' <<<"$meta" | head -n 1 | cut -d'"' -f4)"
  [ "${integrity%%-*}" = sha512 ] || { echo "Unknown integrity for $1: $integrity" >&2; exit 1; }
  curl -fsSL "$tarball" -o "$work/$1.tgz"
  got="sha512-$(openssl dgst -sha512 -binary "$work/$1.tgz" | openssl base64 -A)"
  [ "$got" = "$integrity" ] || { echo "Checksum mismatch for $1: expected $integrity, got $got" >&2; exit 1; }
  mkdir -p "$2"
  tar -xzf "$work/$1.tgz" -C "$2"
  echo "$integrity"
}

ui_id="$(fetch ui "$work/ui")"
theme_id="$(fetch vitepress-theme "$work/theme")"
ui="$work/ui/package"
brands="$work/theme/package/dist/brand"

# Replace only what comes from the packages
mkdir -p "$DEST/brands"
rm -rf "$DEST/ui.css" "$DEST/fonts" "$DEST"/LICENSE-*.txt "$DEST/VERSION" "$DEST/brands/NOTICE.txt"
for dir in "$DEST"/brands/*/; do
  [ -d "$dir" ] && [ "$(basename "$dir")" != neutral ] && rm -rf "$dir"
done

mkdir -p "$DEST/fonts"
cp "$ui/dist/ui.css" "$DEST/"
cp "$ui/dist/fonts/"*.woff2 "$DEST/fonts/"
cp "$ui/LICENSE" "$DEST/LICENSE-openlinkos-ui.txt"
for f in "$ui"/dist/LICENSE-* "$ui"/dist/fonts/LICENSE-*; do
  [ -e "$f" ] && cp "$f" "$DEST/"
done
for dir in "$brands"/out/*/; do
  id="$(basename "$dir")"
  mkdir -p "$DEST/brands/$id"
  cp "$dir/web/favicon.svg" "$dir/web/logo.svg" "$dir/web/logo-dark.svg" "$DEST/brands/$id/"
done
cat >"$DEST/brands/NOTICE.txt" <<'EOF'
The OpenLinkOS and LinkOS names and marks in this directory (except neutral/) are not covered by the
licence of the code. They are for OpenLinkOS and LinkOS services; see the brand guidelines at
https://openlinkos.com/brand.
EOF
printf '%s\n' "@openlinkos/ui $VERSION" "$ui_id" "@openlinkos/vitepress-theme $VERSION" "$theme_id" >"$DEST/VERSION"
echo "Updated $DEST to @openlinkos/ui and @openlinkos/vitepress-theme $VERSION"
