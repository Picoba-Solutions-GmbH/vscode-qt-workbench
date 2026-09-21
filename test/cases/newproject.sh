# New Qt Project: a project written from a template in src/templates -- the Qt Quick application
# of qt-app, alone or with vcpkg, the core library, application and tests of qt-core-app, or the
# vcpkg libraries of qt-libs -- in the folder and under the name chosen, then opened.

PROJECTS="$WORK/projects"
fresh_projects() { rm -rf "$PROJECTS" && mkdir -p "$PROJECTS"; }

# template <folder in src/templates> <name>: prints a folder holding the template with that
# name filled in, as New Qt Project writes it.
template() {
  local out="$WORK/template-$1-$2"
  rm -rf "$out" && cp -r "${EXT_DIR:-$TEST_DIR/..}/src/templates/$1" "$out"
  grep -rl '%{ProjectName}' "$out" | while read -r f; do sed -i "s/%{ProjectName}/$2/g" "$f"; done
  echo "$out"
}

echo "== the default template is qt-app: named Test, it is the template with Test filled in =="
fresh_projects
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Test '"answer":"Open"'
check "templates offered, the default first" "$(pick_items 1)" \
  $'Qt Quick Application\nQt Quick Application with vcpkg\nQt Quick Application with Core Library\nQt Quick Application with vcpkg Libraries'
check "the Qt version its CMakeLists.txt requires" "$(pick_item 1 'Qt Quick Application' | cut -d'|' -f2)" " CMake, Qt 6.10 or later "
QT_APP="$(template qt-app Test)"
check "the qt-app template, byte for byte" "$(diff -r "$QT_APP" "$PROJECTS/Test" && echo same)" "same"
check "every file logged" "$(grep -c '^  \* ' "$LAST")" "$(cd "$QT_APP" && find . -type f | grep -c .)"
check "each header beside its source, none at the root" \
  "$(cd "$PROJECTS/Test" && ls *.h 2>/dev/null; for h in */*.h; do [ -f "${h%.h}.cpp" ] || echo "$h"; done)" "models/priority.h"
check "asked, then opened in this window" "$(grep '^\[info\] Open' "$LAST")$(grep '^OPENED FOLDER:' "$LAST")" '[info] Open Test?OPENED FOLDER: ${work}/projects/Test {"forceReuseWindow":true}'
check "no errors" "$(grep -c '^\[error\]\|^  !' "$LAST")" "0"

echo "== another name: the project, its target, its QML module and the imports of it follow =="
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Notes '"answer":"Open in New Window"'
NOTES="$PROJECTS/Notes"
check "no Test left" "$(grep -rlw 'Test\|appTest' "$NOTES" | grep -c .)" "0"
check "no placeholder left" "$(grep -rl '%{' "$NOTES" | grep -c .)" "0"
check "CMakeLists.txt" "$(grep -E '^(project|qt_add_executable|qt_add_qml_module)\(|^    URI ' "$NOTES/CMakeLists.txt")" \
  $'project(Notes VERSION 0.1 LANGUAGES CXX)\nqt_add_executable(appNotes\nqt_add_qml_module(appNotes\n    URI Notes'
check "main.cpp loads the module" "$(grep -c '^    engine.loadFromModule("Notes", "Main");$' "$NOTES/main.cpp")" "1"
check "the views that import it" "$(cd "$NOTES/views" && grep -l '^import Notes$' *.qml | tr '\n' ' ')" "BasicsView.qml StatsView.qml TasksView.qml "
check "opened in a new window" "$(grep '^OPENED FOLDER:' "$LAST")$(grep '^  opened' "$LAST")" 'OPENED FOLDER: ${work}/projects/Notes {"forceNewWindow":true}  opened in a new window'
explore "$NOTES" '[{"tree":true}]'
check "the Qt Project Explorer reads it" "$(printed 1 | head -4)" $'Notes\n  CMakeLists.txt\n  appNotes\n    Header Files'

echo "== with vcpkg: the qt-app files, and the CMakePresets.json and vcpkg.json Set Up vcpkg writes =="
prepare_qt_install
fresh_projects
PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' \
  new_project "$PROJECTS" "[\"Qt Quick Application with vcpkg\",\"$KIT\",\"\${work}/vcpkg\"]" '${work}/projects' Test '"answer":"Add to Workspace"'
check "asked for the kit, then vcpkg" "$(pick_items 2 | head -1)|$(pick_items 3 | head -1)" "$KIT|\${work}/vcpkg"
check "the qt-app template and two files more" "$(diff -r "$QT_APP" "$PROJECTS/Test" | sed "s#$PROJECTS/##")" \
  $'Only in Test: CMakePresets.json\nOnly in Test: vcpkg.json'
