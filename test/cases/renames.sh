# Renaming files: a .qml file's name is its type name, so a rename follows every
# reference to the type; C++ renames follow includes, build entries and generated files.

echo "== renaming BasicsView.qml to TestView.qml renames its type =="
prepare_app views
cp "$APP/Main.qml" "$WORK/Main.orig"
move "$APP" '[["views/BasicsView.qml","views/TestView.qml"]]'
check "Main.qml uses TestView" "$(grep -c '^        TestView {}' "$APP/Main.qml"),$(grep -c BasicsView "$APP/Main.qml")" "1,0"
check "Main.qml imports untouched" "$(imports "$APP/Main.qml")" 'import "components";import "views";'
check "CMakeLists.txt entry" "$(grep -c 'views/TestView.qml' "$APP/CMakeLists.txt")" "1"
commit_changes "$APP" renamed
move "$APP" '[["views/TestView.qml","views/BasicsView.qml"]]'
check "renaming back restores Main.qml byte for byte" "$(cmp -s "$WORK/Main.orig" "$APP/Main.qml" && echo same || echo differs)" "same"

echo "== renaming Main.qml follows loadFromModule =="
prepare_app views
move "$APP" '[["Main.qml","App.qml"]]'
check "loadFromModule follows" "$(grep loadFromModule "$APP/main.cpp" | tr -d ' ')" 'engine.loadFromModule("Test","App");'

echo "== renaming a header follows its includes =="
prepare_app views
move "$APP" '[["apptheme.h","theme.h"]]'
check "include follows" "$(grep '#include' "$APP/singletons/apptheme.cpp" | head -1)" '#include "theme.h"'
check "CMakeLists.txt entry" "$(grep -cw 'theme.h' "$APP/CMakeLists.txt")" "1"

echo "== every way a QML type is referenced (Badge -> Chip) =="
prepare_types
move "$TYPES" '[["widgets/Badge.qml","widgets/Chip.qml"]]'
check "self reference Badge.Large" "$(grep -c 'size: Chip.Large' "$TYPES/widgets/Chip.qml")" "1"
check "property type, object and enum" "$(grep -c 'property Chip badge: Chip { size: Chip.Small }' "$TYPES/widgets/Panel.qml")" "1"
check "function return type" "$(grep -c 'function make(): Chip' "$TYPES/widgets/Panel.qml")" "1"
check "comment untouched" "$(grep -c '// A Badge sits' "$TYPES/widgets/Panel.qml")" "1"
check "string untouched" "$(grep -c 'label: "Badge"' "$TYPES/widgets/Panel.qml")" "1"
check "member access root.Badge untouched" "$(grep -c 'root.Badge' "$TYPES/widgets/Panel.qml")" "1"
check "qualified W.Badge" "$(grep -c 'W.Chip {}' "$TYPES/views/Page.qml")" "1"
check "Qt.createComponent type string" "$(grep -c 'createComponent("Demo", "Chip")' "$TYPES/views/Page.qml")" "1"
check "Page.qml imports untouched" "$(imports "$TYPES/views/Page.qml")" 'import "../widgets" as W;'
check "module member without imports" "$(grep -c 'Window { Chip {} }' "$TYPES/app/Main.qml")" "1"
check "import Demo as D" "$(grep -c 'D.Chip {}' "$TYPES/ext/Consumer.qml")" "1"
check "ambiguous file untouched" "$(changed "$TYPES" views/Clash.qml)" "0"
check "ambiguity warned" "$(grep -c 'Badge in views/Clash.qml could mean more than one file' "$LAST")" "1"
check "unrelated other/Badge.qml untouched" "$(changed "$TYPES" other)" "0"
check "C++ u\"\"_s loadFromModule" "$(grep -c 'loadFromModule(u"Demo"_s, u"Chip"_s)' "$TYPES/src/main.cpp")" "1"
check "another module's Badge untouched" "$(grep -c 'QStringLiteral("Other.Module"), QStringLiteral("Badge")' "$TYPES/src/main.cpp")" "1"
check "CMakeLists.txt entry" "$(grep -c 'widgets/Chip.qml' "$TYPES/CMakeLists.txt")" "1"

echo "== rename and move in one go (Badge -> chips/Chip) =="
prepare_types
move "$TYPES" '[["widgets/Badge.qml","chips/Chip.qml"]]'
check "sibling renamed and imports the new folder" "$(grep -c 'property Chip badge: Chip { size: Chip.Small }' "$TYPES/widgets/Panel.qml"),$(grep -c 'function make(): Chip' "$TYPES/widgets/Panel.qml"),$(imports "$TYPES/widgets/Panel.qml")" '1,1,import "../chips";'
check "qualified renamed, qualifier carried" "$(grep -c 'W.Chip {}' "$TYPES/views/Page.qml"),$(imports "$TYPES/views/Page.qml")" '1,import "../widgets" as W;import "../chips" as W;'
check "module member renamed, no import needed" "$(grep -c 'Chip {}' "$TYPES/app/Main.qml"),$(imports "$TYPES/app/Main.qml")" "1,"

echo "== a new name that is not a QML type renames nothing =="
prepare_types
move "$TYPES" '[["widgets/Badge.qml","widgets/badge_old.qml"]]'
check "warned" "$(grep -c 'badge_old is not a QML type name' "$LAST")" "1"
check "references and imports untouched" "$(changed "$TYPES" widgets/Panel.qml views app ext)" "0"

echo "== qmldir type name =="
prepare_types
move "$TYPES" '[["legacy/Old.qml","legacy/New.qml"]]'
check "entry renamed, singleton untouched" "$(grep -E 'qml$' "$TYPES/legacy/qmldir" | tr '\n' ';')" 'New 1.0 New.qml;singleton Other 1.0 Other.qml;'

echo "== includes of files Qt generates from source names =="
prepare_types
move "$TYPES" '[["src/widget.h","src/gadget.h"]]'
check "header rename: include and moc_" "$(grep '#include' "$TYPES/src/widget.cpp" | tr '\n' ';')" '#include "gadget.h";#include "ui_widget.h";#include "moc_gadget.cpp";#include "widget.moc";'
prepare_types
move "$TYPES" '[["src/widget.cpp","src/gadget.cpp"]]'
check "source rename: .moc" "$(grep '#include' "$TYPES/src/gadget.cpp" | tr '\n' ';')" '#include "widget.h";#include "ui_widget.h";#include "moc_widget.cpp";#include "gadget.moc";'
prepare_types
move "$TYPES" '[["src/widget.ui","src/gadget.ui"]]'
check "form rename: ui_" "$(grep '#include' "$TYPES/src/widget.cpp" | tr '\n' ';')" '#include "widget.h";#include "ui_gadget.h";#include "moc_widget.cpp";#include "widget.moc";'
