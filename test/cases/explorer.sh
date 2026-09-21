# Qt Project Explorer: the project tree Qt Creator shows, read from CMakeLists.txt and .pro
# files, and what its context menu, keys and drag and drop do.

TREE='[{"tree":true}]'
branch_of() { git -C "$1" branch --show-current; }
BIN="Move to Trash"
[ "${OS:-}" = "Windows_NT" ] && BIN="Move to Recycle Bin"

echo "== a Qt Quick app: its target's files in source groups and folders, as Qt Creator shows them =="
prepare_app views
explore "$APP" "$TREE"
check "tree" "$(printed 1)" "Test  [$(branch_of "$APP")]
  CMakeLists.txt
  appTest
    Header Files
      apptheme.h
      basics.h
      priority.h
      reportservice.h
      taskfilterproxy.h
      taskstore.h
    Source Files
      components
        Card.qml
        ThemedButton.qml
        ThemedCheckBox.qml
        ThemedCombo.qml
        ThemedField.qml
        ThemedLabel.qml
      misc
        taskfilterproxy.cpp
      services
        reportservice.cpp
      singletons
        apptheme.cpp
        taskstore.cpp
      viewmodels
        basics.cpp
      views
        BasicsView.qml
        SettingsView.qml
        StatsView.qml
        TaskDetailView.qml
        TasksView.qml
      main.cpp
      Main.qml"
check "nothing written" "$(changed "$APP")" "0"

echo "== what VS Code gets for each kind of node =="
explore "$APP" '[{"item":"Test"},{"item":"Test > appTest"},{"item":"Test > appTest > Source Files"},{"item":"Test > appTest > Source Files > views"},{"item":"Test > appTest > Source Files > Main.qml"}]'
check "project" "$(printed 1)" 'collapsibleState: Expanded
contextValue: qtCMakeProject
icon: project
tooltip: ${root}/CMakeLists.txt'
check "a project's only target starts expanded" "$(printed 2)" 'collapsibleState: Expanded
contextValue: qtTarget
icon: tools
tooltip: executable appTest'
check "source group" "$(printed 3)" 'collapsibleState: Collapsed
contextValue: qtGroup
icon: folder'
check "folder: the file icon theme's, with decorations" "$(printed 4)" 'collapsibleState: Collapsed
contextValue: qtFolder
icon: folder
resourceUri: views
tooltip: ${root}/views'
check "file: opens on a click" "$(printed 5)" 'collapsibleState: None
contextValue: qtFile
icon: file
resourceUri: Main.qml
command: vscode.open Main.qml
tooltip: ${root}/Main.qml'

echo "== a listed file not on disk is marked; build trees and ignored files are left out =="
prepare_app views
sed -i 's#^        views/BasicsView.qml$#        views/BasicsView.qml\n        views/GoneView.qml\n        builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/views/TasksView.qml\n        generated/Extra.qml#' "$APP/CMakeLists.txt"
mkdir -p "$APP/generated"
printf 'import QtQuick\nItem {}\n' > "$APP/generated/Extra.qml"
printf 'project(Generated)\nqt_add_executable(gen main.cpp)\n' > "$APP/generated/CMakeLists.txt"
printf 'project(Copy)\nqt_add_executable(copy main.cpp)\n' > "$APP/builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/CMakeLists.txt"
printf 'generated/\n' > "$APP/.gitignore"
printf 'qt_add_executable(fromignored main.cpp)\n' > "$APP/generated/more.cmake"
printf 'add_subdirectory(generated)\ninclude(generated/more.cmake)\n' >> "$APP/CMakeLists.txt"
commit_changes "$APP" listed
explore "$APP" '[{"tree":true},{"item":"Test > appTest > Source Files > views > GoneView.qml"}]'
check "marked" "$(printed 1 | grep 'GoneView')" "        GoneView.qml  not found"
check "no warning icon for files that are there" "$(printed 1 | grep -c 'not found')" "1"
check "a build tree's copy and an ignored file: not shown" "$(printed 1 | grep -c 'TasksView.qml\|Extra.qml')" "1"
check "projects in a build tree or an ignored folder: not shown" "$(printed 1 | grep -c '^[^ ]')" "1"
check "an ignored subdirectory and include: not read" "$(printed 1 | grep -c 'generated\|fromignored\|CMake Modules')" "0"
check "missing file item: no command" "$(printed 2)" 'collapsibleState: None
contextValue: qtMissingFile
icon: warning problemsWarningIcon.foreground
tooltip: ${root}/views/GoneView.qml
Listed in the project, but not found on disk.'

