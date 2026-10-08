#!/bin/zsh
# Builds the alignment calibration tools against IINA's bundled libmpv.
set -e
cd "$(dirname "$0")"
mkdir -p build/mpv out
IINA_LIBS=/Applications/IINA.app/Contents/Frameworks
[ -f build/mpv/client.h ] || curl -sfL https://raw.githubusercontent.com/mpv-player/mpv/v0.38.0/libmpv/client.h -o build/mpv/client.h
clang -O1 -Ibuild mpvshot.c -o build/mpvshot "$IINA_LIBS/libmpv.2.dylib" -Wl,-rpath,"$IINA_LIBS"
swiftc -O webshot.swift -o build/webshot 2>/dev/null
swiftc -O compare.swift -o build/compare 2>/dev/null
echo "built tools/calibrate/build/{mpvshot,webshot,compare}"
