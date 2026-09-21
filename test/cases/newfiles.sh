# New files: New QML File, New C++ Source File and New C++ Header File create the file from
# a template and add it to the CMakeLists.txt, .pro, .qrc and qmldir that list its neighbours.

# The line that follows the first line of <file> reading exactly <line>.
after() { awk -v l="$2" 'found { print; exit } $0 == l { found = 1 }' "$1"; }

echo "== a new QML view goes into QML_FILES after the other views =="
prepare_app views
new_file "$APP" qml views ProfileView
check "created" "$(grep '^CREATED:' "$LAST")" "CREATED: views/ProfileView.qml"
check "listed after views/BasicsView.qml" "$(after "$APP/CMakeLists.txt" '        views/BasicsView.qml')" "        views/ProfileView.qml"
check "listed once" "$(grep -c 'ProfileView' "$APP/CMakeLists.txt")" "1"
check "template" "$(cat "$APP/views/ProfileView.qml")" $'import QtQuick\n\nItem {\n\n}'
check "both saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,views/ProfileView.qml"
check "opened inside Item" "$(grep '^OPENED:' "$LAST")" "OPENED: views/ProfileView.qml:3:0"
check "log names the list" "$(grep -c '^  \* CMakeLists.txt: added to QML_FILES of qt_add_qml_module(appTest)$' "$LAST")" "1"
check "no warnings" "$(grep -c '^  !' "$LAST")" "0"
check "nothing else changed" "$(changed "$APP")" "2"

echo "== a source file started from its header: name suggested, header included, listed next to it =="
prepare_app views
new_file "$APP" source taskstore.h taskstore
check "suggests the header's name" "$(grep '^PROMPT:' "$LAST")" "PROMPT: taskstore"
check "includes its header" "$(cat "$APP/taskstore.cpp")" '#include "taskstore.h"'
check "listed right after taskstore.h" "$(after "$APP/CMakeLists.txt" '        taskstore.h')" "        taskstore.cpp"

echo "== a header goes at the end of SOURCES when its folder's files are not listed together =="
prepare_app views
new_file "$APP" header . profile
check "include guard" "$(cat "$APP/profile.h")" $'#ifndef PROFILE_H\n#define PROFILE_H\n\n\n\n#endif // PROFILE_H'
check "after the last source" "$(after "$APP/CMakeLists.txt" '        services/reportservice.cpp')" "        profile.h"
check "not in qt_add_executable" "$(after "$APP/CMakeLists.txt" '    main.cpp')" ")"
check "no name suggested for a folder" "$(grep '^PROMPT:' "$LAST")" "PROMPT: "

echo "== headerGuard pragmaOnce =="
prepare_app views
SETTINGS='{"headerGuard":"pragmaOnce"}' new_file "$APP" header . profile
check "#pragma once" "$(cat "$APP/profile.h")" '#pragma once'

echo "== a name with a folder creates the folder; from the palette it starts at the root =="
prepare_app views
new_file "$APP" qml - dialogs/ConfirmDialog.qml
check "created in the new folder" "$(grep '^CREATED:' "$LAST")" "CREATED: dialogs/ConfirmDialog.qml"
check "listed at the end of QML_FILES" "$(after "$APP/CMakeLists.txt" '        components/ThemedCombo.qml')" "        dialogs/ConfirmDialog.qml"

echo "== names that cannot be created are refused =="
prepare_app views
new_file "$APP" qml views BasicsView
check "an existing file" "$(grep '^INVALID:' "$LAST")" "INVALID: BasicsView.qml already exists here."
new_file "$APP" header . widget.cpp
check "a source file as header" "$(grep -c '^INVALID: widget.cpp is not a C++ header' "$LAST")" "1"
new_file "$APP" source views ../escape
check "a path out of the folder" "$(grep -c '^INVALID:' "$LAST")" "1"
check "nothing created" "$(changed "$APP")" "0"

