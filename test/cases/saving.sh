# Saving: VS Code leaves a move participant's edits unsaved, so the extension saves them
# afterwards -- following files.refactoring.autoSave, never touching a file that already
# had unsaved changes.

echo "== edited files are saved after the move =="
prepare_app views
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "CMakeLists.txt and Main.qml saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,Main.qml"
check "log says so" "$(grep -c '^  saved 2 file(s)' "$LAST")" "1"
check "log carries the version" "$(grep -cE '^\[.*\] v[0-9]+\.[0-9]+\.[0-9]+: 1 file\(s\) moved' "$LAST")" "1"

echo "== a file that already had unsaved edits is not saved =="
prepare_app views
DIRTY=Main.qml move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "only CMakeLists.txt saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt"

echo "== files.refactoring.autoSave = false saves nothing =="
prepare_app views
AUTOSAVE=false move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "nothing saved" "$(grep '^SAVED:' "$LAST")" "SAVED: "

echo "== a moved and edited file is saved at its new path =="
prepare_app views
move "$APP" '[["Main.qml","app/Main.qml"]]'
check "saved as app/Main.qml" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakeLists.txt,app/Main.qml"