check "logged" "$(grep -c "^  Qt kit: $KIT in " "$LAST")$(grep -c '^  vcpkg: .*/vcpkg (VCPKG_ROOT), CMAKE_TOOLCHAIN_FILE \$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake$' "$LAST")$(grep -c "^  \* CMakePresets.json: configure presets qt-$KIT_ID, qt-$KIT_ID-debug and qt-$KIT_ID-release and build presets qt-$KIT_ID-debug and qt-$KIT_ID-release$" "$LAST")$(grep -c '^  \* vcpkg.json: no dependencies yet$' "$LAST")" "1111"
check "added to the workspace" "$(grep '^ADDED TO WORKSPACE:' "$LAST")" 'ADDED TO WORKSPACE: ${work}/projects/Test'
prepare_app views
PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "CMakePresets.json as Set Up vcpkg writes it" "$(cmp "$APP/CMakePresets.json" "$PROJECTS/Test/CMakePresets.json" && echo same)" "same"
check "vcpkg.json as Set Up vcpkg writes it" "$(cmp "$APP/vcpkg.json" "$PROJECTS/Test/vcpkg.json" && echo same)" "same"

echo "== vcpkg libraries: the qt-libs files, its own vcpkg.json and overlay port kept, and the presets =="
LIBS="$WORK/libs"
rm -rf "$LIBS" && mkdir -p "$LIBS"
PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' \
  new_project "$LIBS" "[\"Qt Quick Application with vcpkg Libraries\",\"$KIT\",\"\${work}/vcpkg\"]" '${work}/libs' Gauges
check "the qt-libs template and the presets" "$(diff -r "$(template qt-libs Gauges)" "$LIBS/Gauges" | sed "s#$LIBS/##")" \
  'Only in Gauges: CMakePresets.json'
check "its dependencies logged" "$(grep -c '^  \* vcpkg.json: dependencies nlohmann-json, restc-cpp, snap7 and vincentlaucsb-csv-parser$' "$LAST")" "1"
check "each dependency found and linked" \
  "$(grep -c '^find_package(\(nlohmann_json\|unofficial-vincentlaucsb-csv-parser\|restc-cpp\|snap7\) CONFIG REQUIRED)$' "$LIBS/Gauges/CMakeLists.txt")" "4"
check "the overlay port vcpkg is pointed at" "$(json_says "$LIBS/Gauges/vcpkg-configuration.json" 'd["overlay-ports"]')|$(ls "$LIBS/Gauges/vcpkg-ports")" '["./vcpkg-ports"]|snap7'
# snap7 builds only as a shared library: Linux and macOS get their dynamic triplet, Windows keeps its own.
triplet="$(json_says "$PROJECTS/Test/CMakePresets.json" 'd.configurePresets[0].cacheVariables.VCPKG_TARGET_TRIPLET' | sed -E 's/-(linux|osx)"$/-\1-dynamic"/')"
check "a triplet building shared libraries" "$(json_says "$LIBS/Gauges/CMakePresets.json" 'd.configurePresets[0].cacheVariables.VCPKG_TARGET_TRIPLET')" "$triplet"
explore "$LIBS/Gauges" '[{"tree":true}]'
check "one project in the Qt Project Explorer, the port's build script no project" "$(printed 1 | grep -c '^[^ ]')|$(printed 1 | grep -c 'snap7.cmake')" "1|0"

echo "== core library: the qt-core-app files, a library, an application and tests in three folders =="
# Created beside the fake Qt installation, which Set Up QML Hot Reload Debugging looks for there.
LEDGER="$WORK/Ledger"
rm -rf "$LEDGER" "$WORK/core" && mkdir -p "$WORK/core"
new_project "$WORK/core" '["Qt Quick Application with Core Library"]' '${work}' Ledger
check "the qt-core-app template, byte for byte" "$(diff -r "$(template qt-core-app Ledger)" "$LEDGER" && echo same)" "same"
check "no kit or vcpkg asked, no presets" "$(grep -c '^PICK:' "$LAST")|$(ls "$LEDGER" | tr '\n' ' ')" "1|CMakeLists.txt README.md app core tests "
check "the targets it names" "$(cd "$LEDGER" && grep -h -E '^(project|qt_add_library|qt_add_executable)\(|^    URI ' CMakeLists.txt */CMakeLists.txt)" \
  $'project(Ledger VERSION 0.1 LANGUAGES CXX)\nqt_add_executable(appLedger\n    URI Ledger\nqt_add_library(LedgerCore STATIC\nqt_add_executable(tst_budget tst_budget.cpp)\nqt_add_executable(tst_ledger tst_ledger.cpp)\nqt_add_executable(tst_ledgerfile tst_ledgerfile.cpp)'
