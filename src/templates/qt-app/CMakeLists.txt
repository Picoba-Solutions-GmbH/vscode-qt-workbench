cmake_minimum_required(VERSION 3.16)

project(%{ProjectName} VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Quick)

# Turns on AUTOMOC and the other settings a Qt project needs, and refuses Qt
# versions older than the one given.
qt_standard_project_setup(REQUIRES 6.10)

# A design exported with Figma to Qt goes into importedcontent/, with the
# CMakeLists.txt it comes with.
if (EXISTS "${CMAKE_CURRENT_LIST_DIR}/importedcontent/CMakeLists.txt")
    add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/importedcontent)
endif()

qt_add_executable(app%{ProjectName}
    main.cpp
)

# One QML module holds the QML files and the C++ types they use. Every class
# marked QML_ELEMENT in SOURCES becomes a QML type of the module "%{ProjectName}".
qt_add_qml_module(app%{ProjectName}
    URI %{ProjectName}
    QML_FILES
        Main.qml
        views/TasksView.qml
        views/TaskDetailView.qml
        views/StatsView.qml
        views/SettingsView.qml
        views/BasicsView.qml
        components/Card.qml
        components/ThemedButton.qml
        components/ThemedLabel.qml
        components/ThemedField.qml
        components/ThemedCheckBox.qml
        components/ThemedCombo.qml
    SOURCES
        models/priority.h
        models/taskstore.h
        models/taskstore.cpp
        models/taskfilterproxy.h
        models/taskfilterproxy.cpp
        services/reportservice.h
        services/reportservice.cpp
        theme/apptheme.h
        theme/apptheme.cpp
        viewmodels/basicsviewmodel.h
        viewmodels/basicsviewmodel.cpp
)

# The code Qt generates to register the QML types includes each header by its
# name alone (#include <taskstore.h>), so every folder holding a QML_ELEMENT
# header goes on the include path. Your own code can include them by name too.
target_include_directories(app%{ProjectName} PRIVATE
    models
    services
    theme
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

target_link_libraries(app%{ProjectName}
    PRIVATE Qt6::Quick
)

install(TARGETS app%{ProjectName}
    BUNDLE DESTINATION .
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
