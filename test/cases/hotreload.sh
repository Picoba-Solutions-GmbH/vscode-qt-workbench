# QML hot reload while debugging: a debug session whose program runs with
# -qmljsdebugger=...,services:QmlPreview gets its QML reloaded when a file is saved.
# The application is fake-qml-app.js; see prepare_hot_reload in lib.sh for the build tree.

EXT="$(native_path "${EXT_DIR:-$TEST_DIR/..}")"

# target <JSON args>: what hot reload makes of a debug configuration with these args.
target() {
  "${RUNTIME[@]}" -e 'const l = require(process.argv[1]); console.log(JSON.stringify(l.previewTarget({ args: JSON.parse(process.argv[2]) })))' \
    "$EXT/src/hot-reload/launch.js" "$1"
}

echo "== which debug configurations hot reload connects to =="
check "host, port and block" \
  "$(target '["-qmljsdebugger=host:127.0.0.1,port:5555,block,services:QmlPreview,DebugTranslation"]')" \
  '{"hosts":["127.0.0.1"],"ports":[5555],"block":true}'
check "localhost: Qt listens everywhere, so both loopbacks" \
  "$(target '["-qmljsdebugger=host:localhost,port:5555,services:QmlPreview"]')" \
  '{"hosts":["127.0.0.1","::1"],"ports":[5555],"block":false}'
check "a port range, QmlPreview not first" \
  "$(target '["--verbose","-qmljsdebugger=port:5555-5557,block,services:DebugMessages,QmlPreview"]')" \
  '{"hosts":["127.0.0.1","::1"],"ports":[5555,5556,5557],"block":true}'
check "args as one command line" \
  "$(target '"--a -qmljsdebugger=port:1234,services:QmlPreview --b"')" \
  '{"hosts":["127.0.0.1","::1"],"ports":[1234],"block":false}'
check "the QML debugger's services: skipped, it needs the connection" \
  "$(target '["-qmljsdebugger=host:localhost,port:5555,block,services:DebugMessages,QmlDebugger,V8Debugger,QmlPreview"]' | grep -c '"skip":"it also enables the QML debugger (QmlDebugger, V8Debugger)')" "1"
check "no QmlPreview service: not for hot reload" \
  "$(target '["-qmljsdebugger=host:localhost,port:5555,block,services:DebugMessages,QmlDebugger,V8Debugger"]')" "null"
check "no -qmljsdebugger at all" "$(target '["--foo"]')" "null"
check "file: connections are not supported" \
  "$(target '["-qmljsdebugger=file:qmlpreview1,block,services:QmlPreview"]' | grep -c '"skip":"file:qmlpreview1')" "1"

echo "== .qrc files are read the way rcc reads them =="
QRC="$WORK/qrc"
rm -rf "$QRC" && mkdir -p "$QRC/src/views" "$QRC/src/assets/icons" "$QRC/build/.qt/rcc" "$QRC/build/Test" "$QRC/build/CMakeFiles/x"
touch "$QRC/src/Main.qml" "$QRC/src/views/A&B.qml" "$QRC/src/assets/icons/add.svg" "$QRC/src/assets/logo.png"
printf '<RCC>\n  <qresource prefix="/qt/qml/App">\n    <file alias="Main.qml">%s/src/Main.qml</file>\n    <file>../../../src/views/A&amp;B.qml</file>\n  </qresource>\n  <qresource prefix="img/">\n    <file alias="pics">../../../src/assets</file>\n  </qresource>\n</RCC>\n' \
  "$(native_path "$QRC")" > "$QRC/build/.qt/rcc/app.qrc"
