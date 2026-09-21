# Set Up QML Hot Reload Debugging: the debug configuration written for each debugger and
# system (hot-reload/setup.js), and the command offering it with QT_QML_DEBUG and a console
# for the Debug build in CMakeLists.txt.

EXT="$(native_path "${EXT_DIR:-$TEST_DIR/..}")"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) WINDOWS=1 ;;
  *) WINDOWS=0 ;;
esac

# setup_says <JavaScript expression>: its JSON value, with s = hot-reload/setup.js and j = json-syntax.js.
setup_says() {
  "${RUNTIME[@]}" -e '
    const [ext, expr] = process.argv.slice(1);
    const s = require(ext + "/src/hot-reload/setup"), j = require(ext + "/src/json-syntax");
    Promise.resolve().then(() => eval(expr)).then((r) => console.log(typeof r === "string" ? r : JSON.stringify(r)), (e) => console.log("threw " + e.message));
  ' "$EXT" "$1"
}

MINGW_KIT='{ id: "mingw", dir: "C:/Qt/6.11.2/mingw_64", gdb: "C:/Qt/Tools/mingw1310_64/bin/gdb.exe" }'
MSVC_KIT='{ id: "msvc", dir: "C:/Qt/6.11.2/msvc2022_64" }'
LAUNCH_ITEM='.vscode/launch.json: Debug Qt Application with QML hot reload'
QML_ITEM='CMakeLists.txt: QT_QML_DEBUG for appTest in Debug builds'
CONSOLE_ITEM='CMakeLists.txt: a console for appTest in Debug builds'

echo "== the debug configuration =="
check "MinGW with the Qt C++ extension: as it is written by hand" \
  "$(setup_says 'JSON.stringify({ version: "0.2.0", configurations: [s.hotReloadConfiguration({ platform: "win32", kit: '"$MINGW_KIT"', qtCpp: true })] }, null, 4)')" '{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug Qt Application with QML hot reload",
            "type": "cppdbg",
            "request": "launch",
            "program": "${command:cmake.launchTargetPath}",
            "args": [
                "-qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview"
            ],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "visualizerFile": "${command:qt-cpp.natvis}",
            "showDisplayString": true,
            "windows": {
                "sourceFileMap": {
                    "Q:/qt5_workdir/w/s": "${command:qt-cpp.sourceDirectory}",
                    "C:/work/build/qt5_workdir/w/s": "${command:qt-cpp.sourceDirectory}",
                    "c:/users/qt/work/qt": "${command:qt-cpp.sourceDirectory}",
                    "c:/Users/qt/work/install": "${command:qt-cpp.sourceDirectory}",
                    "/Users/qt/work/qt": "${command:qt-cpp.sourceDirectory}"
                },
                "environment": [
                    {
                        "name": "PATH",
                        "value": "${command:qt-cpp.qtDir};${env:PATH}"
                    },
                    {
                        "name": "QT_QPA_PLATFORM_PLUGIN_PATH",
                        "value": "${command:qt-cpp.QT_QPA_PLATFORM_PLUGIN_PATH}"
                    },
                    {
                        "name": "QML_IMPORT_PATH",
                        "value": "${command:qt-cpp.QML_IMPORT_PATH}"
                    }
                ],
                "MIMode": "gdb",
                "miDebuggerPath": "C:/Qt/Tools/mingw1310_64/bin/gdb.exe"
            }
        }
    ]
}'
check "MinGW without the Qt C++ extension: the kit's bin on PATH, nothing of its commands" \
  "$(setup_says 's.hotReloadConfiguration({ platform: "win32", kit: '"$MINGW_KIT"', qtCpp: false })')" \
  '{"name":"Debug Qt Application with QML hot reload","type":"cppdbg","request":"launch","program":"${command:cmake.launchTargetPath}","args":["-qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview"],"stopAtEntry":false,"cwd":"${workspaceFolder}","windows":{"environment":[{"name":"PATH","value":"C:/Qt/6.11.2/mingw_64/bin;${env:PATH}"}],"MIMode":"gdb","miDebuggerPath":"C:/Qt/Tools/mingw1310_64/bin/gdb.exe"}}'
