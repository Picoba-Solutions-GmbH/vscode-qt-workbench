pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Fusion
import %{ProjectName}

// JSON text on the left, what C++ made of it on the right (json/jsonplayground.cpp).
Item {
    id: root

    JsonPlayground {
        id: json
    }

    RowLayout {
        anchors.fill: parent
        spacing: 12

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 1

            Label {
                text: qsTr("JSON")
                font.bold: true
            }

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true

                TextArea {
                    id: input

                    // A Q_INVOKABLE's return value used straight as a property value.
                    text: json.sampleOrder()
                    font.family: "monospace"
                    wrapMode: TextArea.NoWrap
                }
            }

            Flow {
                Layout.fillWidth: true
                spacing: 6

                Button {
                    text: qsTr("Format")
                    onClicked: output.text = json.format(input.text, 4)
                }

                Button {
                    text: qsTr("Minify")
                    onClicked: output.text = json.format(input.text, -1)
                }

                Button {
                    text: qsTr("Read into a C++ struct")
                    onClicked: output.text = json.describeOrder(input.text)
                }

                Button {
                    text: qsTr("Use in QML")
                    onClicked: {
                        // toVariant() hands over a QVariantMap, which arrives as a
                        // JavaScript object, or a QVariantList, which arrives as a
                        // list with length and [i] (though Array.isArray() says no).
                        const value = json.toVariant(input.text)
                        if (value === undefined || value === null) {
                            output.text = ""
                            return
                        }
                        const describe = (item) => item !== null && typeof item === "object" && item.length !== undefined
                                                   ? "list of " + item.length
                                                   : typeof item
                        output.text = value.length !== undefined
                            ? describe(value)
                            : Object.keys(value).map(key => key + ": " + describe(value[key])).join("\n")
                    }
                }

                Button {
                    text: qsTr("Sample")
                    flat: true
                    onClicked: input.text = json.sampleOrder()
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 1

            Label {
                text: qsTr("Result")
                font.bold: true
            }

            // Bound to the error property: shown only while the last call failed.
            Label {
                Layout.fillWidth: true
                visible: json.error !== ""
                text: json.error
                color: "#d9534f"
                wrapMode: Text.Wrap
            }

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true

                TextArea {
                    id: output

                    readOnly: true
                    font.family: "monospace"
                    wrapMode: TextArea.NoWrap
                    placeholderText: qsTr("Press a button on the left.")
                }
            }
        }
    }
}