printf '<RCC><qresource prefix="/"><file alias="/qt/qml/App">../Test</file></qresource></RCC>\n' > "$QRC/build/Test/app_qml_module_dir_map.qrc"
printf '<RCC><qresource prefix="/"><file>x.qml</file></qresource></RCC>\n' > "$QRC/build/CMakeFiles/x/x.qrc"
tree_says() {
  "${RUNTIME[@]}" -e '
    const { ResourceTree, findBuildQrcFiles } = require(process.argv[1]);
    const t = new ResourceTree();
    const qrcs = findBuildQrcFiles(process.argv[2]);
    for (const q of qrcs) t.addQrc(q);
    const show = (p) => { const r = t.lookup(p); return p + " = " + (!r ? "null" : r.kind === "file" ? require("path").basename(r.file) : "[" + r.entries.join(",") + "]"); };
    console.log(["qrc files: " + qrcs.length, ...process.argv.slice(3).map(show)].join(";"));
  ' "$EXT/src/hot-reload/resource-tree.js" "$(native_path "$QRC/build")" "$@"
}
check "only rcc's inputs: no dir map, nothing under CMakeFiles" "$(tree_says)" "qrc files: 1"
check "alias under a prefix without a trailing slash" "$(tree_says ':/qt/qml/App/Main.qml')" "qrc files: 1;:/qt/qml/App/Main.qml = Main.qml"
check "no alias: the path as written, without leading ../, entities decoded" \
  "$(tree_says ':/qt/qml/App/src/views/A&B.qml')" "qrc files: 1;:/qt/qml/App/src/views/A&B.qml = A&B.qml"
check "a directory entry brings in everything below it" \
  "$(tree_says 'qrc:///img//pics/icons/add.svg' ':/img/pics')" "qrc files: 1;qrc:///img//pics/icons/add.svg = add.svg;:/img/pics = [icons,logo.png]"
check "directories up to the root list their entries" \
  "$(tree_says ':/qt/qml' ':/qt/qml/App' ':/qt/qml/Other')" "qrc files: 1;:/qt/qml = [App];:/qt/qml/App = [Main.qml,src];:/qt/qml/Other = null"

BLOCK="$(debug_config 'block,services:QmlPreview,DebugTranslation')"

echo "== the application's reads are answered from the sources =="
prepare_hot_reload
debug_session "$APP" "$BLOCK" '[
  {"connect": true}, {"wait": 150}, {"status": "connected"},
  {"request": ":/qt/qml/Test/qmldir"},
  {"request": ":/qt/qml/Test/Main.qml"},
  {"request": ":/qt/qml/Test"},
  {"request": ":/qt/qml/Test/views/TasksView.qml"},
  {"request": ":/qt/qml/QtQuick/Controls/Basic/qmldir"},
  {"request": ":/qt/qml/Test//Rectangle.qml"},
  {"request": "${root}/components"},
  {"request": "${root}/builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/Main.qml"},
  {"end": true}, {"status": "ended"}
]'
check "connects, asking for QmlPreview only" "$(step '"connect"')" "connected, asking for QmlPreview;"
check "status bar: connected, click reloads" "$(step '"connected"')" 'status: $(flame) QML Hot Reload -> qtWorkbench.reloadQml;'
check "the module qmldir comes from the build tree" "$(step 'Test/qmldir')" 'app got FILE :/qt/qml/Test/qmldir "module Test";'
check "Main.qml comes from the sources" "$(step '":/qt/qml/Test/Main.qml"')" 'app got FILE :/qt/qml/Test/Main.qml "pragma ComponentBehavior: Bound";'
check "the first QML file read is the root" "$(grep -c '^  root component: qrc:/qt/qml/Test/Main.qml$' "$LAST")" "1"
check "a resource directory lists what rcc compiled" "$(step '"request":":/qt/qml/Test"}')" 'app got DIRECTORY :/qt/qml/Test [Main.qml,components,qmldir,views];'
check "Qt's own modules are left to the application" "$(step 'QtQuick')" 'app got ERROR :/qt/qml/QtQuick/Controls/Basic/qmldir;'
check "so are names that are not files of ours" "$(step 'Rectangle')" 'app got ERROR :/qt/qml/Test//Rectangle.qml;'
check "a source folder read from disk is listed" "$(step '${root}/components')" \
  "app got DIRECTORY $(native_path "$APP")/components [Card.qml,ThemedButton.qml,ThemedCheckBox.qml,ThemedCombo.qml,ThemedField.qml,ThemedLabel.qml];"