check "MSVC: the Visual Studio debugger" \
  "$(setup_says 'const c = s.hotReloadConfiguration({ platform: "win32", kit: '"$MSVC_KIT"', qtCpp: true }); [c.type, "showDisplayString" in c, c.visualizerFile, Object.keys(c.windows)]')" \
  '["cppvsdbg",false,"${command:qt-cpp.natvis}",["sourceFileMap","environment"]]'
check "Linux and macOS: gdb and lldb, found by the C/C++ extension" \
  "$(setup_says '[s.hotReloadConfiguration({ platform: "linux", kit: null, qtCpp: true }).linux, s.hotReloadConfiguration({ platform: "darwin", kit: null, qtCpp: false }).osx]')" \
  '[{"sourceFileMap":{"/home/qt/work/qt":"${command:qt-cpp.sourceDirectory}"},"MIMode":"gdb"},{"MIMode":"lldb"}]'
check "the configurations hot reload connects to, variables unresolved: not the QML debugger's, not one without QmlPreview" \
  "$(setup_says 's.hotReloadConfigurationNames([
      { name: "hot", args: ["-qmljsdebugger=port:1234,services:QmlPreview"] },
      { name: "written", args: [s.hotReloadConfiguration({ platform: "linux", kit: null, qtCpp: false }).args[0]] },
      { name: "js", args: ["-qmljsdebugger=port:1234,services:QmlDebugger,V8Debugger,QmlPreview"] },
      { name: "plain", args: [] },
      null
    ])')" '["hot","written"]'
check "launch.json is read with comments and trailing commas; CMakePresets.json is not" \
  "$(setup_says 'const t = "{\n  // a comment\n  \"configurations\": [ /* none */ ],\n}"; [j.plain(j.parseJson(t, { comments: true })), (() => { try { j.parseJson(t); } catch (e) { return e.message; } })()]')" \
  '[{"configurations":[]},"expected a property name at line 2"]'

echo "== the demo app: a new launch.json, QT_QML_DEBUG and a console =="
prepare_qt_install
prepare_app views
set_up_hot_reload "$APP" - "[[\"$LAUNCH_ITEM\",\"$QML_ITEM\",\"$CONSOLE_ITEM\"]]"
check "offered, all picked" "$(pick_items $((1 + WINDOWS)))" "[x] $LAUNCH_ITEM
[x] $QML_ITEM
[x] $CONSOLE_ITEM"
[ "$WINDOWS" = 1 ] && check "on Windows the kit is asked first" "$(grep -m1 '^PICK:' "$LAST")" "PICK: Qt kit to build with"
check "created, saved, opened" "$(grep -E '^(CREATED|SAVED|OPENED):' "$LAST")" "CREATED: .vscode/launch.json
SAVED: .vscode/launch.json,CMakeLists.txt
OPENED: .vscode/launch.json:?:?"
check "a console in Debug builds" "$(sed -n '/^set_target_properties/,/^)/p' "$APP/CMakeLists.txt" | tail -3)" '    # Console app in Debug so stdout/qDebug reach the terminal; GUI app otherwise
    WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>
)'
check "QT_QML_DEBUG after the last command naming the target" "$(sed -n '/^target_link_libraries/,/^install/p' "$APP/CMakeLists.txt")" 'target_link_libraries(appTest
    PRIVATE Qt6::Quick
)

# Honour -qmljsdebugger in Debug builds: QML debugging, profiling and live preview / hot reload
target_compile_definitions(appTest PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)

