# Build trees and git-ignored paths are never scanned or edited. See prepare_ignore in
# lib.sh for what surrounds the project here.

PROTECTED="builds build-release ide-out generated/views generated/rcc.qrc gen/drop.qml views/build"

echo "== a move surrounded by build trees and ignored files =="
prepare_ignore
before="$(snap "$IGN" $PROTECTED)"
move "$IGN" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "Main.qml gains import vince" "$(imports "$IGN/Main.qml")" 'import "components";import "views";import "vince";'
check "no ambiguity from copies in ignored folders" "$(grep -c '^  !' "$LAST")" "0"
check "every build and ignored file byte-identical" "$(snap "$IGN" $PROTECTED)" "$before"
check "negated rule: gen/keep.qml belongs to the project" "$(imports "$IGN/gen/keep.qml")" 'import "../vince";'
check "committed despite a rule: generated/forced.qml updated" "$(imports "$IGN/generated/forced.qml")" 'import "../vince";'
check "log counts git-ignored files" "$(grep -cE '^  skipping [0-9]+ file\(s\) ignored by git' "$LAST")" "1"

echo "== renaming a QML copy inside builds/ changes nothing =="
prepare_ignore
move "$IGN" '[["builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/views/BasicsView.qml","builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/views/Foo.qml"]]'
check "nothing edited or saved" "$(grep '^SAVED:' "$LAST"),$(changed "$IGN")" "SAVED: ,0"
check "log explains why" "$(grep -c 'moved inside a build or ignored directory; nothing to update' "$LAST")" "1"

echo "== renaming inside a .gitignore'd folder changes nothing =="
prepare_ignore
move "$IGN" '[["generated/views/BasicsView.qml","generated/views/Foo.qml"]]'
check "nothing edited or saved" "$(grep '^SAVED:' "$LAST"),$(changed "$IGN")" "SAVED: ,0"

echo "== a build-* folder is skipped even when git tracks it =="
prepare_ignore
move "$IGN" '[["build-release/Test/views/BasicsView.qml","build-release/Test/views/Foo.qml"]]'
check "nothing edited" "$(grep '^SAVED:' "$LAST"),$(grep -c 'BasicsView {}' "$IGN/Main.qml")" "SAVED: ,1"

echo "== useGitignore = false: git-ignored files are processed, build trees still are not =="
prepare_ignore
before="$(snap "$IGN" builds build-release views/build)"
SETTINGS='{"useGitignore":false}' move "$IGN" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "git-ignored generated/rcc.qrc now updated" "$(grep -c '>../vince/BasicsView.qml<' "$IGN/generated/rcc.qrc")" "1"
check "build trees still byte-identical" "$(snap "$IGN" builds build-release views/build)" "$before"

echo "== not a git repository: build trees still skipped, and the log says so =="
prepare_ignore
NOREPO="$WORK/ignore-norepo"
rm -rf "$NOREPO" && cp -r "$IGN" "$NOREPO" && rm -rf "$NOREPO/.git"
before="$(snap "$NOREPO" builds build-release views/build)"
move "$NOREPO" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "log: .gitignore not applied" "$(grep -c '.gitignore not applied in .*not a git repository, or git not found' "$LAST")" "1"
check "build trees byte-identical" "$(snap "$NOREPO" builds build-release views/build)" "$before"
check "Main.qml still updated" "$(imports "$NOREPO/Main.qml")" 'import "components";import "views";import "vince";'

echo "== moving a folder that contains a build folder =="
prepare_ignore
orig="$(git hash-object "$IGN/views/build/CopyView.qml")"
move "$IGN" '[["views","pages"]]'
check "nested build file carried along unedited" "$(git hash-object "$IGN/pages/build/CopyView.qml")" "$orig"
check "sources still followed" "$(imports "$IGN/Main.qml")" 'import "components";import "pages";'
check "log notes the left-out file" "$(grep -c '1 moved file(s) inside build or ignored directories left out' "$LAST")" "1"