echo "== the active editor's file is selected =="
prepare_app views
explore "$APP" '[{"editor":"views/StatsView.qml"},{"editor":"importedcontent/README.md"},{"editor":"taskstore.h"}]'
check "a file of the project" "$(printed 1)" "revealed: Test > appTest > Source Files > views > StatsView.qml"
check "a file no project lists" "$(printed 2)" ""
check "a header" "$(printed 3)" "revealed: Test > appTest > Header Files > taskstore.h"
SETTINGS='{"projectExplorerAutoReveal":false}' explore "$APP" '[{"editor":"views/StatsView.qml"}]'
check "projectExplorerAutoReveal off" "$(printed 1)" ""

echo "== Rename... renames the file, its references follow, and so does the tree =="
prepare_app views
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.rename","node":"Test > appTest > Source Files > views > BasicsView.qml","input":"HomeView.qml"},{"tree":true}]'
check "the name to edit" "$(printed 1 | head -1)" "PROMPT: BasicsView.qml"
check "renamed" "$(printed 1 | grep RENAMED)" "RENAMED: views/BasicsView.qml -> views/HomeView.qml"
check "CMakeLists.txt updated" "$(grep -c '^        views/HomeView.qml$' "$APP/CMakeLists.txt")" "1"
check "QML type renamed" "$(grep -c '^        HomeView {}$' "$APP/Main.qml")" "1"
check "saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,Main.qml"
check "tree follows" "$(printed 2 | sed -n '/^      views$/,/^      [^ ]/p' | head -3)" "      views
        HomeView.qml
        SettingsView.qml"
commit_changes "$APP" renamed
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.rename","node":"Test > appTest > Source Files > views > HomeView.qml","input":"StatsView.qml"},{"command":"qtWorkbench.projectExplorer.rename","node":"Test > appTest > Source Files > views > HomeView.qml","input":"../HomeView.qml"},{"command":"qtWorkbench.projectExplorer.rename","node":"Test > appTest > Source Files > views > HomeView.qml"}]'
check "an existing name is refused" "$(printed 1 | grep INVALID)" "INVALID: StatsView.qml already exists here."
check "a path is refused" "$(printed 2 | grep -c '^INVALID: A name cannot contain / or')" "1"
check "Escape renames nothing" "$(changed "$APP")" "0"
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.rename","nodes":["Test > appTest > Source Files > views"],"input":"pages"}]'
check "F2 on the selected folder" "$(printed 1 | grep -c '^RENAMED: views -> pages$')" "1"
check "folder's entries updated" "$(grep -c '^        pages/' "$APP/CMakeLists.txt")" "5"

echo "== Delete asks first, then deletes and takes the entries out of the build files =="
prepare_app views
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.delete","node":"Test > appTest > Source Files > views > BasicsView.qml"}]'
check "asked" "$(grep -c "^\[warning\] Are you sure you want to delete 'BasicsView.qml'?$" "$LAST")" "1"
check "not confirmed: nothing deleted" "$(changed "$APP")" "0"
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.delete","node":"Test > appTest > Source Files > misc","nodes":["Test > appTest > Source Files > views > BasicsView.qml","Test > appTest > Source Files > misc > taskfilterproxy.cpp","Test > appTest > Source Files > misc"],"answer":"'"$BIN"'"},{"tree":true}]'
check "the selection, a folder's file with it" "$(printed 1 | grep DELETED)" "DELETED: views/BasicsView.qml
DELETED: misc"
check "entries removed" "$(grep -c 'BasicsView.qml\|taskfilterproxy.cpp' "$APP/CMakeLists.txt")" "0"
check "what still uses it is reported" "$(grep -c '^  ! Main.qml still refers to deleted files: BasicsView' "$LAST")" "1"
check "tree follows" "$(printed 2 | grep -c 'BasicsView\|misc\|taskfilterproxy.cpp')" "0"

