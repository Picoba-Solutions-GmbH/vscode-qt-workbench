#!/usr/bin/env bash
# Runs the extension's tests: every suite in test/cases, or only the ones named.
#
#   test/run.sh                  all suites
#   test/run.sh renames ignore   only these
#
# Needs bash, git and GNU sed (Git Bash on Windows, or Linux), plus a JavaScript
# runtime: Node.js if installed, otherwise the one inside VS Code.
#
#   NODE=/path/to/node      use this runtime
#   EXT_DIR=<folder>        test another copy of the extension, e.g. the installed one
#   KEEP_WORK=1             keep the temporary projects (they are always kept on failure)

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
find_runtime

suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(moves saving renames classes deletes newfiles newproject ignore explorer vcpkg packages hotreload debugsetup gdb)
for suite in "${suites[@]}"; do
  if [ ! -f "$TEST_DIR/cases/$suite.sh" ]; then
    echo "No such suite: $suite (have: $(cd "$TEST_DIR/cases" && ls *.sh | sed 's/\.sh$//' | tr '\n' ' '))" >&2
    exit 2
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qt-workbench-tests.XXXXXX")"
echo "runtime: ${RUNTIME[*]}"
echo "extension: ${EXT_DIR:-$(cd "$TEST_DIR/.." && pwd)}"

for suite in "${suites[@]}"; do
  echo
  echo "### $suite"
  source "$TEST_DIR/cases/$suite.sh"
done

echo
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ] && [ -z "${KEEP_WORK:-}" ]; then
  rm -rf "$WORK"
else
  echo "test projects kept in $WORK"
fi
[ "$FAIL" -eq 0 ]
