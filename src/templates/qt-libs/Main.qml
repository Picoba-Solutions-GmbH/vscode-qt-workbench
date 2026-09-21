pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Fusion
import "views"

// One tab per library vcpkg installed. The C++ using a library is in the
// folder of the same name -- json/, csv/, rest/, plc/ -- and its tab in views/.
//
// Importing QtQuick.Controls.Fusion picks the Fusion style for every control
// of this file; it follows the system's light or dark palette.
ApplicationWindow {
    width: 1000
    height: 700
    minimumWidth: 640
    minimumHeight: 480
    visible: true
    title: qsTr("%{ProjectName}")

    header: TabBar {
        id: tabBar

        TabButton { text: qsTr("JSON") }
        TabButton { text: qsTr("CSV") }
        TabButton { text: qsTr("REST") }
        TabButton { text: qsTr("PLC (S7)") }
    }

    StackLayout {
        anchors.fill: parent
        anchors.margins: 12
        currentIndex: tabBar.currentIndex

        JsonView {}
        CsvView {}
        RestView {}
        PlcView {}
    }
}
