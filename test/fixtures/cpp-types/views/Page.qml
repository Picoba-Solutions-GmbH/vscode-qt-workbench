import QtQuick
import QtQuick.Controls
import Demo as D
Item {
    id: root
    property Gauge gauge: Gauge {}
    property string label: "Gauge"
    property var other: root.Gauge
    property int level: Modes.High
    function make(): D.Gauge { return gauge }
    D.Gauge {}
    Dial {}
    Knob {}
    Component.onCompleted: Qt.createComponent("Demo", "Gauge")
}