check "the build tree is never served" "$(step 'Debug/Test/Main.qml')" "app got ERROR $(native_path "$APP")/builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/Main.qml;"
check "log: what was found in the build tree" "$(grep -c '^  13 compiled-in file(s) from 2 .qrc file(s) of builds/Qt-6.11.2-mingw_64-x86_64/Debug$' "$LAST")" "1"
check "ending the session disconnects" "$(step '"end"')" "application disconnected;"
check "and hides the status bar item" "$(step '"ended"')" "status: (hidden);"

echo "== saving a QML file sends it and reloads the root component =="
prepare_hot_reload
debug_session "$APP" "$BLOCK" '[
  {"connect": true},
  {"request": ":/qt/qml/Test/Main.qml"},
  {"request": ":/qt/qml/Test/views/TasksView.qml"},
  {"write": "views/TasksView.qml", "text": "// v2\nItem {}\n"}, {"save": "views/TasksView.qml"}, {"wait": 301},
  {"save": "views/TasksView.qml"}, {"wait": 302},
  {"write": "views/TasksView.qml", "text": "// v3\nItem {}\n"}, {"save": "views/TasksView.qml"}, {"watch": "views/TasksView.qml"}, {"wait": 303},
  {"write": "components/Card.qml", "text": "// card\nItem {}\n"}, {"write": "components/ThemedLabel.qml", "text": "// label\nText {}\n"},
  {"save": "components/Card.qml"}, {"save": "components/ThemedLabel.qml"}, {"wait": 304},
  {"write": "main.cpp", "text": "int main() {}\n"}, {"save": "main.cpp"}, {"wait": 305},
  {"write": "builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/Main.qml", "text": "// copy\n"}, {"watch": "builds/Qt-6.11.2-mingw_64-x86_64/Debug/Test/Main.qml"}, {"wait": 306},
  {"command": "qtWorkbench.reloadQml"}, {"wait": 307},
  {"end": true}
]'
check "the new contents, then the root again" "$(step '"wait":301')" 'app got FILE :/qt/qml/Test/views/TasksView.qml "// v2";app got LOAD qrc:/qt/qml/Test/Main.qml;'
check "saving unchanged contents reloads nothing" "$(step '"wait":302')" ""
check "a save and the watcher seeing it are one reload" "$(step '"wait":303')" 'app got FILE :/qt/qml/Test/views/TasksView.qml "// v3";app got LOAD qrc:/qt/qml/Test/Main.qml;'
check "Save All: every file, one load; also files not read yet" "$(step '"wait":304')" \
  'app got FILE :/qt/qml/Test/components/Card.qml "// card";app got FILE :/qt/qml/Test/components/ThemedLabel.qml "// label";app got LOAD qrc:/qt/qml/Test/Main.qml;'
check "C++ sources are not the application's resources" "$(step '"wait":305')" ""
check "neither are the build tree's copies" "$(step '"wait":306')" ""
check "Reload QML reloads even with nothing changed" "$(step 'reloadQml')$(step '"wait":307')" 'app got LOAD qrc:/qt/qml/Test/Main.qml;'
check "log names the files and the root" "$(grep -c '^  sent views/TasksView.qml, reloading qrc:/qt/qml/Test/Main.qml$' "$LAST")" "2"