echo "== a lower-case QML name is only a warning =="
prepare_app views
new_file "$APP" qml views helpers
check "warned" "$(grep -c '^WARNING: helpers is not a QML type name' "$LAST")" "1"
check "created and listed" "$(after "$APP/CMakeLists.txt" '        views/BasicsView.qml')" "        views/helpers.qml"

echo "== a Qt 5 project keeps the QtQuick version of the files next to it =="
prepare_app views
sed -i 's/^import QtQuick$/import QtQuick 2.15/' "$APP"/views/*.qml
commit_changes "$APP" qt5
new_file "$APP" qml views ProfileView
check "import QtQuick 2.15" "$(head -1 "$APP/views/ProfileView.qml")" "import QtQuick 2.15"

echo "== CMakeLists.txt with unsaved changes is edited but not saved =="
prepare_app views
DIRTY=CMakeLists.txt new_file "$APP" qml views ProfileView
check "only the new file saved" "$(grep '^SAVED:' "$LAST")" "SAVED: views/ProfileView.qml"

echo "== updateCMake off: created, added nowhere =="
prepare_app views
SETTINGS='{"updateCMake":false}' new_file "$APP" qml views ProfileView
check "created" "$(grep '^CREATED:' "$LAST")" "CREATED: views/ProfileView.qml"
check "CMakeLists.txt untouched" "$(changed "$APP" CMakeLists.txt)" "0"

echo "== a file created inside a build tree is not added =="
prepare_app views
new_file "$APP" qml builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/views Stray
check "created" "$(grep -c '^CREATED: builds/.*/Stray.qml$' "$LAST")" "1"
check "CMakeLists.txt untouched" "$(changed "$APP" CMakeLists.txt)" "0"
check "log says why" "$(grep -c '^  ! .*Stray.qml is inside a build or ignored directory' "$LAST")" "1"

echo "== the Qt Creator widgets template: set(PROJECT_SOURCES) and the .pro =="
prepare_widgets
new_file "$WID" header . notedialog
check "PROJECT_SOURCES, after mainwindow.h" "$(after "$WID/CMakeLists.txt" '        mainwindow.h')" "        notedialog.h"
check "not added to the targets" "$(grep -c notedialog "$WID/CMakeLists.txt")" "1"
check ".pro HEADERS continued" "$(sed -n '/^HEADERS/,/^$/p' "$WID/notes.pro")" $'HEADERS += \\\n    mainwindow.h \\\n    notedialog.h'
check "both saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,notedialog.h,notes.pro"
commit_changes "$WID" header
new_file "$WID" source notedialog.h notedialog
check "source after its header" "$(after "$WID/CMakeLists.txt" '        notedialog.h')" "        notedialog.cpp"
check ".pro SOURCES continued" "$(sed -n '/^SOURCES/,/^$/p' "$WID/notes.pro")" $'SOURCES += \\\n    main.cpp \\\n    mainwindow.cpp \\\n    notedialog.cpp'

echo "== a .pro without HEADERS gets a HEADERS block after SOURCES =="
prepare_widgets
sed -i '/^HEADERS/,/^$/d' "$WID/notes.pro"
commit_changes "$WID" noheaders
new_file "$WID" header . notedialog
check "new block" "$(sed -n '/^SOURCES/,/^FORMS/p' "$WID/notes.pro")" $'SOURCES += \\\n    main.cpp \\\n    mainwindow.cpp\n\nHEADERS += \\\n    notedialog.h\n\nFORMS += \\'

echo "== a QML file next to a qmldir and a .qrc =="
prepare_resources
new_file "$RES" qml widgets Chip
check "QML_FILES after widgets/Badge.qml" "$(after "$RES/CMakeLists.txt" '        widgets/Badge.qml')" "        widgets/Chip.qml"
check "qmldir entry with its neighbour's version" "$(tail -1 "$RES/widgets/qmldir")" "Chip 1.0 Chip.qml"
check ".qrc entry" "$(after "$RES/res.qrc" '        <file alias="tasks.qml">views/TasksView.qml</file>')" "        <file>widgets/Chip.qml</file>"
check ".pro left alone" "$(changed "$RES" demo.pro)" "0"

