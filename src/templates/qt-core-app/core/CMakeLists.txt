# The core library: what the application knows and the rules it keeps.
#
# It links Qt Core and nothing else -- no Qt Gui, Qt Qml or Qt Quick -- so no
# user interface code can creep in: an #include <QQuickItem> here does not
# compile. Qt Core still brings QObject with its signals and properties,
# QString, QDate, JSON and files.
#
# A static library is linked into each program that uses it. A shared one
# would need an export macro on every class the app and the tests use.
qt_add_library(%{ProjectName}Core STATIC
    domain/category.h
    domain/category.cpp
    domain/expense.h
    domain/expense.cpp
    domain/budget.h
    domain/budget.cpp
    domain/ledger.h
    domain/ledger.cpp
    storage/ledgerfile.h
    storage/ledgerfile.cpp
)

# PUBLIC: whatever links the core gets this folder on its include path too,
# and includes its headers by their path in here: #include "domain/ledger.h".
target_include_directories(%{ProjectName}Core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(%{ProjectName}Core
    PUBLIC Qt6::Core
)
