#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
package_path="$repository_root/native/macos-metal"
destination="$package_path/dist/coordsfinder-metal"

swift build \
  --package-path "$package_path" \
  --configuration release \
  --arch arm64

binary_path=$(swift build \
  --package-path "$package_path" \
  --configuration release \
  --arch arm64 \
  --show-bin-path)

mkdir -p "$(dirname -- "$destination")"
install -m 755 "$binary_path/coordsfinder-metal" "$destination"

echo "Built $destination"
