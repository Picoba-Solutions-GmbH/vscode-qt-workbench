pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Fusion
import %{ProjectName}

// A GET request made in C++ (rest/restservice.cpp); the JSON reply arrives as
// a JavaScript value and drives a ListView.
Item {
    id: root

    property var items: []
    property string message: ""

    RestService {
        id: rest

        // A signal's arguments arrive as the handler's parameters. A QVariantList
        // arrives as a list that reads like an array (length, [i]), although
        // Array.isArray() says no; Array.from() makes it a real one.
        onReplied: (status, data, body) => {
            root.message = qsTr("HTTP %1, %2 bytes").arg(status).arg(body.length)
            root.items = data !== null && typeof data === "object" && data.length !== undefined ? Array.from(data) : [data]
            raw.text = body
        }
        onFailed: (error) => {
            root.message = error
            root.items = []
            raw.text = ""
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            TextField {
                id: url

                Layout.fillWidth: true
                text: "https://jsonplaceholder.typicode.com/todos?_limit=20"
                selectByMouse: true
                onAccepted: getButton.clicked()
            }

            Button {
                id: getButton

                text: qsTr("GET")
                enabled: !rest.busy
                onClicked: rest.get(url.text)
            }

            BusyIndicator {
                Layout.preferredHeight: getButton.height
                Layout.preferredWidth: getButton.height
                running: rest.busy
            }
        }

        Label {
            Layout.fillWidth: true
            text: root.message !== "" ? root.message
                                      : qsTr("jsonplaceholder.typicode.com answers with test data. The request runs on restc-cpp's thread; the window stays responsive.")
            wrapMode: Text.Wrap
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            ListView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredWidth: 1
                clip: true
                spacing: 2
                model: root.items

                ScrollBar.vertical: ScrollBar {}

                // With a JavaScript array as the model, each delegate gets its
                // element as modelData.
                delegate: CheckDelegate {
                    id: item

                    required property var modelData

                    width: ListView.view.width
                    text: item.modelData.title ?? JSON.stringify(item.modelData)
                    checked: item.modelData.completed === true
                    // Shows the data; clicking does not change it.
                    checkable: false
                }
            }

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredWidth: 1

                TextArea {
                    id: raw

                    readOnly: true
                    font.family: "monospace"
                    wrapMode: TextArea.NoWrap
                    placeholderText: qsTr("The reply's body")
                }
            }
        }
    }
}
