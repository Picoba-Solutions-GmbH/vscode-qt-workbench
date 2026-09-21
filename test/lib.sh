# Helpers shared by the test cases. Sourced by run.sh; not meant to be run directly.
#
# Every test works on a fresh copy of a fixture in $WORK, a temporary directory outside
# this repository. Fixtures are plain source trees. Build trees and .gitignore files
# are generated here rather than checked in: committed, they would be ignored by this
# repository's own git and silently go missing.

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$TEST_DIR/fixtures"
LAST=""   # output of the most recent move: SAVED line, extension log, diff

PASS=0
FAIL=0

# --- JavaScript runtime ------------------------------------------------------------

# Node if it is installed; otherwise the Node that ships inside VS Code, which runs
# plain scripts when ELECTRON_RUN_AS_NODE is set. NODE=/path/to/node overrides both.
find_runtime() {
  if [ -n "${NODE:-}" ]; then RUNTIME=("$NODE"); return; fi
  if command -v node >/dev/null 2>&1; then RUNTIME=(node); return; fi

  local local_app_data="${LOCALAPPDATA:-}"
  if [ -n "$local_app_data" ] && command -v cygpath >/dev/null 2>&1; then
    local_app_data="$(cygpath -u "$local_app_data")"
  fi
  local candidate
  for candidate in \
    "$local_app_data/Programs/Microsoft VS Code/Code.exe" \
    "/c/Program Files/Microsoft VS Code/Code.exe" \
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
    "/usr/share/code/code"; do
    if [ -x "$candidate" ]; then
      export ELECTRON_RUN_AS_NODE=1
      RUNTIME=("$candidate")
      return
    fi
  done
  echo "No JavaScript runtime found: install Node.js, or set NODE=/path/to/node." >&2
  exit 2
}

# --- running and checking ----------------------------------------------------------

# move <project root> <JSON list of [old, new] paths relative to the root>
# Environment passed through to the harness: SETTINGS, DIRTY, AUTOSAVE, LS_STRINGS, EXT_DIR.
move() {
  LAST="$WORK/last-move.log"
  "${RUNTIME[@]}" "$TEST_DIR/harness.js" "$1" "$2" > "$LAST" 2>&1
}

# delete <project root> <path relative to the root>...
# Deletes files or folders through the extension, as the explorer's Delete does.
delete() {
  local root="$1" list=""
  shift
  for p in "$@"; do list="$list${list:+,}\"$p\""; done
  move "$root" "{\"delete\":[$list]}"
}

# rename_symbol <project root> <file> <symbol> <new name> [<C++ files the language server renames in>]
# Rename Symbol (F2) on the first <symbol> in <file>. A fake language server renames it in
# every C/C++ file outside build folders, or only in the comma-separated files given.
rename_symbol() {
  local only=""
  [ -n "${5:-}" ] && only=",\"cppFiles\":[\"${5//,/\",\"}\"]"
  move "$1" "{\"file\":\"$2\",\"symbol\":\"$3\",\"newName\":\"$4\"$only}"
}

# new_file <project root> <qml|source|header> <right-clicked folder or file, or - for the palette> <name>
# Runs New QML File / New C++ Source File / New C++ Header File, typing <name> in the input box.
new_file() {
  local command
  case "$2" in
    qml) command=qtWorkbench.newQmlFile ;;
    source) command=qtWorkbench.newCppSource ;;
    header) command=qtWorkbench.newCppHeader ;;
  esac
  local at=",\"at\":\"$3\""
  [ "$3" = "-" ] && at=""
  move "$1" "{\"command\":\"$command\",\"name\":\"$4\"$at}"
}

# explore <project root> <JSON list of steps>
# Clicks through the Qt Project Explorer step by step; the steps are described in harness.js.
explore() {
  move "$1" "{\"explorer\":$2}"
}

# printed <n>: what the n-th step of the last explore printed, line by line.
printed() {
  awk -v n="$1" 'index($0, "> ") == 1 { i++; next } /^(=====|SAVED:)/ { i = 0 } i == n { sub(/^  /, ""); print }' "$LAST"
}

