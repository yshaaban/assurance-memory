#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/java
find services/core/src/main/java -name '*.java' -print > .build/java-sources.txt
find services/core/src/test/java -name '*.java' -print >> .build/java-sources.txt
javac -encoding UTF-8 --release 21 -d .build/java @.build/java-sources.txt
cp -R services/core/src/main/resources/. .build/java/
java -ea -cp .build/java dev.assurance.core.CoreSelfTest
