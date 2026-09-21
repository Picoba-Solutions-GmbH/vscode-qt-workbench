# The core library's tests, with Qt Test. They link the core and nothing that
# draws, so they run without a window or a display: on a build server too.
# Run them with ctest, or from the Testing view of CMake Tools.

qt_add_executable(tst_budget tst_budget.cpp)
target_link_libraries(tst_budget PRIVATE %{ProjectName}Core Qt6::Test)
add_test(NAME tst_budget COMMAND tst_budget)

qt_add_executable(tst_ledger tst_ledger.cpp)
target_link_libraries(tst_ledger PRIVATE %{ProjectName}Core Qt6::Test)
add_test(NAME tst_ledger COMMAND tst_ledger)

qt_add_executable(tst_ledgerfile tst_ledgerfile.cpp)
target_link_libraries(tst_ledgerfile PRIVATE %{ProjectName}Core Qt6::Test)
add_test(NAME tst_ledgerfile COMMAND tst_ledgerfile)

# Windows looks for a program's DLLs next to it and on PATH. Qt's are in
# neither, so ctest puts them on PATH for the tests.
if (WIN32)
    set_tests_properties(tst_budget tst_ledger tst_ledgerfile PROPERTIES
        ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${QT6_INSTALL_PREFIX}/${QT6_INSTALL_BINS}"
    )
endif()
