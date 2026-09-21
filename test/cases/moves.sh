# Moving files: build-file entries, #includes, resources, and QML imports that follow
# the types each file uses.

echo "== moving BasicsView from views/ to vince/ adds the import =="
prepare_app views
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "Main.qml gains import vince" "$(imports "$APP/Main.qml")" 'import "components";import "views";import "vince";'
check "no warnings" "$(grep -c '^  !' "$LAST")" "0"
check "build tree untouched" "$(changed "$APP" builds)" "0"

echo "== moving it back removes the import, and never duplicates one =="
prepare_app vince
check "starts with views and vince imported" "$(imports "$APP/Main.qml")" 'import "components";import "views";import "vince";'
move "$APP" '[["vince/BasicsView.qml","views/BasicsView.qml"]]'
check "vince removed, views not duplicated" "$(imports "$APP/Main.qml")" 'import "components";import "views";'
check "build tree untouched" "$(changed "$APP" builds)" "0"

echo "== a round trip leaves Main.qml byte for byte as it was =="
prepare_app views
cp "$APP/Main.qml" "$WORK/Main.orig"
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
commit_changes "$APP" there
move "$APP" '[["vince/BasicsView.qml","views/BasicsView.qml"]]'
check "identical after the round trip" "$(cmp -s "$WORK/Main.orig" "$APP/Main.qml" && echo same || echo differs)" "same"
check "CMakeLists.txt back to views" "$(grep -c 'views/BasicsView.qml' "$APP/CMakeLists.txt")" "1"

echo "== moving back when Main.qml does not import views repoints the import in place =="
prepare_app vince
sed -i '/^import "views"$/d' "$APP/Main.qml"
commit_changes "$APP" noviews
move "$APP" '[["vince/BasicsView.qml","views/BasicsView.qml"]]'
check "vince repointed to views" "$(imports "$APP/Main.qml")" 'import "components";import "views";'

echo "== a build tree is recognised by its CMakeCache.txt, not only by its name =="
prepare_app views
(cd "$APP" && git mv builds out-of-tree-xyz) && commit_changes "$APP" rename
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "import added despite the odd build folder name" "$(imports "$APP/Main.qml")" 'import "components";import "views";import "vince";'
check "odd-named build tree untouched" "$(changed "$APP" out-of-tree-xyz)" "0"
check "log names the skipped folder" "$(grep -c 'skipping 1 build dir(s): out-of-tree-xyz' "$LAST")" "1"

echo "== moving every view to pages/ repoints the import instead of adding one =="
prepare_app views
move "$APP" '[["views/TasksView.qml","pages/TasksView.qml"],["views/TaskDetailView.qml","pages/TaskDetailView.qml"],["views/StatsView.qml","pages/StatsView.qml"],["views/SettingsView.qml","pages/SettingsView.qml"],["views/BasicsView.qml","pages/BasicsView.qml"]]'
check "views -> pages in place" "$(imports "$APP/Main.qml")" 'import "components";import "pages";'
check "the views' own ../components untouched" "$(imports "$APP/pages/TasksView.qml")" 'import "../components";'

echo "== moving the components/ folder rebases every import of it =="
prepare_app views
move "$APP" '[["components","ui/components"]]'
check "Main.qml rebased" "$(imports "$APP/Main.qml")" 'import "ui/components";import "views";'
check "a view rebased" "$(imports "$APP/views/TasksView.qml")" 'import "../ui/components";'

echo "== a moved QML file rebases its own imports =="
prepare_app views
move "$APP" '[["Main.qml","app/Main.qml"]]'
check "own imports rebased" "$(imports "$APP/app/Main.qml")" 'import "../components";import "../views";'

echo "== a view moving into the folder it imports =="
prepare_app views
move "$APP" '[["views/TasksView.qml","components/TasksView.qml"]]'
check "own-folder import dropped, sibling TaskDetailView now imported" "$(imports "$APP/components/TasksView.qml")" 'import "../views";'
check "Main.qml needs nothing new" "$(imports "$APP/Main.qml")" 'import "components";import "views";'

echo "== moving a header updates includes in both directions =="
prepare_app views
move "$APP" '[["reportservice.h","services/reportservice.h"]]'
check "the including .cpp's include shortened" "$(grep '#include "' "$APP/services/reportservice.cpp" | head -1)" '#include "reportservice.h"'
check "the moved header's own include rebased" "$(grep '#include "' "$APP/services/reportservice.h")" '#include "../taskstore.h"'

echo "== a type used as a same-folder sibling, and through a qualified import =="
prepare_siblings
move "$SIBS" '[["widgets/Badge.qml","chips/Badge.qml"]]'
check "sibling Panel.qml gains an import" "$(imports "$SIBS/widgets/Panel.qml")" 'import "../chips";'
check "qualifier carried, widgets kept for Panel" "$(imports "$SIBS/views/TasksView.qml")" 'import "../widgets" as W;import "../chips" as W;'
check "user of a C++ singleton untouched" "$(changed "$SIBS" views/StatsView.qml)" "0"

echo "== .qrc aliases, qmldir entries, .pro lists, qrc:/ URLs and Loader paths =="
prepare_resources
move "$RES" '[["images/logo.png","assets/logo.png"],["views/TasksView.qml","pages/TasksView.qml"],["widgets/Badge.qml","widgets/chips/Badge.qml"]]'
check "qrc alias keeps the :/ URL" "$(grep -c '<file alias="images/logo.png">assets/logo.png</file>' "$RES/res.qrc")" "1"
check "qmldir entry" "$(grep Badge "$RES/widgets/qmldir")" "Badge 1.0 chips/Badge.qml"
check "qrc:/ URL" "$(grep -c 'qrc:/qt/qml/Demo/App/pages/TasksView.qml' "$RES/src/main.cpp")" "1"
check ".pro DISTFILES" "$(grep DISTFILES "$RES/demo.pro")" "DISTFILES += assets/logo.png pages/TasksView.qml"
check "import of a qmldir folder kept" "$(imports "$RES/pages/TasksView.qml")" 'import "../widgets";'
check "Loader source path" "$(grep -c 'source: "../widgets/chips/Badge.qml"' "$RES/pages/TasksView.qml")" "1"

echo "== a Main.qml with triplicated imports heals on the next move =="
prepare_app views
sed -i 's#^import "views"$#import "views"\nimport "views"\nimport "views"#' "$APP/Main.qml"
commit_changes "$APP" polluted
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "duplicates collapsed, vince added" "$(imports "$APP/Main.qml")" 'import "components";import "views";import "vince";'
move "$APP" '[["vince/BasicsView.qml","views/BasicsView.qml"]]'
check "clean after moving back" "$(imports "$APP/Main.qml")" 'import "components";import "views";'

echo "== repeated moves back and forth stay clean =="
prepare_app vince
for pair in 'vince views' 'views vince' 'vince views'; do
  set -- $pair
  move "$APP" "[[\"$1/BasicsView.qml\",\"$2/BasicsView.qml\"]]"
done
check "three moves, one views import" "$(imports "$APP/Main.qml")" 'import "components";import "views";'

echo "== duplicates in a file the move does not touch are left alone =="
prepare_app views
sed -i 's#^import "../components"$#import "../components"\nimport "../components"#' "$APP/views/StatsView.qml"
commit_changes "$APP" dup
move "$APP" '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
check "StatsView.qml untouched" "$(changed "$APP" views/StatsView.qml)" "0"