install(TARGETS appTest'
check "the configuration" "$(json_says "$APP/.vscode/launch.json" '[d.version, d.configurations.map((c) => c.name + " " + c.program + " " + c.args.join(" "))]')" \
  '["0.2.0",["Debug Qt Application with QML hot reload ${command:cmake.launchTargetPath} -qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview"]]'
if [ "$WINDOWS" = 1 ]; then
  check "the kit's gdb and bin" "$(json_says "$APP/.vscode/launch.json" '[d.configurations[0].windows.miDebuggerPath, d.configurations[0].windows.environment[0].value]' | sed "s#$(native_path "$WORK")#\${work}#g")" \
    '["${work}/Qt/Tools/mingw1310_64/bin/gdb.exe","${work}/Qt/6.11.2/mingw_64/bin;${env:PATH}"]'
fi
check "log" "$(grep -c "^  \* $LAUNCH_ITEM$" "$LAST")$(grep -c "^  \* $QML_ITEM$" "$LAST")$(grep -c "^  \* $CONSOLE_ITEM$" "$LAST")" "111"
check "without CMake Tools: said so" "$(grep -c '^\[info\] Qt Workbench: set up QML hot reload debugging in .vscode/launch.json and CMakeLists.txt. Build the Debug build again, then start debugging. It needs the CMake Tools extension.$' "$LAST")" "1"
check "nothing else changed" "$(changed "$APP")" "2"

echo "== the same again: nothing to set up =="
commit_changes "$APP" "hot reload"
KIT_PICK=none set_up_hot_reload "$APP" - '[]'
check "says so, asks nothing" "$(grep -c '^\[info\] Qt Workbench: QML hot reload debugging is set up already. The log says what was found.$' "$LAST")$(grep -c '^PICK:' "$LAST")" "10"
check "log says what was found" "$(grep -E '^  (\.vscode|appTest)' "$LAST")" '  .vscode/launch.json: Debug Qt Application with QML hot reload already starts the application with QML hot reload
  appTest: WIN32_EXECUTABLE is $<NOT:$<CONFIG:Debug>>, left as it is
  appTest: QT_QML_DEBUG is defined already'
check "nothing written" "$(changed "$APP")" "0"

if [ "$WINDOWS" = 1 ]; then
  echo "== with the Qt C++ extension, and the kit named by CMakePresets.json =="
  prepare_app views
  printf '{\n  "version": 3,\n  "configurePresets": [\n    {\n      "name": "debug",\n      "binaryDir": "b",\n      "vendor": { "qt-cpp": { "VSCODE_QT_INSTALLATION": "%s/Qt/6.11.2/mingw_64" } }\n    }\n  ]\n}\n' "$(native_path "$WORK")" > "$APP/CMakePresets.json"
  commit_changes "$APP" presets
  KIT_PICK=none EXTENSIONS=theqtcompany.qt-cpp,ms-vscode.cmake-tools set_up_hot_reload "$APP" - "[[\"$LAUNCH_ITEM\"]]"
  check "no kit asked" "$(grep -c '^PICK: Qt kit' "$LAST")$(grep -c '^  Qt kits in the presets: Qt 6.11.2 MinGW 64-bit$' "$LAST")" "01"
  check "launch.json as written by hand" "$(sed "s#$(native_path "$WORK")#\${work}#g" "$APP/.vscode/launch.json")" \
    "$(setup_says 'JSON.stringify({ version: "0.2.0", configurations: [s.hotReloadConfiguration({ platform: "win32", kit: { id: "mingw", gdb: "${work}/Qt/Tools/mingw1310_64/bin/gdb.exe" }, qtCpp: true })] }, null, 4)')"
  check "CMakeLists.txt not chosen, not changed" "$(changed "$APP" CMakeLists.txt)$(grep -c '^  not chosen: CMakeLists.txt: QT_QML_DEBUG for appTest in Debug builds$' "$LAST")" "01"
  check "with CMake Tools: start debugging" "$(grep -c '^\[info\] Qt Workbench: set up QML hot reload debugging in .vscode/launch.json. Start debugging with it.$' "$LAST")" "1"
fi

echo "== a launch.json as VS Code creates it: comments kept, the configuration added =="
prepare_app views
mkdir -p "$APP/.vscode"
printf '{\n    // Use IntelliSense to learn about possible attributes.\n    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387\n    "version": "0.2.0",\n    "configurations": []\n}\n' > "$APP/.vscode/launch.json"
commit_changes "$APP" launch
set_up_hot_reload "$APP" - "[[\"$LAUNCH_ITEM\"]]"
check "offered as an addition" "$(pick_item $((1 + WINDOWS)) "[x] $LAUNCH_ITEM")" "[x] $LAUNCH_ITEM | added to its configurations"
check "comments kept, laid out like the file" "$(head -8 "$APP/.vscode/launch.json")" '{
    // Use IntelliSense to learn about possible attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug Qt Application with QML hot reload",
            "type": "cppdbg",'
check "saved" "$(grep '^SAVED:' "$LAST")" "SAVED: .vscode/launch.json"

echo "== after another configuration, with a trailing comma =="
prepare_app views
mkdir -p "$APP/.vscode"
printf '{\n  "configurations": [\n    {\n      "name": "Run",\n      "type": "cppdbg",\n      "request": "launch",\n    },\n  ],\n}\n' > "$APP/.vscode/launch.json"
commit_changes "$APP" launch
set_up_hot_reload "$APP" - "[[\"$LAUNCH_ITEM\"]]"
check "added after it, the trailing comma kept" \
  "$(setup_says 'j.plain(j.parseJson(require("fs").readFileSync("'"$(native_path "$APP/.vscode/launch.json")"'", "utf8"), { comments: true })).configurations.map((c) => c.name)')" \
  '["Run","Debug Qt Application with QML hot reload"]'
check "two-space layout" "$(sed -n 7,9p "$APP/.vscode/launch.json")" '    },
    {
      "name": "Debug Qt Application with QML hot reload",'
check "the file ends as it did" "$(tail -3 "$APP/.vscode/launch.json")" '    },
  ],
}'