echo "== dragging files onto a folder moves them, with their references =="
prepare_app views
explore "$APP" '[{"drag":["Test > appTest > Source Files > views > BasicsView.qml"],"onto":"Test > appTest > Source Files > components"}]'
check "asked" "$(grep -c "^\[warning\] Are you sure you want to move 'BasicsView.qml' into 'components'?$" "$LAST")" "1"
check "not confirmed: nothing moved" "$(changed "$APP")" "0"
explore "$APP" '[{"drag":["Test > appTest > Source Files > views > BasicsView.qml","Test > appTest > Header Files > priority.h"],"onto":"Test > appTest > Source Files > components","answer":"Move"}]'
check "dragged as tree nodes and as URIs" "$(printed 1 | head -1)" "dragged: application/vnd.code.tree.qtworkbench.projectexplorer, text/uri-list"
check "moved" "$(printed 1 | grep RENAMED)" "RENAMED: views/BasicsView.qml -> components/BasicsView.qml
RENAMED: priority.h -> components/priority.h"
check "CMakeLists.txt updated" "$(grep -c '^        components/BasicsView.qml$\|^        components/priority.h$' "$APP/CMakeLists.txt")" "2"
check "include updated" "$(grep -c '^#include "../components/priority.h"$' "$APP/singletons/taskstore.cpp")" "1"
commit_changes "$APP" moved
explore "$APP" '[{"drag":["Test > appTest > Source Files > components > BasicsView.qml"],"onto":"Test > appTest > Source Files > components > Card.qml","answer":"Move"},{"drag":["Test > appTest > Source Files > views"],"onto":"Test > appTest > Source Files > views > StatsView.qml","answer":"Move"},{"drag":["Test > appTest > Source Files > components > BasicsView.qml"],"onto":"Test > appTest > Source Files > views > StatsView.qml","answer":"Move"}]'
check "onto its own folder, or a folder into itself: nothing" "$(printed 1; printed 2 | grep -v dragged)" "dragged: application/vnd.code.tree.qtworkbench.projectexplorer, text/uri-list"
check "onto a file: into the file's folder" "$(printed 3 | grep RENAMED)" "RENAMED: components/BasicsView.qml -> views/BasicsView.qml"

echo "== New QML/C++ File... on a node creates the file in the folder it stands for =="
prepare_app views
explore "$APP" '[{"command":"qtWorkbench.projectExplorer.newQmlFile","node":"Test > appTest > Source Files > views","input":"ProfileView"},{"command":"qtWorkbench.projectExplorer.newCppHeader","node":"Test > appTest > Header Files","input":"profile"},{"command":"qtWorkbench.projectExplorer.newCppSource","node":"Test > appTest > Header Files > taskstore.h","input":"taskstore"},{"tree":true}]'
check "QML file in views, listed" "$(test -f "$APP/views/ProfileView.qml" && grep -c '^        views/ProfileView.qml$' "$APP/CMakeLists.txt")" "1"
check "header in the target's folder, listed" "$(test -f "$APP/profile.h" && grep -c '^        profile.h$' "$APP/CMakeLists.txt")" "1"
check "source from a header: its name suggested" "$(printed 3 | head -1)" "PROMPT: taskstore"
check "listed after its header" "$(grep -A1 '^        taskstore.h$' "$APP/CMakeLists.txt" | tail -1)" "        taskstore.cpp"
check "the tree shows them" "$(printed 4 | grep -c 'ProfileView.qml\|profile.h\|taskstore.cpp')" "4"