# check <description> <actual> <expected>
check() {
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
    echo "  ok   $1"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL $1"
    echo "       expected: $3"
    echo "       actual:   $2"
  fi
}

# The quoted (directory and file) imports of a QML file, joined with ';'.
imports() { grep -E '^import "' "$1" | tr '\n' ';'; }

# How many files under a project path git reports as changed.
changed() { (cd "$1" && git status --porcelain -- "${@:2}" | grep -c .); }

# Content hashes of every file under the given paths of a project. git hash-object
# rather than md5sum: git is needed anyway, and it works outside a repository too.
snap() {
  local root="$1"; shift
  (cd "$root" && find "$@" -type f 2>/dev/null | sort | while IFS= read -r f; do
    printf '%s %s\n' "$(git hash-object "$f")" "$f"
  done)
}

commit_all() {
  (cd "$1" && git init -q . && git add -A && git -c user.email=test@example.com -c user.name=test commit -qm base) >/dev/null 2>&1
}

# Commit whatever changed, so the next check of `changed` starts from zero.
commit_changes() { # commit_changes <project root> <message>
  (cd "$1" && git add -A && git -c user.email=test@example.com -c user.name=test commit -qm "$2") >/dev/null 2>&1
}

fresh_copy() { # fresh_copy <fixture name> <destination>
  rm -rf "$2" && mkdir -p "$(dirname "$2")" && cp -r "$FIXTURES/$1" "$2"
}

# --- fixtures ----------------------------------------------------------------------

