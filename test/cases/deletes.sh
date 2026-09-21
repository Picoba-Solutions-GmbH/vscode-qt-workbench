# Deleting files: their entries go from CMakeLists.txt, .pro, .qrc and qmldir files, and code
# that still refers to them is reported.

echo "== deleting a QML view takes it out of QML_FILES =="
prepare_app views
delete "$APP" views/BasicsView.qml
check "gone from CMakeLists.txt" "$(grep -c 'BasicsView' "$APP/CMakeLists.txt")" "0"
check "its neighbours stay" "$(awk '/views\/SettingsView.qml/ { getline; print; exit }' "$APP/CMakeLists.txt")" "        components/Card.qml"
check "saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt"
check "only CMakeLists.txt changed besides the file" "$(changed "$APP" CMakeLists.txt Main.qml views)" "2"
check "Main.qml still uses it: warned" "$(grep -c '^  ! Main.qml still refers to deleted files: BasicsView (line [0-9]*)$' "$LAST")" "1"
check "build tree untouched" "$(changed "$APP" builds)" "0"

echo "== deleting a header: SOURCES entry gone, includes and its QML singleton reported =="
prepare_app views
delete "$APP" taskstore.h
check "gone from SOURCES" "$(grep -c '^        taskstore.h$' "$APP/CMakeLists.txt")" "0"
check "its .cpp stays listed" "$(grep -c '^        singletons/taskstore.cpp$' "$APP/CMakeLists.txt")" "1"
check "include reported" "$(grep -c '^  ! singletons/taskstore.cpp still refers to deleted files: ../taskstore.h (line 1)$' "$LAST")" "1"
check "QML use of the class reported" "$(grep -c '^  ! views/StatsView.qml still refers to deleted files: TaskStore (lines ' "$LAST")" "1"
check "summary counts the warnings" "$(grep -c '^\[info\] Qt Workbench: updated CMakeLists.txt ([0-9]* warning(s))$' "$LAST")" "1"

echo "== deleting a folder takes out every file in it =="
prepare_app views
delete "$APP" components
check "no components/ entries left" "$(grep -c 'components/' "$APP/CMakeLists.txt")" "0"
check "QML_FILES still closed properly" "$(awk '/views\/BasicsView.qml/ { getline; print; exit }' "$APP/CMakeLists.txt")" "    SOURCES"

echo "== a file with unsaved changes, and files.refactoring.autoSave off =="
prepare_app views
DIRTY=CMakeLists.txt delete "$APP" views/BasicsView.qml
check "edited but not saved" "$(grep '^SAVED:' "$LAST")" "SAVED: "
prepare_app views
AUTOSAVE=false delete "$APP" views/BasicsView.qml
check "nothing saved" "$(grep '^SAVED:' "$LAST")" "SAVED: "

echo "== updateCMake off leaves CMakeLists.txt alone =="
prepare_app views
SETTINGS='{"updateCMake":false}' delete "$APP" views/BasicsView.qml
check "untouched" "$(changed "$APP" CMakeLists.txt)" "0"

echo "== deleting inside a build tree updates nothing =="
prepare_app views
delete "$APP" builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/views/BasicsView.qml
check "CMakeLists.txt untouched" "$(changed "$APP" CMakeLists.txt)" "0"
check "log says so" "$(grep -c 'deleted inside a build or ignored directory; nothing to update' "$LAST")" "1"

echo "== the widgets template: PROJECT_SOURCES and the .pro =="
prepare_widgets
delete "$WID" mainwindow.h
check "gone from PROJECT_SOURCES" "$(sed -n '/^set(PROJECT_SOURCES/,/^)/p' "$WID/CMakeLists.txt")" $'set(PROJECT_SOURCES\n        main.cpp\n        mainwindow.cpp\n        mainwindow.ui\n)'
check "the emptied HEADERS block goes with its blank line" "$(sed -n '/^SOURCES/,/^FORMS/p' "$WID/notes.pro")" $'SOURCES += \\\n    main.cpp \\\n    mainwindow.cpp\n\nFORMS += \\'
check "includes reported" "$(grep -c '^  ! main.cpp still refers to deleted files: mainwindow.h (line 1)$' "$LAST")" "1"
check "saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,notes.pro"