echo "== the tree is read again when a build file changes =="
prepare_app views
explore "$APP" '[{"tree":true},{"write":"CMakeLists.txt","text":"project(Renamed)\nqt_add_executable(app main.cpp)\n"},{"tree":true}]'
check "read again" "$(printed 3)" "Renamed  [$(branch_of "$APP")]
  CMakeLists.txt
  app
    Source Files
      main.cpp"

echo "== the Qt Creator widgets template: set(PROJECT_SOURCES); its .pro is the same project =="
prepare_widgets
explore "$WID" "$TREE"
check "tree" "$(printed 1)" "Notes  [$(branch_of "$WID")]
  CMakeLists.txt
  Notes
    Header Files
      mainwindow.h
    Source Files
      main.cpp
      mainwindow.cpp
    mainwindow.ui"

echo "== a qmake project: Headers, Sources, Forms =="
prepare_widgets
rm "$WID/CMakeLists.txt"
commit_changes "$WID" qmake
explore "$WID" "$TREE"
check "tree" "$(printed 1)" "notes  [$(branch_of "$WID")]
  notes.pro
  Headers
    mainwindow.h
  Sources
    main.cpp
    mainwindow.cpp
  Forms
    mainwindow.ui"

echo "== a .qrc shows its prefixes and files =="
prepare_resources
rm "$RES/CMakeLists.txt"
commit_changes "$RES" qmake
explore "$RES" '[{"tree":true},{"item":"demo > Resources > res.qrc"},{"editor":"views/TasksView.qml"}]'
check "tree" "$(printed 1)" "demo  [$(branch_of "$RES")]
  demo.pro
  Sources
    src
      main.cpp
  Resources
    res.qrc
      /
        images
          logo.png
        views
          TasksView.qml  tasks.qml
  QML
    views
      TasksView.qml
  Other files
    images
      logo.png"
check "a .qrc opens and expands" "$(printed 2)" 'collapsibleState: Collapsed
contextValue: qtFile
icon: file
resourceUri: res.qrc
command: vscode.open res.qrc
tooltip: ${root}/res.qrc'
check "revealed where the project lists it, not in the .qrc" "$(printed 3)" "revealed: demo > QML > views > TasksView.qml"

echo "== add_subdirectory: a directory node with its own targets =="
prepare_cpp
explore "$CPP" '[{"tree":true},{"item":"cpp > plugin"},{"item":"cpp > demo"}]'
check "tree" "$(printed 1)" "cpp  [$(branch_of "$CPP")]
  CMakeLists.txt
  demo
    Header Files
      src
        dial.h
        modes.h
    Source Files
      app
        Main.qml
      src
        gauge.cpp
        main.cpp
      views
        Clash.qml
        Page.qml
  plugin
    CMakeLists.txt
    otherplugin
      Header Files
        gauge.h"
check "directory" "$(printed 2)" 'collapsibleState: Collapsed
contextValue: qtProject
icon: folder
resourceUri: plugin
tooltip: ${root}/plugin/CMakeLists.txt'
check "one of several targets starts collapsed" "$(printed 3 | head -1)" "collapsibleState: Collapsed"