# A build tree like the Qt VS Code extension's: a CMakeCache.txt, stale copies of the
# views in both places BasicsView has lived, and a generated .qrc that points back into
# the sources -- were the tree ever scanned, that reference would be rewritten.
add_build_tree() { # add_build_tree <project root> <views|vince>
  local b="$1/builds/Qt-6.11.2-mingw_64-x86_64/Debug"
  mkdir -p "$b/Test/views" "$b/Test/vince" "$b/.qt/rcc"
  printf '# This is the CMakeCache file.\nCMAKE_BUILD_TYPE:STRING=Debug\n' > "$b/CMakeCache.txt"
  cp "$1"/views/*.qml "$b/Test/views/"
  cp "$1/$2/BasicsView.qml" "$b/Test/views/BasicsView.qml"
  cp "$1/$2/BasicsView.qml" "$b/Test/vince/BasicsView.qml"
  printf '<RCC>\n  <qresource prefix="/qt/qml/Test">\n    <file alias="%s/BasicsView.qml">../../../../../%s/BasicsView.qml</file>\n  </qresource>\n</RCC>\n' \
    "$2" "$2" > "$b/.qt/rcc/appTest_raw_qml_0.qrc"
}

# prepare_app <views|vince>: the demo app, with BasicsView.qml in views/ or in vince/
# (then also listed there in CMakeLists.txt and imported by Main.qml), plus a build tree.
prepare_app() {
  APP="$WORK/app"
  fresh_copy qt-app "$APP"
  if [ "$1" = "vince" ]; then
    mkdir -p "$APP/vince"
    mv "$APP/views/BasicsView.qml" "$APP/vince/BasicsView.qml"
    sed -i 's#views/BasicsView.qml#vince/BasicsView.qml#' "$APP/CMakeLists.txt"
    sed -i 's#^import "views"$#import "views"\nimport "vince"#' "$APP/Main.qml"
  fi
  add_build_tree "$APP" "$1"
  commit_all "$APP"
}

prepare_resources() { RES="$WORK/resources"; fresh_copy qml-resources "$RES"; commit_all "$RES"; }
prepare_siblings()  { SIBS="$WORK/siblings"; fresh_copy qml-siblings "$SIBS"; commit_all "$SIBS"; }
prepare_types()     { TYPES="$WORK/types"; fresh_copy qml-types "$TYPES"; commit_all "$TYPES"; }
prepare_cpp()       { CPP="$WORK/cpp"; fresh_copy cpp-types "$CPP"; commit_all "$CPP"; }
prepare_widgets()   { WID="$WORK/widgets"; fresh_copy qt-widgets "$WID"; commit_all "$WID"; }

# prepare_ignore: the demo app surrounded by everything that must never be edited.
#
#   builds/          build tree: folder name, CMakeCache.txt and .gitignore all apply
#   build-release/   build folder by name only: not in .gitignore, and committed
#   ide-out/         ignored by its own nested .gitignore (as CLion writes one)
#   generated/       ignored by the root .gitignore, but forced.qml is committed anyway
#   gen/             gen/* ignored, except keep.qml through a negation
#   views/build/     a build folder nested inside a source folder
#
# The root .gitignore starts with a UTF-8 byte-order mark, as some editors write it.
prepare_ignore() {
  prepare_app views
  IGN="$WORK/ignore"
  rm -rf "$IGN" && cp -r "$APP" "$IGN" && rm -rf "$IGN/.git"

  printf '\xEF\xBB\xBFbuild\nbuilds\n.idea\n.qtcreator\n.vs\ngenerated/\ngen/*\n!gen/keep.qml\n' > "$IGN/.gitignore"

  mkdir -p "$IGN/build-release/Test/views"
  cp "$IGN/views/BasicsView.qml" "$IGN/build-release/Test/views/"

  mkdir -p "$IGN/ide-out/copy"
  printf '*\n' > "$IGN/ide-out/.gitignore"
  cp "$IGN/Main.qml" "$IGN/ide-out/copy/Main.qml"

  mkdir -p "$IGN/generated/views" "$IGN/gen" "$IGN/views/build"
  cp "$IGN/views/BasicsView.qml" "$IGN/generated/views/"
  printf '<RCC><qresource prefix="/">\n<file>../views/BasicsView.qml</file>\n</qresource></RCC>\n' > "$IGN/generated/rcc.qrc"
  local uses_basics='import QtQuick\nimport "../views"\nItem { BasicsView {} }\n'
  printf "$uses_basics" > "$IGN/generated/forced.qml"
  printf "$uses_basics" > "$IGN/gen/keep.qml"
  printf "$uses_basics" > "$IGN/gen/drop.qml"
  printf 'import QtQuick\nimport ".."\nItem { BasicsView {} }\n' > "$IGN/views/build/CopyView.qml"

  (cd "$IGN" && git init -q . && git add -A && git add -f generated/forced.qml build-release \
    && git -c user.email=test@example.com -c user.name=test commit -qm base) >/dev/null 2>&1
}

# --- vcpkg and CMake presets ---------------------------------------------------------

# add_qt_kit <installation root> <version> <kit folder> <qconfig.pri lines, printf escapes>
# A kit as far as reading one goes: mkspecs/qconfig.pri, bin/qtpaths -- qtpaths.exe for a
# mingw, msvc or llvm-mingw folder -- and lib/cmake/Qt6/qt.toolchain.cmake for Qt 6.
add_qt_kit() {
  local kit="$1/$2/$3"
  mkdir -p "$kit/mkspecs" "$kit/bin"
  printf "QT_VERSION = %s\nQT_MAJOR_VERSION = %s\n$4" "$2" "${2%%.*}" > "$kit/mkspecs/qconfig.pri"
  case "$3" in
    mingw* | msvc* | llvm-mingw*) : > "$kit/bin/qtpaths.exe" ;;
    *) : > "$kit/bin/qtpaths" ;;
  esac
  if [ "${2%%.*}" -ge 6 ]; then
    mkdir -p "$kit/lib/cmake/Qt6" && : > "$kit/lib/cmake/Qt6/qt.toolchain.cmake"
  fi
}

# add_mingw <installation root> <folder, e.g. mingw1310_64>: a MinGW in Tools, with gdb, as Qt's installer puts one.
add_mingw() {
  mkdir -p "$1/Tools/$2/bin" && (cd "$1/Tools/$2/bin" && : > gcc.exe && : > g++.exe && : > mingw32-make.exe && : > gdb.exe)
}

# add_vcpkg <folder>: a vcpkg clone, as far as finding one goes.
add_vcpkg() {
  mkdir -p "$1/scripts/buildsystems" && : > "$1/.vcpkg-root" && : > "$1/scripts/buildsystems/vcpkg.cmake"
}

# add_vcpkg_tool <vcpkg folder>: its executable, vcpkg.exe on Windows, played by fake-vcpkg.js in a
# copy of the JavaScript runtime -- a hard link where it can be. Sets VCPKG_ENV, the PROCESS_ENV of
# set_up_vcpkg that loads fake-vcpkg.js into it. Fails with VS Code's runtime, which only runs in its
# own folder.
add_vcpkg_tool() {
  "${RUNTIME[@]}" -e 'process.exit(process.versions.electron ? 1 : 0)' || return 1
  local exe="$1/vcpkg" runtime
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) exe="$1/vcpkg.exe" ;; esac
  runtime="$(command -v "${RUNTIME[0]}")" || return 1
  rm -f "$exe" && { ln "$runtime" "$exe" 2>/dev/null || cp "$runtime" "$exe"; } || return 1
  VCPKG_ENV='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio","NODE_OPTIONS":"--require=\"'"$(native_path "$TEST_DIR/fake-vcpkg.js")"'\""}'
}

# add_port <vcpkg folder> <name> <version> <description> [<dependencies as JSON>]: a port of the fake
# vcpkg. Its usage file, targets file or fail marker are written by the test; see fake-vcpkg.js.
add_port() {
  mkdir -p "$1/ports/$2"
  printf '{\n  "name": "%s",\n  "version": "%s",\n  "description": "%s",\n  "dependencies": %s\n}\n' "$2" "$3" "$4" "${5:-[]}" > "$1/ports/$2/vcpkg.json"
}

# add_package <project root> <JSON list of picks> [<more JSON fields>]: runs Add vcpkg Package... from
# the palette, with the environment of set_up_vcpkg and the fake vcpkg's VCPKG_ENV.
add_package() {
  local settings='{"qt-core.qtInstallationRoot":"${work}/Qt"}'
  [ -n "${SETTINGS:-}" ] && settings="$SETTINGS"
  SETTINGS="$settings" PROCESS_ENV="${PROCESS_ENV:-$VCPKG_ENV}" move "$1" "{\"command\":\"qtWorkbench.addVcpkgPackage\",\"picks\":$2${3:+,$3}}"
}

# remove_package <project root> <JSON list of picks> [<more JSON fields>]: runs Remove vcpkg Package...
# from the palette, as add_package runs Add vcpkg Package...; "answer":"Remove" confirms.
remove_package() {
  local settings='{"qt-core.qtInstallationRoot":"${work}/Qt"}'
  [ -n "${SETTINGS:-}" ] && settings="$SETTINGS"
  SETTINGS="$settings" PROCESS_ENV="${PROCESS_ENV:-$VCPKG_ENV}" move "$1" "{\"command\":\"qtWorkbench.removeVcpkgPackage\",\"picks\":$2${3:+,$3}}"
}

# prepare_qt_install: $QT, a Qt installation root with Qt 6.11.2 for this system -- MinGW with
# its Tools/mingw1310_64 on Windows, GCC on Linux, macOS -- and an Android kit, which cannot
# be used; $KIT is the usable kit's label, $KIT_ID the name of its presets, and $KIT_DIR its
# folder. Also $VCPKG, a vcpkg clone next to the projects.
prepare_qt_install() {
  QT="$WORK/Qt"
  VCPKG="$WORK/vcpkg"
  rm -rf "$QT" "$VCPKG"
  local gcc='QT_GCC_MAJOR_VERSION = 13\nQT_GCC_MINOR_VERSION = 1\nQT_GCC_PATCH_VERSION = 0\n'
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      add_qt_kit "$QT" 6.11.2 mingw_64 "QT_ARCH = x86_64\n$gcc"
      add_mingw "$QT" mingw1310_64
      KIT="Qt 6.11.2 MinGW 64-bit" KIT_ID=mingw KIT_DIR="$QT/6.11.2/mingw_64" ;;
    Darwin)
      add_qt_kit "$QT" 6.11.2 macos 'QT_ARCH = arm64 x86_64\nQT_APPLE_CLANG_MAJOR_VERSION = 15\n'
      KIT="Qt 6.11.2 macOS" KIT_ID=macos KIT_DIR="$QT/6.11.2/macos" ;;
    *)
      add_qt_kit "$QT" 6.11.2 gcc_64 "QT_ARCH = x86_64\n$gcc"
      KIT="Qt 6.11.2 GCC 64-bit" KIT_ID=gcc KIT_DIR="$QT/6.11.2/gcc_64" ;;
  esac
  add_qt_kit "$QT" 6.11.2 android_arm64_v8a 'QT_ARCH = arm64\nQT.global.enabled_features = shared cross_compile\nQT_CLANG_MAJOR_VERSION = 17\n'
  add_vcpkg "$VCPKG"
}

# set_up_vcpkg <project root> <folder or file it runs on, or - for the palette> <JSON list of picks> [<more JSON fields>]
# Runs Set Up vcpkg with CMake Presets, with the Qt extension's installation root at $WORK/Qt,
# no VCPKG_ROOT and no Visual Studio -- unless SETTINGS or PROCESS_ENV say otherwise.
set_up_vcpkg() {
  local at=",\"at\":\"$2\""
  local settings='{"qt-core.qtInstallationRoot":"${work}/Qt"}'
  local env='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio"}'
  [ "$2" = "-" ] && at=""
  [ -n "${SETTINGS:-}" ] && settings="$SETTINGS"
  [ -n "${PROCESS_ENV:-}" ] && env="$PROCESS_ENV"
  SETTINGS="$settings" PROCESS_ENV="$env" move "$1" "{\"command\":\"qtWorkbench.setUpVcpkg\",\"picks\":$3$at${4:+,$4}}"
}

# set_up_hot_reload <project root> <folder or file it runs on, or - for the palette> <JSON list of picks> [<more JSON fields>]
# Runs Set Up QML Hot Reload Debugging, with the environment of set_up_vcpkg. On Windows, where
# the kit decides the debugger, the kit is picked first: $KIT, unless KIT_PICK says another
# label, or KIT_PICK=none when the command asks for no kit.
set_up_hot_reload() {
  local picks="$3"
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      if [ "${KIT_PICK:-}" != none ]; then
        picks="[\"${KIT_PICK:-$KIT}\",${3#[}"
        [ "$3" = "[]" ] && picks="[\"${KIT_PICK:-$KIT}\"]"
      fi ;;
  esac
  local at=",\"at\":\"$2\""
  local settings='{"qt-core.qtInstallationRoot":"${work}/Qt"}'
  local env='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio"}'
  [ "$2" = "-" ] && at=""
  [ -n "${SETTINGS:-}" ] && settings="$SETTINGS"
  [ -n "${PROCESS_ENV:-}" ] && env="$PROCESS_ENV"
  SETTINGS="$settings" PROCESS_ENV="$env" move "$1" "{\"command\":\"qtWorkbench.setUpHotReload\",\"picks\":$picks$at${4:+,$4}}"
}

# new_project <workspace folder> <JSON list of picks> <folder to create it in, or - to cancel there> <name> [<more JSON fields>]
# Runs New Qt Project from the palette: picks the template (and the kit and vcpkg), browses to the
# folder and types the name, with the environment of set_up_vcpkg.
new_project() {
  local browse="[\"$3\"]"
  local settings='{"qt-core.qtInstallationRoot":"${work}/Qt"}'
  local env='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio"}'
  [ "$3" = "-" ] && browse="[]"
  [ -n "${SETTINGS:-}" ] && settings="$SETTINGS"
  [ -n "${PROCESS_ENV:-}" ] && env="$PROCESS_ENV"
  SETTINGS="$settings" PROCESS_ENV="$env" move "$1" "{\"command\":\"qtWorkbench.newProject\",\"picks\":$2,\"browse\":$browse,\"name\":\"$4\"${5:+,$5}}"
}

# pick_items <n>: the items of the n-th quick pick of the last run, one per line, without their description and detail.
pick_items() {
  awk -v n="$1" '/^PICK:/ { i++; next } /^[^ ]/ { if (i == n) exit } i == n { sub(/^  /, ""); sub(/ \| .*/, ""); print }' "$LAST"
}