echo "== a launch.json with a hot reload configuration of its own: only CMakeLists.txt offered =="
prepare_app views
mkdir -p "$APP/.vscode"
printf '{"configurations": [{"name": "Mine", "type": "cppdbg", "request": "launch", "args": ["-qmljsdebugger=port:5555,block,services:QmlPreview"]}]}\n' > "$APP/.vscode/launch.json"
commit_changes "$APP" mine
KIT_PICK=none set_up_hot_reload "$APP" - "[[\"$QML_ITEM\"]]"
check "no kit asked, no launch.json offered" "$(pick_items 1)" "[x] $QML_ITEM
[x] $CONSOLE_ITEM"
check "its configuration named in the log" "$(grep -c '^  .vscode/launch.json: Mine already starts the application with QML hot reload$' "$LAST")" "1"
check "only QT_QML_DEBUG, no console" "$(grep -c 'QT_QML_DEBUG' "$APP/CMakeLists.txt")$(grep -c 'WIN32_EXECUTABLE TRUE' "$APP/CMakeLists.txt")" "11"
check "launch.json left as it is" "$(changed "$APP" .vscode)" "0"

echo "== qt_add_executable(... WIN32 ...): the keyword becomes the property =="
prepare_app views
sed -i 's/^qt_add_executable(appTest$/qt_add_executable(appTest WIN32 MACOSX_BUNDLE/; /^    WIN32_EXECUTABLE TRUE$/d' "$APP/CMakeLists.txt"
commit_changes "$APP" keyword
set_up_hot_reload "$APP" - "[[\"$CONSOLE_ITEM\",\"$QML_ITEM\"]]"
check "WIN32 taken out" "$(grep '^qt_add_executable' "$APP/CMakeLists.txt")" "qt_add_executable(appTest MACOSX_BUNDLE"
check "the property and QT_QML_DEBUG after the target's last command" "$(sed -n '/^target_link_libraries/,/^install/p' "$APP/CMakeLists.txt")" 'target_link_libraries(appTest
    PRIVATE Qt6::Quick
)

# Console app in Debug so stdout/qDebug reach the terminal; GUI app otherwise
set_target_properties(appTest PROPERTIES WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>)

# Honour -qmljsdebugger in Debug builds: QML debugging, profiling and live preview / hot reload
target_compile_definitions(appTest PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)

