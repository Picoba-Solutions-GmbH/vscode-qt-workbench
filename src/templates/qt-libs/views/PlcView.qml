pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Fusion
import %{ProjectName}

// Talks S7 to a PLC with snap7 (plc/plcclient.cpp). Without a PLC at hand,
// start the simulated one (plc/plcsimulator.cpp) and connect to 127.0.0.1.
Item {
    id: root

    // The bytes of the last read, decoded by PlcClient's helpers below.
    property var bytes: new ArrayBuffer(0)

    PlcSimulator {
        id: simulator
    }

    PlcClient {
        id: plc

        onDbRead: (db, start, data) => root.bytes = data
    }

    // Reads DB1 every second while "Read every second" is checked.
    Timer {
        interval: 1000
        repeat: true
        running: pollBox.checked && plc.connected
        onTriggered: plc.readDb(1, 0, 16)
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 12

        GroupBox {
            Layout.fillWidth: true
            title: qsTr("Simulated PLC on this computer")

            RowLayout {
                anchors.fill: parent

                Switch {
                    text: qsTr("Running")
                    checked: simulator.running
                    onToggled: checked ? simulator.start() : simulator.stop()
                }

                Label {
                    Layout.fillWidth: true
                    text: simulator.status
                }
            }
        }

        GroupBox {
            Layout.fillWidth: true
            title: qsTr("Connection")

            GridLayout {
                anchors.fill: parent
                columns: 8
                columnSpacing: 8

                Label { text: qsTr("Address") }
                TextField {
                    id: address

                    Layout.fillWidth: true
                    text: "127.0.0.1"
                }

                Label { text: qsTr("Rack") }
                SpinBox {
                    id: rack

                    from: 0
                    to: 7
                    value: 0
                }

                Label { text: qsTr("Slot") }
                SpinBox {
                    id: slot

                    from: 0
                    to: 31
                    value: 1
                }

                Label { text: qsTr("Port") }
                SpinBox {
                    id: port

                    from: 1
                    to: 65535
                    editable: true
                    value: simulator.port
                    textFromValue: (value) => value.toString()
                }

                Button {
                    Layout.columnSpan: 2
                    text: plc.connected ? qsTr("Disconnect") : qsTr("Connect")
                    enabled: !plc.busy
                    onClicked: plc.connected ? plc.disconnectFrom()
                                             : plc.connectTo(address.text, rack.value, slot.value, port.value)
                }

                BusyIndicator {
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: 28
                    running: plc.busy
                }

                Label {
                    Layout.columnSpan: 5
                    Layout.fillWidth: true
                    text: plc.status
                    elide: Text.ElideRight
                }
            }
        }

        GroupBox {
            Layout.fillWidth: true
            Layout.fillHeight: true
            title: qsTr("Data block DB1")
            enabled: plc.connected

            GridLayout {
                anchors.left: parent.left
                anchors.right: parent.right
                columns: 2
                columnSpacing: 16
                rowSpacing: 8

                RowLayout {
                    Layout.columnSpan: 2

                    Button {
                        text: qsTr("Read 16 Bytes")
                        onClicked: plc.readDb(1, 0, 16)
                    }

                    CheckBox {
                        id: pollBox

                        text: qsTr("Read every second")
                    }
                }

                Label { text: qsTr("DBW0  counter (INT)") }
                Label { text: plc.intAt(root.bytes, 0) }

                Label { text: qsTr("DBD2  temperature (REAL)") }
                Label { text: plc.realAt(root.bytes, 2).toFixed(2) + " °C" }

                Label { text: qsTr("DBX6.0  flag (BOOL)") }
                Label { text: plc.bitAt(root.bytes, 6, 0) ? qsTr("true") : qsTr("false") }

                Label { text: qsTr("DBW8  setpoint (INT)") }
                RowLayout {
                    Label {
                        Layout.preferredWidth: 60
                        text: plc.intAt(root.bytes, 8)
                    }

                    SpinBox {
                        id: setpoint

                        from: -32768
                        to: 32767
                        editable: true
                        value: 50
                    }

                    Button {
                        text: qsTr("Write")
                        onClicked: plc.writeInt(1, 8, setpoint.value)
                    }
                }

                Label { text: qsTr("Raw bytes") }
                Label {
                    Layout.fillWidth: true
                    text: plc.hex(root.bytes)
                    font.family: "monospace"
                    wrapMode: Text.Wrap
                }
            }
        }
    }
}
