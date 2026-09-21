pragma ComponentBehavior: Bound

import QtQuick
// The controls in the Basic style, the same on every system. Each QML file
// imports the style by name, so the QML compiler knows every control's type.
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "views"

// The window: a tab for each view. It holds no data and no rules. The views
// get what they show from the view models, and the view models get it from
// the core library.
ApplicationWindow {
    id: window

    width: 720
    height: 560
    minimumWidth: 480
    minimumHeight: 400
    visible: true
    title: qsTr("%{ProjectName}")

    header: TabBar {
        id: tabBar

        Repeater {
            model: [qsTr("Expenses"), qsTr("Budget")]

            TabButton {
                id: tab

                required property string modelData

                text: modelData

                // The current tab is underlined in the system's accent colour.
                contentItem: Label {
                    text: tab.text
                    font.bold: tab.checked
                    opacity: tab.checked ? 1 : 0.6
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Item {
                    implicitHeight: 44

                    Rectangle {
                        anchors.bottom: parent.bottom
                        width: parent.width
                        height: 2
                        color: tab.checked ? tab.palette.highlight : "transparent"
                    }
                }
            }
        }
    }

    StackLayout {
        anchors.fill: parent
        currentIndex: tabBar.currentIndex

        ExpensesView {}
        BudgetView {}
    }
}
