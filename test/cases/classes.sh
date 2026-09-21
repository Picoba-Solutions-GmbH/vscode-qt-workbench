# Renaming C++ classes: Rename Symbol (F2) on a class QML knows by name renames its QML
# references in the same edit as the language server's C++ ones.

echo "== renaming BasicsViewModel to TestViewModel renames it in QML =="
prepare_app views
rename_symbol "$APP" basics.h BasicsViewModel TestViewModel
check "one edit for C++ and QML" "$(grep '^EDITED:' "$LAST")" "EDITED: basics.h,viewmodels/basics.cpp,views/BasicsView.qml"
check "BasicsView.qml uses TestViewModel" "$(grep -c '^    TestViewModel {$' "$APP/views/BasicsView.qml"),$(grep -c BasicsViewModel "$APP/views/BasicsView.qml")" "1,0"
check "BasicsView.qml imports untouched" "$(grep -c '^import' "$APP/views/BasicsView.qml")" "5"
check "log names the class" "$(grep -c '^  type BasicsViewModel  ->  TestViewModel' "$LAST")" "1"
check "no warnings" "$(grep -c '^  !' "$LAST")" "0"
check "build tree untouched" "$(changed "$APP" builds)" "0"
commit_changes "$APP" renamed
rename_symbol "$APP" basics.h TestViewModel BasicsViewModel
check "renaming back restores every file" "$(cd "$APP" && git diff --name-only HEAD~1 | grep -c .)" "0"

echo "== F2 on a use of the class in a .cpp file =="
prepare_app views
rename_symbol "$APP" viewmodels/basics.cpp BasicsViewModel TestViewModel
check "BasicsView.qml follows" "$(grep -c '^    TestViewModel {$' "$APP/views/BasicsView.qml")" "1"

echo "== a C++ symbol QML does not know by name leaves QML alone =="
prepare_app views
rename_symbol "$APP" basics.h m_counter m_count
check "only C++ edited" "$(grep '^EDITED:' "$LAST")" "EDITED: basics.h,viewmodels/basics.cpp"
check "nothing logged" "$(grep -c 'C++ class renamed' "$LAST")" "0"

echo "== every way a C++ type is referenced (Gauge -> Meter) =="
prepare_cpp
rename_symbol "$CPP" src/gauge.h Gauge Meter src/gauge.h,src/gauge.cpp,src/main.cpp
check "object and enum in a module file" "$(grep -c 'Meter { mode: Meter.Fast }' "$CPP/app/Main.qml")" "1"
check "comment untouched" "$(grep -c '// Main shows one Gauge.' "$CPP/app/Main.qml")" "1"
check "property type and object" "$(grep -c 'property Meter gauge: Meter {}' "$CPP/views/Page.qml")" "1"
check "string untouched" "$(grep -c 'label: "Gauge"' "$CPP/views/Page.qml")" "1"
check "member access root.Gauge untouched" "$(grep -c 'root.Gauge' "$CPP/views/Page.qml")" "1"
check "qualified D.Gauge" "$(grep -c 'function make(): D.Meter' "$CPP/views/Page.qml"),$(grep -c '^    D.Meter {}' "$CPP/views/Page.qml")" "1,1"
check "Qt.createComponent type string" "$(grep -c 'createComponent("Demo", "Meter")' "$CPP/views/Page.qml")" "1"
check "import Demo 1.0 as D outside the module" "$(grep -c 'D.Meter {}' "$CPP/ext/Consumer.qml")" "1"
check "ambiguous file untouched" "$(changed "$CPP" views/Clash.qml)" "0"
check "ambiguity warned" "$(grep -c 'Gauge in views/Clash.qml could mean more than one type' "$LAST")" "1"
check "another module's Gauge untouched" "$(changed "$CPP" ext/OtherUser.qml plugin widgets)" "0"
check "C++ loadFromModule" "$(grep -c 'loadFromModule("Demo", "Meter")' "$CPP/src/main.cpp"),$(grep -c 'loadFromModule("Other", "Gauge")' "$CPP/src/main.cpp")" "1,1"
check "language server's own edits kept" "$(grep -c '^    Meter gauge;' "$CPP/src/main.cpp"),$(grep -c 'Meter::Meter' "$CPP/src/gauge.cpp")" "1,1"
check "no imports touched" "$(cd "$CPP" && git diff -U0 | grep -c '^[-+]import')" "0"

echo "== a language server that renames inside strings too =="
prepare_cpp
LS_STRINGS=1 rename_symbol "$CPP" src/gauge.h Gauge Meter src/gauge.h,src/gauge.cpp,src/main.cpp
check "no overlapping edit: the string is renamed once" "$(grep -c 'loadFromModule("Demo", "Meter");$' "$CPP/src/main.cpp")" "1"
check "QML still follows" "$(grep -c 'Meter { mode: Meter.Fast }' "$CPP/app/Main.qml")" "1"

echo "== a namespace with QML_ELEMENT (Modes -> Levels) =="
prepare_cpp
rename_symbol "$CPP" src/modes.h Modes Levels
check "enum access follows" "$(grep -c 'property int level: Levels.High' "$CPP/views/Page.qml")" "1"

echo "== QML_NAMED_ELEMENT keeps its QML name (Dial -> Wheel) =="
prepare_cpp
rename_symbol "$CPP" src/dial.h Dial Wheel
check "only the header edited" "$(grep '^EDITED:' "$LAST")" "EDITED: src/dial.h"
check "Knob and QtQuick.Controls' Dial untouched" "$(grep -c '^    Dial {}' "$CPP/views/Page.qml"),$(grep -c '^    Knob {}' "$CPP/views/Page.qml")" "1,1"

echo "== a class built into no qt_add_qml_module target =="
prepare_cpp
rename_symbol "$CPP" src/loose.h Loose Free
check "C++ renamed, QML untouched" "$(grep '^EDITED:' "$LAST"),$(grep -c 'Loose {}' "$CPP/app/Main.qml")" "EDITED: src/loose.h,1"
check "warned" "$(grep -c 'src/loose.h is not built into any qt_add_qml_module target' "$LAST")" "1"

echo "== a new name QML cannot use =="
prepare_cpp
rename_symbol "$CPP" src/gauge.h Gauge gauge_impl src/gauge.h,src/gauge.cpp,src/main.cpp
check "C++ renamed, QML untouched" "$(grep '^EDITED:' "$LAST"),$(changed "$CPP" app views ext)" "EDITED: src/gauge.cpp,src/gauge.h,src/main.cpp,0"
check "warned" "$(grep -c 'gauge_impl is not a QML type name' "$LAST")" "1"

echo "== renameCppTypes = false leaves the rename to the language server =="
prepare_cpp
SETTINGS='{"renameCppTypes":false}' rename_symbol "$CPP" src/gauge.h Gauge Meter src/gauge.h,src/gauge.cpp,src/main.cpp
check "C++ renamed, QML untouched" "$(grep '^EDITED:' "$LAST"),$(changed "$CPP" app views ext)" "EDITED: src/gauge.cpp,src/gauge.h,src/main.cpp,0"
