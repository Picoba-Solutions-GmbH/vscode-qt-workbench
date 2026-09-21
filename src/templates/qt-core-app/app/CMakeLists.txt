# The application: the user interface on top of the core library.
#
# Its QML shows what the view models give it, and its view models turn the
# core's objects into what the QML shows. The data and the rules stay in the
# core.

qt_add_executable(app%{ProjectName}
    main.cpp
)

# One QML module holds the QML files and the view models. Every class marked
# QML_ELEMENT in SOURCES becomes a QML type of the module "%{ProjectName}".
qt_add_qml_module(app%{ProjectName}
    URI %{ProjectName}
    QML_FILES
        Main.qml
        views/ExpensesView.qml
        views/BudgetView.qml
        components/BudgetBar.qml
    SOURCES
        viewmodels/coretypes.h
        viewmodels/formatting.h
        viewmodels/formatting.cpp
        viewmodels/expensesviewmodel.h
        viewmodels/expensesviewmodel.cpp
        viewmodels/budgetviewmodel.h
        viewmodels/budgetviewmodel.cpp
)

# The code Qt generates to register the QML types includes each header by its
# name alone (#include <budgetviewmodel.h>), so the folder holding them goes
# on the include path.
target_include_directories(app%{ProjectName} PRIVATE
    viewmodels
)

# Qt for iOS sets MACOSX_BUNDLE_GUI_IDENTIFIER automatically since Qt 6.1.
# If you are developing for iOS or macOS you should consider setting an
# explicit, fixed bundle identifier manually though.
set_target_properties(app%{ProjectName} PROPERTIES
#    MACOSX_BUNDLE_GUI_IDENTIFIER com.example.app%{ProjectName}
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
    MACOSX_BUNDLE TRUE
    WIN32_EXECUTABLE TRUE
)

# Linking the core brings its include folder and Qt Core with it.
target_link_libraries(app%{ProjectName}
    PRIVATE
        %{ProjectName}Core
        Qt6::Quick
)

install(TARGETS app%{ProjectName}
    BUNDLE DESTINATION .
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
