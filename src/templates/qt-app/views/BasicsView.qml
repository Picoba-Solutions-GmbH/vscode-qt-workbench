pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import %{ProjectName}

// A C++ object created right in the QML: BasicsViewModel's properties are
// bound to labels and its Q_INVOKABLE methods wired to buttons.
//
// This object is declared HERE, so it belongs to this view and dies with it.
// TaskStore and AppTheme are singletons and are shared by everything.
Item {
    id: root

    property string callResult: ""

    BasicsViewModel {
        id: viewModel
    }

    GridLayout {
        anchors.fill: parent
        anchors.margins: 12
        columns: width < 620 ? 1 : 2
        columnSpacing: 12
        rowSpacing: 12

        Card {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 8

                ThemedLabel {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    // Bound to the C++ Q_PROPERTY.
                    text: viewModel.message
                    font.pixelSize: 96
                    fontSizeMode: Text.Fit
                    minimumPixelSize: 16
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                ThemedLabel {
                    Layout.fillWidth: true
                    text: qsTr("Counter: %1").arg(viewModel.counter)
                    font.pixelSize: 20
                    horizontalAlignment: Text.AlignHCenter
                }

                ThemedLabel {
                    Layout.fillWidth: true
                    text: root.callResult
                    visible: root.callResult.length > 0
                    color: AppTheme.subtleText
                    font.pixelSize: 13
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }

        Card {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 8

                ThemedLabel {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.bottomMargin: 4
                    text: qsTr("Calls into C++")
                    font.pixelSize: 16
                    font.bold: true
                }

                ThemedField {
                    id: nameField

                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    placeholderText: qsTr("Your name")
                    onAccepted: viewModel.greet(text)
                }

                ThemedButton {
                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Greet")
                    // void greet(const QString &) -- sets the message property.
                    onClicked: viewModel.greet(nameField.text)
                }

                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: 8

                    ThemedButton {
                        Layout.preferredWidth: 91
                        text: qsTr("−")
                        onClicked: viewModel.decrement()
                    }

                    ThemedButton {
                        Layout.preferredWidth: 91
                        text: qsTr("+")
                        onClicked: viewModel.increment()
                    }
                }

                ThemedButton {
                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Current time")
                    // QString currentTime() -- return value used directly.
                    onClicked: root.callResult = viewModel.currentTime()
                }

                ThemedButton {
                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Random number")
                    // int randomNumber(int, int) -- arguments passed from QML.
                    onClicked: root.callResult = qsTr("Random: %1")
                                                    .arg(viewModel.randomNumber(1, 100))
                }

                ThemedButton {
                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("System info")
                    onClicked: root.callResult = viewModel.systemInfo()
                }

                ThemedButton {
                    Layout.preferredWidth: 190
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Reset")
                    outlined: true
                    onClicked: {
                        viewModel.reset()
                        root.callResult = ""
                        nameField.clear()
                    }
                }

                Item {
                    Layout.fillHeight: true
                }
            }
        }
    }
}