echo "== a load error shows, and the next good reload clears it =="
prepare_hot_reload
debug_session "$APP" "$BLOCK" '[
  {"connect": true},
  {"request": ":/qt/qml/Test/Main.qml"},
  {"appError": "qrc:/qt/qml/Test/views/TasksView.qml:13:12: Expected a qualified name id\n"}, {"wait": 150}, {"status": "failed"},
  {"write": "views/TasksView.qml", "text": "// fixed\nItem {}\n"}, {"save": "views/TasksView.qml"}, {"wait": 300}, {"status": "fixed"},
  {"end": true}
]'
check "a warning with the error" "$(grep -c '^\[warning\] QML hot reload: qrc:/qt/qml/Test/views/TasksView.qml:13:12: Expected a qualified name id$' "$LAST")" "1"
check "status bar: warning, click shows the log" "$(step '"failed"')" 'status: $(warning) QML Hot Reload [statusBarItem.warningBackground] -> qtWorkbench.showLog;'
check "status bar: back to connected after the next reload" "$(step '"fixed"')" 'status: $(flame) QML Hot Reload -> qtWorkbench.reloadQml;'

echo "== without block, QML files wait for the first reload =="
prepare_hot_reload
debug_session "$APP" "$(debug_config 'services:QmlPreview')" '[
  {"connect": true},
  {"request": ":/qt/qml/Test/views/StatsView.qml"},
  {"request": ":/qt/qml/Test/views"},
  {"write": "views/TasksView.qml", "text": "// v2\nItem {}\n"}, {"save": "views/TasksView.qml"}, {"wait": 301},
  {"write": "views/TasksView.qml", "text": "// v3\nItem {}\n"}, {"save": "views/TasksView.qml"}, {"wait": 302},
  {"request": ":/qt/qml/Test/views/StatsView.qml"},
  {"end": true}
]'
check "a QML file read before is left to the application: it would become the root" \
  "$(step '"request":":/qt/qml/Test/views/StatsView.qml"')" 'app got ERROR :/qt/qml/Test/views/StatsView.qml;app got FILE :/qt/qml/Test/views/StatsView.qml "pragma ComponentBehavior: Bound";'
check "directories are answered all the same" "$(step '"request":":/qt/qml/Test/views"}')" \
  'app got DIRECTORY :/qt/qml/Test/views [BasicsView.qml,SettingsView.qml,StatsView.qml,TaskDetailView.qml,TasksView.qml];'
check "the first reload names the root before sending files" "$(step '"wait":301')" \
  'app got LOAD qrc:/qt/qml/Test/Main.qml;app got FILE :/qt/qml/Test/views/TasksView.qml "// v2";app got LOAD qrc:/qt/qml/Test/Main.qml;'
check "later reloads do not" "$(step '"wait":302')" 'app got FILE :/qt/qml/Test/views/TasksView.qml "// v3";app got LOAD qrc:/qt/qml/Test/Main.qml;'

echo "== debug sessions hot reload leaves alone =="
prepare_hot_reload
debug_session "$APP" "$(debug_config 'block,services:DebugMessages,QmlDebugger,V8Debugger,QmlPreview')" '[{"connect": 800}, {"status": "x"}]'
check "the QML debugger's session: not connected" "$(step '"connect"')$(step '"x"')" "not connected;status: (hidden);"
check "log says why" "$(grep -c '^  not connecting: it also enables the QML debugger (QmlDebugger, V8Debugger)' "$LAST")" "1"
check "block: warns the application will wait" "$(grep -c '^\[warning\] QML hot reload is not connecting to "Debug appTest", which waits for a QML debug client' "$LAST")" "1"

SETTINGS='{"qmlHotReload":false}' debug_session "$APP" "$BLOCK" '[{"connect": 800}]'
check "qmlHotReload off: not connected" "$(step '"connect"')" "not connected;"
check "log says why" "$(grep -c '^  not connecting: qtWorkbench.qmlHotReload is off$' "$LAST")" "1"

debug_session "$APP" "$(debug_config 'block,services:DebugMessages,QmlDebugger,V8Debugger')" '[{"connect": 800}]'
check "QML debugging without QmlPreview: not even logged" "$(step '"connect"')$(grep -c 'QML hot reload' "$LAST")" "not connected;0"