check "the core links Qt Core and includes nothing that draws" \
  "$(grep -o 'Qt6::[A-Za-z]*' "$LEDGER/core/CMakeLists.txt" | tr '\n' ' ')|$(grep -rlE --include='*.h' --include='*.cpp' '#include <Q(tQml|tQuick|tGui|Qml|Quick|Gui)' "$LEDGER/core" | grep -c .)" "Qt6::Core |0"
check "the app and the tests link it" "$(grep -rh -A2 '^target_link_libraries' "$LEDGER/app" "$LEDGER/tests" | grep -o 'LedgerCore' | wc -l | tr -d ' ')" "4"
explore "$LEDGER" '[{"tree":true}]'
check "one project in the Qt Project Explorer: a folder for each part, its targets in them" "$(printed 1 | grep -E '^ {0,4}[^ ]')" \
  $'Ledger\n  CMakeLists.txt\n  app\n    CMakeLists.txt\n    appLedger\n  core\n    CMakeLists.txt\n    LedgerCore\n  tests\n    CMakeLists.txt\n    tst_budget\n    tst_ledger\n    tst_ledgerfile'

echo "== core library: a core header moved, and the app, the tests and the core follow it =="
commit_all "$LEDGER"
move "$LEDGER" '[["core/storage/ledgerfile.h","core/domain/ledgerfile.h"]]'
check "each part's include" "$(cd "$LEDGER" && grep -h 'ledgerfile.h' app/main.cpp tests/tst_ledgerfile.cpp core/storage/ledgerfile.cpp)" \
  $'#include "domain/ledgerfile.h"\n#include "domain/ledgerfile.h"\n#include "../domain/ledgerfile.h"'
check "the core's CMakeLists.txt" "$(grep -c '^    domain/ledgerfile.h$' "$LEDGER/core/CMakeLists.txt")$(grep -c 'storage/ledgerfile.h' "$LEDGER/core/CMakeLists.txt")" "10"
check "four files changed" "$(grep -c '^  \* ' "$LAST")" "4"

echo "== core library: hot reload set up for the application in app/, the tests left alone =="
set_up_hot_reload "$LEDGER" - '[[".vscode/launch.json: Debug Qt Application with QML hot reload","app/CMakeLists.txt: QT_QML_DEBUG for appLedger in Debug builds","app/CMakeLists.txt: a console for appLedger in Debug builds"]]'
check "offered for appLedger" "$(pick_items "$(grep -c '^PICK:' "$LAST")")" \
  $'[x] .vscode/launch.json: Debug Qt Application with QML hot reload\n[x] app/CMakeLists.txt: QT_QML_DEBUG for appLedger in Debug builds\n[x] app/CMakeLists.txt: a console for appLedger in Debug builds'
check "the tests use no QML" "$(grep -c '^  tst_\(budget\|ledger\|ledgerfile\): uses no QML$' "$LAST")" "3"
check "app/CMakeLists.txt defines QT_QML_DEBUG" "$(grep -c '^target_compile_definitions(appLedger PRIVATE \$<\$<CONFIG:Debug>:QT_QML_DEBUG>)$' "$LEDGER/app/CMakeLists.txt")" "1"

echo "== with vcpkg, a Qt kit older than the template needs: refused before vcpkg is asked =="
case "$KIT_ID" in mingw) kit_dir=mingw_64 ;; gcc) kit_dir=gcc_64 ;; *) kit_dir=macos ;; esac
mkdir -p "$QT/6.8.3" && cp -r "$QT/6.11.2/$kit_dir" "$QT/6.8.3/" && sed -i 's/6\.11\.2/6.8.3/' "$QT/6.8.3/$kit_dir/mkspecs/qconfig.pri"
OLD_KIT="${KIT/6.11.2/6.8.3}"
new_project "$PROJECTS" "[\"Qt Quick Application with vcpkg\",\"$OLD_KIT\"]" '${work}/projects' Old
check "says why" "$(grep -c "^\[error\] Qt Workbench: Qt Quick Application with vcpkg needs Qt 6.10 or later, and $OLD_KIT is older.$" "$LAST")" "1"
check "not asked for vcpkg, nothing written" "$(grep -c '^PICK:' "$LAST")$(grep '^CREATED:' "$LAST")$(ls "$PROJECTS" | tr '\n' ' ')" "2CREATED: Test "
rm -rf "$QT/6.8.3"