install(TARGETS appTest'

echo "== a CMakeLists.txt with CRLF line endings keeps them =="
prepare_app views
sed -i 's/$/\r/' "$APP/CMakeLists.txt"
commit_changes "$APP" crlf
set_up_hot_reload "$APP" - "[[\"$QML_ITEM\",\"$CONSOLE_ITEM\"]]"
check "every line ends in CRLF, the new ones too" "$(grep -c $'\r$' "$APP/CMakeLists.txt") of $(wc -l < "$APP/CMakeLists.txt")" "72 of 72"
check "the comment and the value on their own lines" "$(grep -A1 'Console app in Debug' "$APP/CMakeLists.txt" | tr -d '\r')" '    # Console app in Debug so stdout/qDebug reach the terminal; GUI app otherwise
    WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>'

echo "== QT_QML_DEBUG defined another way, a console already: only launch.json offered =="
prepare_app views
sed -i 's/^    WIN32_EXECUTABLE TRUE$/    WIN32_EXECUTABLE OFF/; s/^find_package(Qt6 REQUIRED COMPONENTS Quick)$/&\nadd_compile_definitions($<$<CONFIG:Debug>:QT_QML_DEBUG>)/' "$APP/CMakeLists.txt"
commit_changes "$APP" defined
set_up_hot_reload "$APP" - '[]'
check "only launch.json" "$(pick_items $((1 + WINDOWS)))" "[x] $LAUNCH_ITEM"
check "why not the others" "$(grep -E '^  appTest' "$LAST")" '  appTest: WIN32_EXECUTABLE is OFF, left as it is
  appTest: QT_QML_DEBUG is defined already'
check "Escape: nothing written" "$(changed "$APP")" "0"

echo "== a target created in if(), named by \${PROJECT_NAME}: QT_QML_DEBUG inside the block =="
TINY="$WORK/tiny"
rm -rf "$TINY" && mkdir -p "$TINY"
printf 'cmake_minimum_required(VERSION 3.16)\nproject(tiny)\nfind_package(Qt6 REQUIRED COMPONENTS Quick)\n\nif(NOT ANDROID)\n    qt_add_executable(${PROJECT_NAME} main.cpp)\n    target_link_libraries(${PROJECT_NAME} PRIVATE Qt6::Quick)\nendif()\n' > "$TINY/CMakeLists.txt"
printf 'int main() {}\n' > "$TINY/main.cpp"
commit_all "$TINY"
set_up_hot_reload "$TINY" - "[[\"CMakeLists.txt: QT_QML_DEBUG for tiny in Debug builds\"]]"
check "offered for tiny, no console needed" "$(pick_items $((1 + WINDOWS)) | tail -1)$(grep -c '^  tiny: a console application in every build$' "$LAST")" "[x] CMakeLists.txt: QT_QML_DEBUG for tiny in Debug builds1"
check "inside the if(), spelled like the target" "$(sed -n '/^if/,/^endif/p' "$TINY/CMakeLists.txt")" 'if(NOT ANDROID)
    qt_add_executable(${PROJECT_NAME} main.cpp)
    target_link_libraries(${PROJECT_NAME} PRIVATE Qt6::Quick)

    # Honour -qmljsdebugger in Debug builds: QML debugging, profiling and live preview / hot reload
    target_compile_definitions(${PROJECT_NAME} PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)
endif()'

echo "== a widgets application: no QML, nothing for CMakeLists.txt =="
prepare_widgets
set_up_hot_reload "$WID" - '[]'
check "only launch.json offered" "$(pick_items $((1 + WINDOWS)))" "[x] $LAUNCH_ITEM"
check "why" "$(grep -c '^  Notes: uses no QML$' "$LAST")" "1"

echo "== a launch.json that is not valid JSON: nothing asked, nothing written =="
prepare_app views
mkdir -p "$APP/.vscode" && printf '{ "configurations": [ }\n' > "$APP/.vscode/launch.json"
commit_changes "$APP" broken
KIT_PICK=none set_up_hot_reload "$APP" - '[]'
check "says why" "$(grep -c '^\[error\] Qt Workbench: .vscode/launch.json cannot be read: unexpected "}" at line 1. Fix it, then set up QML hot reload again.$' "$LAST")$(grep -c '^PICK:' "$LAST")" "10"
check "nothing written" "$(changed "$APP")" "0"

echo "== from the Qt Project Explorer, on the project =="
prepare_app views
KIT_ANSWER=""
[ "$WINDOWS" = 1 ] && KIT_ANSWER="\"$KIT\","
SETTINGS='{"qt-core.qtInstallationRoot":"${work}/Qt"}' PROCESS_ENV='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio"}' \
  explore "$APP" "[{\"command\":\"qtWorkbench.projectExplorer.setUpHotReload\",\"node\":\"Test\",\"picks\":[$KIT_ANSWER[\"$LAUNCH_ITEM\",\"$QML_ITEM\"]]}]"
check "launch.json and QT_QML_DEBUG" "$(cd "$APP" && git status --porcelain | cut -c4- | sort | tr '\n' ';')" '.vscode/launch.json;CMakeLists.txt;'