echo "== a subdirectory CMakeLists.txt: its own module, with a QML_FILES section added =="
prepare_cpp
new_file "$CPP" qml plugin Knob
check "section added before the closing parenthesis" "$(sed -n '/^qt_add_qml_module/,/^)/p' "$CPP/plugin/CMakeLists.txt")" $'qt_add_qml_module(otherplugin\n    URI Other\n    SOURCES\n        gauge.h\n    QML_FILES\n        Knob.qml\n)'
check "top-level CMakeLists.txt untouched" "$(changed "$CPP" CMakeLists.txt)" "0"
commit_changes "$CPP" knob
new_file "$CPP" source plugin knob
check "SOURCES of the plugin" "$(after "$CPP/plugin/CMakeLists.txt" '        gauge.h')" "        knob.cpp"
check "top-level CMakeLists.txt still untouched" "$(changed "$CPP" CMakeLists.txt)" "0"

echo "== single-line target lists, target_sources and \${CMAKE_CURRENT_SOURCE_DIR} =="
LINE="$WORK/line"
rm -rf "$LINE" && mkdir -p "$LINE/src"
printf 'qt_add_executable(app main.cpp) # the app\ntarget_sources(app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/a.cpp)\n' > "$LINE/CMakeLists.txt"
printf 'int main() {}\n' > "$LINE/main.cpp"
printf '\n' > "$LINE/src/a.cpp"
commit_all "$LINE"
new_file "$LINE" source src b
check "target_sources, spelled like its neighbour" "$(sed -n 2p "$LINE/CMakeLists.txt")" 'target_sources(app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/a.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/b.cpp)'
commit_changes "$LINE" b
new_file "$LINE" source . util
check "qt_add_executable on one line" "$(sed -n 1p "$LINE/CMakeLists.txt")" 'qt_add_executable(app main.cpp util.cpp) # the app'

echo "== a file(GLOB) that already matches leaves CMakeLists.txt alone =="
GLOB="$WORK/glob"
rm -rf "$GLOB" && mkdir -p "$GLOB/src"
printf 'file(GLOB_RECURSE SOURCES CONFIGURE_DEPENDS src/*.cpp src/*.h)\nqt_add_executable(g ${SOURCES})\n' > "$GLOB/CMakeLists.txt"
printf 'int main() {}\n' > "$GLOB/src/main.cpp"
commit_all "$GLOB"
new_file "$GLOB" header src util/helper
check "created in a new subfolder" "$(grep '^CREATED:' "$LAST")" "CREATED: src/util/helper.h"
check "CMakeLists.txt untouched" "$(changed "$GLOB" CMakeLists.txt)" "0"
check "log says the glob picks it up" "$(grep -c '^  CMakeLists.txt: file(GLOB_RECURSE SOURCES) already picks it up$' "$LAST")" "1"
check "no warning" "$(grep -c '^  !' "$LAST")" "0"

echo "== a .qrc with images after the QML files: the new QML file stays under the QML prefix =="
QRC="$WORK/qrc"
rm -rf "$QRC" && mkdir -p "$QRC/qml/pages" "$QRC/images"
printf '<RCC>\n    <qresource prefix="/qml">\n        <file>qml/main.qml</file>\n        <file>qml/pages/Home.qml</file>\n    </qresource>\n    <qresource prefix="/images">\n        <file>images/logo.png</file>\n    </qresource>\n</RCC>\n' > "$QRC/qml.qrc"
printf 'import QtQuick 2.15\n' > "$QRC/qml/main.qml"
cp "$QRC/qml/main.qml" "$QRC/qml/pages/Home.qml"
touch "$QRC/images/logo.png"
commit_all "$QRC"
new_file "$QRC" qml qml dialogs/About
check "after the last QML file" "$(after "$QRC/qml.qrc" '        <file>qml/pages/Home.qml</file>')" "        <file>qml/dialogs/About.qml</file>"
new_file "$QRC" qml qml Settings
check "after the QML file of its own folder" "$(after "$QRC/qml.qrc" '        <file>qml/main.qml</file>')" "        <file>qml/Settings.qml</file>"
