#!/bin/zsh
# Packs only the files the plugin needs at runtime into dist/iina-english-coach-<version>.iinaplgz.
set -e
cd "$(dirname "$0")/.."
version=$(node -p 'require("./Info.json").version')
stage=$(mktemp -d)
mkdir -p "$stage/iina-english-coach/ui" dist
cp -R Info.json LICENSE README.md src "$stage/iina-english-coach/"
cp ui/overlay.html ui/preferences.html "$stage/iina-english-coach/ui/"
(cd "$stage" && /Applications/IINA.app/Contents/MacOS/iina-plugin pack iina-english-coach >/dev/null)
mv "$stage/iina-english-coach-$version.iinaplgz" dist/
rm -rf "$stage"
echo "dist/iina-english-coach-$version.iinaplgz"
