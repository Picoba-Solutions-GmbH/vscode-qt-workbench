pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "components"
import "views"

// The application shell. It owns no data at all -- it just picks which view is
// on screen. Everything stateful lives in the C++ singletons (AppTheme,
// TaskStore), which is why switching tabs never loses anything.
ApplicationWindow {
    id: window

    width: 960
    height: 680
    minimumWidth: 560
    minimumHeight: 460
    visible: true
    title: qsTr("Qt Multi-View Demo")
    color: AppTheme.background

    header: Rectangle {
        implicitHeight: 54
        color: AppTheme.surface

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 12

            TabBar {
                id: tabBar

                Layout.fillHeight: true
                background: null

                Repeater {
                    model: [qsTr("Tasks"), qsTr("Stats"), qsTr("Settings"), qsTr("Basics")]

                    TabButton {
                        id: tabButton

                        required property string modelData

                        text: tabButton.modelData
                        // TabBar stretches its buttons evenly unless they are
                        // given an explicit width.
                        width: Math.max(90, implicitWidth)

                        contentItem: Text {
                            text: tabButton.text
                            font.pixelSize: 14
                            font.bold: tabButton.checked
                            color: tabButton.checked ? AppTheme.accent : AppTheme.subtleText
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }

                        background: Item {
                            Rectangle {
                                anchors.bottom: parent.bottom
                                width: parent.width
                                height: 2
                                color: tabButton.checked ? AppTheme.accent : "transparent"
                            }
                        }
                    }
                }
            }

            Item {
                Layout.fillWidth: true
            }

            ThemedButton {
                text: AppTheme.lightMode ? qsTr("☽  Dark") : qsTr("☼  Light")
                outlined: true
                onClicked: AppTheme.toggle()
            }
        }

        Rectangle {
            anchors.bottom: parent.bottom
            width: parent.width
            height: 1
            color: AppTheme.border
        }
    }

    // All four views are built up front and simply hidden/shown. Swap this for
    // a StackView with Loaders if a view ever gets expensive to create.
    StackLayout {
        anchors.fill: parent
        currentIndex: tabBar.currentIndex

        TasksView {}
        StatsView {}
        SettingsView {}
        BasicsView {}
    }
}
