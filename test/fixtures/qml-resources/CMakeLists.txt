qt_add_executable(demo src/main.cpp)
qt_add_qml_module(demo
    URI Demo.App
    QML_FILES
        views/TasksView.qml
        widgets/Badge.qml
    RESOURCES
        images/logo.png
)
