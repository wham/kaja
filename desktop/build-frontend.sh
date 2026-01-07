#!/bin/bash
set -e

cd ..
source scripts/common
install_protoc

cd server
go run cmd/build-ui/main.go

cd ../desktop
rm -rf frontend/dist
mkdir -p frontend/dist
cp ../server/build/main.css frontend/dist/
cp ../server/build/main.js frontend/dist/
cp -r ../server/static frontend/dist/
mv frontend/dist/static/index.html frontend/dist/index.html