echo "== CMake evaluated for file lists: variables, file(GLOB), include(), source_group(), modules, presets =="
GLOB="$WORK/globbed"
rm -rf "$GLOB" "$GLOB-shared" && mkdir -p "$GLOB/src/detail" "$GLOB/src/build" "$GLOB/src/secret" "$GLOB/extra" "$GLOB/assets/icons" "$GLOB/cmake" "$GLOB-shared/lib"
cat > "$GLOB/CMakeLists.txt" <<'EOF'
cmake_minimum_required(VERSION 3.16)
project(Globbed LANGUAGES CXX)
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(Sources)
file(GLOB_RECURSE APP_SOURCES CONFIGURE_DEPENDS src/*.cpp src/*.h)
function(never_called)
    add_executable(never never.cpp)
endfunction()
qt_add_executable(globbed ${APP_SOURCES} ${EXTRA_SOURCES} ${UNKNOWN_SOURCES} $<$<CONFIG:Debug>:debug.cpp>)
target_sources(globbed PRIVATE ../globbed-shared/lib/util.cpp INTERFACE interface.h)
source_group("Private Sources" FILES extra/extra.cpp)
source_group(TREE ${CMAKE_CURRENT_SOURCE_DIR}/src PREFIX Code FILES src/detail/impl.cpp)
qt_add_resources(globbed images PREFIX / FILES assets/logo.png assets/icons/add.svg)
configure_file(version.h.in version.h)
EOF
printf 'set(EXTRA_SOURCES extra/extra.cpp)\n' > "$GLOB/cmake/Sources.cmake"
printf '{}\n' > "$GLOB/CMakePresets.json"
printf '{"dependencies": []}\n' > "$GLOB/vcpkg.json"
touch "$GLOB/src/main.cpp" "$GLOB/src/app.h" "$GLOB/src/detail/impl.cpp" "$GLOB/src/build/generated.cpp" "$GLOB/src/secret/key.cpp" \
  "$GLOB/extra/extra.cpp" "$GLOB/assets/logo.png" "$GLOB/assets/icons/add.svg" "$GLOB/version.h.in" "$GLOB-shared/lib/util.cpp"
printf 'src/secret/\n' > "$GLOB/.gitignore"
commit_all "$GLOB"
explore "$GLOB" "$TREE"
check "tree" "$(printed 1)" "Globbed  [$(branch_of "$GLOB")]
  CMakeLists.txt
  globbed
    Code
      detail
        src/detail
          impl.cpp
    Header Files
      src
        app.h
    Private Sources
      extra
        extra.cpp
    Resources
      assets
        icons
          add.svg
        logo.png
    Source Files
      ../globbed-shared/lib
        util.cpp
      src
        main.cpp
  vcpkg Packages
  CMake Presets
    CMakePresets.json
  CMake Modules
    cmake
      Sources.cmake
    vcpkg.json
    version.h.in"

echo "== qmake: include(), SUBDIRS, \$\$files(), -= and every scope; an ignored include is not read =="
QM="$WORK/qmake"
rm -rf "$QM" && mkdir -p "$QM/app/qml" "$QM/common" "$QM/lib" "$QM/ignored"
printf 'TEMPLATE = subdirs\nSUBDIRS += app lib\napp.depends = lib\n' > "$QM/top.pro"
printf 'SOURCES += secret.cpp\n' > "$QM/ignored/secret.pri"
printf 'ignored/\n' > "$QM/.gitignore"
printf 'include(../common.pri)\ninclude(../ignored/secret.pri)\nSOURCES += main.cpp\nHEADERS += $$PWD/app.h\nDISTFILES += qml/Main.qml README.md\n# include(../missing.pri)\n' > "$QM/app/app.pro"
printf 'HEADERS += $$PWD/common/config.h\nSOURCES += $$files($$PWD/common/*.cpp)\n' > "$QM/common.pri"
printf 'TEMPLATE = lib\nSOURCES += lib.cpp\nwin32 {\n    SOURCES += win.cpp\n}\nunix: SOURCES += unix.cpp\nSOURCES -= lib.cpp\n' > "$QM/lib/lib.pro"
touch "$QM/ignored/secret.cpp" "$QM/app/main.cpp" "$QM/app/app.h" "$QM/app/qml/Main.qml" "$QM/app/README.md" "$QM/common/config.h" "$QM/common/util.cpp" \
  "$QM/lib/lib.cpp" "$QM/lib/win.cpp" "$QM/lib/unix.cpp"
commit_all "$QM"
explore "$QM" "$TREE"
check "tree" "$(printed 1)" "top  [$(branch_of "$QM")]
  top.pro
  app
    app.pro
    common
      common.pri
      Headers
        common
          config.h
      Sources
        common
          util.cpp
    Headers
      app.h
    Sources
      main.cpp
    QML
      qml
        Main.qml
    Other files
      README.md
  lib
    lib.pro
    Sources
      unix.cpp
      win.cpp"