echo "== Escape at the Qt kit, or at the location: nothing written =="
new_project "$PROJECTS" '["Qt Quick Application with vcpkg"]' '${work}/projects' Later
check "at the kit" "$(grep '^CREATED:' "$LAST")$(ls "$PROJECTS" | tr '\n' ' ')" "CREATED: Test "
new_project "$PROJECTS" '["Qt Quick Application"]' - Later
check "at the location: no name asked" "$(grep -c '^PROMPT:' "$LAST")$(grep '^CREATED:' "$LAST")" "0CREATED: "

echo "== names that cannot name a project, or are taken =="
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' my-app
check "not an identifier" "$(grep '^INVALID:' "$LAST")" \
  "INVALID: my-app cannot name a project: it names its QML module and CMake target too, so start it with a letter and use only letters, digits and _."
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' 3d
check "a digit first" "$(grep -c '^INVALID: 3d cannot name a project' "$LAST")" "1"
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Test
check "a folder that holds files" "$(grep '^INVALID:' "$LAST")" "INVALID: Test already exists there, and is not empty."
: > "$PROJECTS/Readme"
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Readme
check "a file" "$(grep '^INVALID:' "$LAST")" "INVALID: Readme is a file in that folder."
check "nothing written" "$(grep '^CREATED:' "$LAST")$(ls "$PROJECTS" | tr '\n' ' ')" "CREATED: Readme Test "

echo "== a folder of that name holding only hidden entries, such as .git: the project goes in it =="
mkdir -p "$PROJECTS/Fresh" && git init -q "$PROJECTS/Fresh"
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Fresh
check "created, .git kept" "$([ -f "$PROJECTS/Fresh/CMakeLists.txt" ] && [ -d "$PROJECTS/Fresh/.git" ] && echo yes)" "yes"

echo "== declined to open: created, not opened =="
new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Kept
check "asked" "$(grep -c '^\[info\] Open Kept?$' "$LAST")" "1"
check "not opened, logged" "$(grep -c '^OPENED FOLDER:\|^ADDED TO WORKSPACE:' "$LAST")$(grep -c '^  not opened$' "$LAST")" "01"
check "written" "$([ -f "$PROJECTS/Kept/CMakeLists.txt" ] && echo yes)" "yes"

echo "== no folder open: opened in this window without asking =="
NO_FOLDER=1 new_project "$PROJECTS" '["Qt Quick Application"]' '${work}/projects' Solo
check "not asked" "$(grep -c '^\[info\]' "$LAST")" "0"
check "opened in this window" "$(grep '^OPENED FOLDER:' "$LAST")" 'OPENED FOLDER: ${work}/projects/Solo {"forceReuseWindow":true}'

echo "== the open workspace folder itself, still empty: the project goes in it, nothing to open =="
HERE="$WORK/Here"
rm -rf "$HERE" && mkdir -p "$HERE/.vscode"
new_project "$HERE" '["Qt Quick Application"]' '${work}' Here
check "created" "$([ -f "$HERE/CMakeLists.txt" ] && echo yes)" "yes"
check "not asked, not opened" "$(grep -c '^\[info\] Open\|^OPENED FOLDER:\|^ADDED TO WORKSPACE:' "$LAST")" "0"
check "says so" "$(grep -c '^\[info\] Qt Workbench: created Here from the Qt Quick Application template.$' "$LAST")" "1"

echo "== inside a build folder or a git-ignored folder of the open project: refused =="
prepare_app views
new_project "$APP" '["Qt Quick Application"]' '${work}/app/builds' Stray
check "a build folder" "$(grep -c '^\[error\] Qt Workbench: .*/app/builds/Stray is inside a build folder or ignored by git, so no project is created there.$' "$LAST")" "1"
printf 'scratch/\n' > "$APP/.gitignore" && mkdir -p "$APP/scratch" && commit_changes "$APP" ignore
new_project "$APP" '["Qt Quick Application"]' '${work}/app/scratch' Stray
check "an ignored folder" "$(grep -c '^\[error\] Qt Workbench: .*/app/scratch/Stray is inside a build folder or ignored by git' "$LAST")" "1"
check "nothing written" "$(ls "$APP/builds" "$APP/scratch" | grep -c Stray)$(changed "$APP")" "00"
new_project "$APP" '["Qt Quick Application"]' '${work}/app' Sub '"answer":"Add to Workspace"'
check "a folder of the project that is neither: created" "$(diff -r "$(template qt-app Sub)" "$APP/Sub" | grep -c '^Only in')$(grep -c '^\[error\]' "$LAST")" "00"
