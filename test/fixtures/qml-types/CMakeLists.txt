qt_add_executable(demo src/main.cpp src/widget.cpp src/widget.h src/widget.ui)
qt_add_qml_module(demo
    URI Demo
    QML_FILES
        app/Main.qml
        widgets/Badge.qml
        widgets/Panel.qml
        views/Page.qml
        views/Clash.qml
)