# pick_item <n> <label>: the n-th quick pick's item of that label, with its description and detail.
pick_item() {
  awk -v n="$1" -v l="$2" '/^PICK:/ { i++; next } i == n && (index($0, "  " l " | ") == 1 || $0 == "  " l) { sub(/^  /, ""); print; exit }' "$LAST"
}

# json_says <file> <JavaScript expression>: its JSON value, with `d` the file's JSON.
json_says() {
  "${RUNTIME[@]}" -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(JSON.stringify(eval(process.argv[2])))' \
    "$(native_path "$1")" "$2" 2>&1
}

# --- QML hot reload ----------------------------------------------------------------

# A path as the JavaScript runtime spells it: C:/... under Git Bash, unchanged elsewhere.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}

# prepare_hot_reload: the demo app with a build tree as qt_add_qml_module leaves one: the
# executable, the .qrc files rcc compiles -- the QML files by absolute path into the
# sources, the module's qmldir from the build tree -- and, for tooling only, the dir map
# pointing at the build tree's copies of the QML files. Sets HOT_PROGRAM and HOT_BUILD.
prepare_hot_reload() {
  prepare_app views
  HOT_BUILD="$APP/builds/Qt-6.11.2-mingw_64-x86_64/Debug"
  local b="$HOT_BUILD" src nb
  src="$(native_path "$APP")"
  nb="$(native_path "$b")"
  HOT_PROGRAM="$nb/appTest.exe"
  mkdir -p "$b/Test/components" "$b/CMakeFiles/appTest.dir"
  : > "$b/appTest.exe"
  printf 'module Test\ntypeinfo appTest.qmltypes\nprefer :/qt/qml/Test/\nMain 254.0 Main.qml\n' > "$b/Test/qmldir"
  cp "$APP/Main.qml" "$b/Test/Main.qml"
  cp "$APP"/components/*.qml "$b/Test/components/"
  {
    printf '<RCC>\n  <qresource prefix="/qt/qml/Test/">\n'
    (cd "$APP" && find Main.qml views components -name '*.qml' | sort) | while IFS= read -r f; do
      printf '    <file alias="%s">%s/%s</file>\n' "$f" "$src" "$f"
    done
    printf '  </qresource>\n</RCC>\n'
  } > "$b/.qt/rcc/appTest_raw_qml_0.qrc"
  printf '<RCC>\n  <qresource prefix="/qt/qml/Test">\n    <file alias="qmldir">%s/Test/qmldir</file>\n  </qresource>\n</RCC>\n' "$nb" > "$b/.qt/rcc/qmake_Test.qrc"
  printf '<RCC>\n  <qresource prefix="/">\n    <file alias="/qt/qml/Test">%s/Test</file>\n  </qresource>\n</RCC>\n' "$nb" > "$b/Test/appTest_qml_module_dir_map.qrc"
  printf '<RCC><qresource prefix="/stale"><file>../../../../../Main.qml</file></qresource></RCC>\n' > "$b/CMakeFiles/appTest.dir/stale.qrc"
  commit_changes "$APP" "build tree"
}

# debug_config <extra -qmljsdebugger options>: a cppdbg launch of HOT_PROGRAM whose
# -qmljsdebugger listens on the fake application's port.
debug_config() {
  printf '{"type":"cppdbg","request":"launch","program":"%s","args":["-qmljsdebugger=host:127.0.0.1,port:${port},%s"]}' "$HOT_PROGRAM" "$1"
}

# debug_session <project root> <JSON debug configuration> <JSON list of steps>
# Runs a debug session against a fake Qt application; the steps are described in harness.js.
debug_session() {
  move "$1" "{\"debug\":$2,\"steps\":$3}"
}

# step <text>: what the steps whose JSON contains <text> printed, one ';' after each line.
step() {
  awk -v t="$1" 'index($0, "> ") == 1 { on = index($0, t) > 0; next } /^=====/ { on = 0 } on { sub(/^  /, ""); printf "%s;", $0 }' "$LAST"
}