prepare_widgets
delete "$WID" mainwindow.cpp
check "last SOURCES value gone, and the continuation before it" "$(sed -n '/^SOURCES/,/^$/p' "$WID/notes.pro")" $'SOURCES += \\\n    main.cpp'

prepare_widgets
delete "$WID" mainwindow.ui
check "FORMS gone" "$(grep -c FORMS "$WID/notes.pro")" "0"
check "the generated ui_ include reported" "$(grep -c '^  ! mainwindow.cpp still refers to deleted files: ./ui_mainwindow.h (line 2)$' "$LAST")" "1"

echo "== .qrc, qmldir, qmake DISTFILES and qrc:/ URLs =="
prepare_resources
delete "$RES" views/TasksView.qml
check ".qrc entry gone" "$(grep -c TasksView "$RES/res.qrc")" "0"
check ".qrc keeps the image" "$(grep -c '<file>images/logo.png</file>' "$RES/res.qrc")" "1"
check "DISTFILES keeps the image" "$(grep DISTFILES "$RES/demo.pro")" "DISTFILES += images/logo.png"
check "QML_FILES entry gone" "$(grep -c TasksView "$RES/CMakeLists.txt")" "0"
check "qrc:/ URL reported" "$(grep -c '^  ! src/main.cpp still refers to deleted files: qrc:/qt/qml/Demo/App/views/TasksView.qml (line [0-9]*)$' "$LAST")" "1"

prepare_resources
delete "$RES" widgets/Badge.qml
check "qmldir entry gone" "$(cat "$RES/widgets/qmldir")" "module Demo.Widgets"

echo "== deleting a folder with its own CMakeLists.txt removes its add_subdirectory =="
prepare_cpp
delete "$CPP" plugin
check "add_subdirectory gone" "$(grep -c add_subdirectory "$CPP/CMakeLists.txt")" "0"
check "the rest untouched" "$(tail -1 "$CPP/CMakeLists.txt")" ")"

echo "== one-line lists, a glued parenthesis, commands that only exist for their file =="
DEL="$WORK/del"
rm -rf "$DEL" && mkdir -p "$DEL/src"
cat > "$DEL/CMakeLists.txt" <<'EOF'
qt_add_executable(app main.cpp util.cpp) # the app
target_sources(app PRIVATE src/a.cpp)

set_source_files_properties(Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(app
    URI App
    QML_FILES
        Main.qml
        Theme.qml)
configure_file(version.h.in version.h)
EOF
touch "$DEL/main.cpp" "$DEL/util.cpp" "$DEL/src/a.cpp" "$DEL/Theme.qml" "$DEL/Main.qml" "$DEL/version.h.in"
commit_all "$DEL"
delete "$DEL" util.cpp src/a.cpp Theme.qml version.h.in
check "what is left" "$(cat "$DEL/CMakeLists.txt")" $'qt_add_executable(app main.cpp) # the app\n\nqt_add_qml_module(app\n    URI App\n    QML_FILES\n        Main.qml)\nconfigure_file(version.h.in version.h)'
check "configure_file left alone with a warning" "$(grep -c '^  ! CMakeLists.txt:11 still names version.h.in in configure_file(), and it was deleted. Fix that by hand.$' "$LAST")" "1"

echo "== qmake continuations, scoped assignments and include() =="
PRO="$WORK/pro"
rm -rf "$PRO" && mkdir -p "$PRO"
cat > "$PRO/app.pro" <<'EOF'
SOURCES += \
    main.cpp \
    a.cpp \
    b.cpp
HEADERS += x.h
win32: SOURCES += win.cpp other.cpp
include(extra.pri)
EOF
touch "$PRO/main.cpp" "$PRO/a.cpp" "$PRO/b.cpp" "$PRO/x.h" "$PRO/win.cpp" "$PRO/other.cpp" "$PRO/extra.pri"
commit_all "$PRO"
delete "$PRO" main.cpp b.cpp win.cpp extra.pri
check "what is left" "$(cat "$PRO/app.pro")" $'SOURCES += \\\n    a.cpp\nHEADERS += x.h\nwin32: SOURCES += other.cpp'
