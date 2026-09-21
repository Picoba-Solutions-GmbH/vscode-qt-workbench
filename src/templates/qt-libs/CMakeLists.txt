cmake_minimum_required(VERSION 3.21)

project(%{ProjectName} VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Quick)

# The libraries vcpkg installs from vcpkg.json. The CMake presets set vcpkg's
# toolchain file, which runs vcpkg install before this point and lets
# find_package() find what it installed. Each package names the targets to
# link in its usage file, which vcpkg install prints.
find_package(nlohmann_json CONFIG REQUIRED)
find_package(unofficial-vincentlaucsb-csv-parser CONFIG REQUIRED)
find_package(snap7 CONFIG REQUIRED)
find_package(CURL REQUIRED)

qt_standard_project_setup(REQUIRES 6.10)

qt_add_executable(app%{ProjectName}
    main.cpp
)

qt_add_qml_module(app%{ProjectName}
    URI %{ProjectName}
    QML_FILES
        Main.qml
        views/JsonView.qml
        views/CsvView.qml
        views/RestView.qml
        views/PlcView.qml
    SOURCES
        json/jsonplayground.h
        json/jsonplayground.cpp
        json/jsonvariant.h
        json/jsonvariant.cpp
        csv/csvtablemodel.h
        csv/csvtablemodel.cpp
        rest/restservice.h
        rest/restservice.cpp
        plc/plcclient.h
        plc/plcclient.cpp
        plc/plcsimulator.h
        plc/plcsimulator.cpp
)

# The code Qt generates to register the QML types includes each header by its
# name alone (#include <plcclient.h>), so every folder holding a QML_ELEMENT
# header goes on the include path.
target_include_directories(app%{ProjectName} PRIVATE
    json
    csv
    rest
    plc
)

set_target_properties(app%{ProjectName} PROPERTIES
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
    MACOSX_BUNDLE TRUE
    WIN32_EXECUTABLE TRUE
)

target_link_libraries(app%{ProjectName}
    PRIVATE
        Qt6::Quick
        nlohmann_json::nlohmann_json
        unofficial::vincentlaucsb-csv-parser::csv
        snap7::snap7
        CURL::libcurl
)

# vcpkg copies the DLLs an executable needs next to it for its Visual Studio
# triplets only. With MinGW, copy them here, or the program does not start.
if (MINGW AND DEFINED VCPKG_INSTALLED_DIR)
    set(vcpkg_bin "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/bin")
    if (CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(vcpkg_bin "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/debug/bin")
    endif()
    file(GLOB vcpkg_dlls "${vcpkg_bin}/*.dll")
    if (vcpkg_dlls)
        add_custom_command(TARGET app%{ProjectName} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different ${vcpkg_dlls} $<TARGET_FILE_DIR:app%{ProjectName}>
            VERBATIM
        )
    endif()
endif()

install(TARGETS app%{ProjectName}
    BUNDLE DESTINATION .
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
